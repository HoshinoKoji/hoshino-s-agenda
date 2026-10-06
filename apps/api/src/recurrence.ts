import { and, eq, inArray, notExists } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { DESCRIPTION_MAX_LENGTH, type EncryptedDescription, type Entry, type EntryInput, type EntrySaveResult, type RecurrenceScope } from '../../../shared/types'
import { expandRecurrence } from '../../../shared/recurrence'
import type { Database } from './db'
import { entries, entryAssets, entryReferences, entrySeries, projects, seriesMutations, seriesSkips } from './db/schema'
import { fail, HttpError } from './errors'
import { isEncryptedDescription } from '../../../shared/encryption'
import { validateProjectDescription } from './project-encryption'

type Row = typeof entries.$inferSelect
type Input = EntryInput & { description: string; assetIds: string[] }
type Write = BatchItem<'sqlite'>
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sameIds = (a: string[], b: string[]) => same([...a].sort(), [...b].sort())
function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))
}
export async function publicEntry(db: Database, email: string, id: string): Promise<Entry> {
  const row = await db.select().from(entries).where(and(eq(entries.id, id), eq(entries.ownerEmail, email))).get()
  if (!row) fail(404, '事项不存在')
  const [refs, attachments, series] = await Promise.all([
    db.select({ id: entryReferences.targetId }).from(entryReferences).where(and(eq(entryReferences.sourceId, id), eq(entryReferences.ownerEmail, email))).orderBy(entryReferences.targetId),
    db.select({ id: entryAssets.assetId }).from(entryAssets).where(and(eq(entryAssets.entryId, id), eq(entryAssets.ownerEmail, email))).orderBy(entryAssets.assetId),
    row.seriesId ? db.select().from(entrySeries).where(and(eq(entrySeries.id, row.seriesId), eq(entrySeries.ownerEmail, email))).get() : undefined,
  ])
  const { ownerEmail, seriesId, scheduledDate, exception, encryptedDescription, ...fields } = row
  return { ...fields, ...(encryptedDescription ? { encryptedDescription } : {}),
    references: refs.map(ref => ref.id), assetIds: attachments.map(asset => asset.id),
    ...(series && scheduledDate ? { recurrence: { seriesId: series.id, scheduledDate, exception, rule: series.rule, version: series.version } } : {}) }
}
async function result(db: Database, email: string, id: string): Promise<EntrySaveResult> {
  const savedEntry = await publicEntry(db, email, id)
  return { id, description: savedEntry.description,
    ...(savedEntry.encryptedDescription ? { encryptedDescription: savedEntry.encryptedDescription } : {}), savedEntry }
}
function scopeOf(raw: Record<string, unknown>): RecurrenceScope {
  const scope = raw.scope ?? 'single'
  if (scope !== 'single' && scope !== 'following' && scope !== 'all') fail(400, '请选择有效的修改范围')
  return scope
}
function checkedRule(raw: Record<string, unknown>, requireConfirmation = true) {
  try {
    const expanded = expandRecurrence(raw.recurrence)
    if (requireConfirmation && expanded.adjustments.length && raw.acknowledgeAdjustments !== true) fail(409, '存在没有对应日期的排期，请确认日期替代提醒后保存')
    return expanded
  } catch (error) {
    if (error instanceof HttpError) throw error
    fail(400, (error as Error).message)
  }
}
function values(input: Input, now: string) {
  return { projectId: input.projectId, title: input.title, description: input.description,
    encryptedDescription: input.encryptedDescription ?? null, completed: input.completed, date: input.date, updatedAt: now }
}
function referenceWrites(db: Database, email: string, ids: string[], references: string[]): Write[] {
  const writes: Write[] = []
  for (const group of chunks(ids, 80)) {
    writes.push(db.delete(entryReferences).where(and(eq(entryReferences.ownerEmail, email), inArray(entryReferences.sourceId, group))))
  }
  for (const group of chunks(ids.flatMap(sourceId => references.filter(targetId => targetId !== sourceId).map(targetId => ({ sourceId, targetId, ownerEmail: email }))), 30)) {
    writes.push(db.insert(entryReferences).values(group))
  }
  return writes
}
function assetWrites(db: Database, email: string, ids: string[], assetIds: string[]): Write[] {
  const writes: Write[] = chunks(ids, 80).map(group => db.delete(entryAssets).where(and(eq(entryAssets.ownerEmail, email), inArray(entryAssets.entryId, group))))
  for (const group of chunks(ids.flatMap(entryId => assetIds.map(assetId => ({ entryId, assetId, ownerEmail: email }))), 30)) {
    writes.push(db.insert(entryAssets).values(group))
  }
  return writes
}
function relations(db: Database, email: string, ids: string[], references: string[], assetIds: string[]): Write[] {
  return [...referenceWrites(db, email, ids, references), ...assetWrites(db, email, ids, assetIds)]
}
function inserts(db: Database, rows: (typeof entries.$inferInsert)[], input: Input, email: string): Write[] {
  return [...chunks(rows, 6).map(group => db.insert(entries).values(group)),
    ...relations(db, email, rows.map(row => row.id), input.references, input.assetIds)]
}
async function batch(db: Database, writes: Write[]) {
  if (writes.length > 900) fail(400, '排期和附件、引用的组合过大，请缩短截止日期范围')
  if (writes.length) await db.batch([writes[0]!, ...writes.slice(1)])
}
async function ownedSeries(db: Database, email: string, row: Row, raw: Record<string, unknown>) {
  const series = await db.select().from(entrySeries).where(and(eq(entrySeries.id, row.seriesId!), eq(entrySeries.ownerEmail, email))).get()
  if (!series) fail(404, '重复系列不存在')
  if (raw.seriesVersion !== undefined && raw.seriesVersion !== series.version) fail(409, '重复系列已变化，请同步后重新打开事项')
  if (scopeOf(raw) !== 'single' && raw.seriesVersion === undefined) fail(409, '批量操作必须提交重复系列版本，请同步后重试')
  return series
}
function claim(db: Database, series: typeof entrySeries.$inferSelect): Write[] {
  return [db.insert(seriesMutations).values({ seriesId: series.id, version: series.version }),
    db.update(entrySeries).set({ version: series.version + 1 }).where(eq(entrySeries.id, series.id))]
}
async function guardedBatch(db: Database, series: typeof entrySeries.$inferSelect, writes: Write[]) {
  try { await batch(db, [...claim(db, series), ...writes]) }
  catch (error) {
    const latest = await db.select({ version: entrySeries.version }).from(entrySeries).where(eq(entrySeries.id, series.id)).get()
    if (!latest || latest.version !== series.version) fail(409, '重复系列已变化，请同步后重新打开事项')
    throw error
  }
}
const previousDay = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() - 1)
  return day.toISOString().slice(0, 10)
}
export async function cleanupSeries(db: Database, email: string) {
  await db.delete(entrySeries).where(and(eq(entrySeries.ownerEmail, email),
    notExists(db.select({ id: entries.id }).from(entries).where(eq(entries.seriesId, entrySeries.id)))))
}

export async function deleteProjectWithSeries(db: Database, email: string, id: string) {
  const members = await db.select().from(entries).where(and(eq(entries.projectId, id), eq(entries.ownerEmail, email)))
  const ids = new Set(members.map(row => row.seriesId).filter(Boolean))
  const affected = ids.size ? (await db.select().from(entrySeries).where(eq(entrySeries.ownerEmail, email)))
    .filter(series => ids.has(series.id)) : []
  const skips = members.filter(row => row.seriesId && row.scheduledDate).map(row => ({ seriesId: row.seriesId!, date: row.scheduledDate! }))
  const writes: Write[] = [
    ...affected.flatMap(series => claim(db, series)),
    ...chunks(skips, 40).map(group => db.insert(seriesSkips).values(group).onConflictDoNothing()),
    db.delete(projects).where(and(eq(projects.id, id), eq(projects.ownerEmail, email))),
  ]
  try { await batch(db, writes) }
  catch (error) {
    const latest = await db.select().from(entrySeries).where(eq(entrySeries.ownerEmail, email))
    if (affected.some(series => latest.find(item => item.id === series.id)?.version !== series.version)) fail(409, '重复系列已变化，请同步后重新删除项目')
    throw error
  }
  await cleanupSeries(db, email)
}

/** All generated instances and their relations are committed in a single D1 batch. */
export async function saveRecurring(db: Database, email: string, id: string, current: Row | undefined, raw: Record<string, unknown>, input: Input) {
  const now = new Date().toISOString()
  if (!current?.seriesId) {
    const { rule, dates } = checkedRule(raw)
    if (input.date === null || input.date !== rule.startDate) fail(400, '重复事项的开始日期必须与记录日期一致')
    const seriesId = id
    const rows = dates.map((date, index) => ({ ...values(input, now), id: index === 0 ? id : crypto.randomUUID(), ownerEmail: email,
      date, completed: index === 0 ? input.completed : false, createdAt: index === 0 ? current?.createdAt ?? now : now,
      seriesId, scheduledDate: date, exception: false }))
    await batch(db, [db.insert(entrySeries).values({ id: seriesId, ownerEmail: email, rule }),
      ...(current ? [db.update(entries).set(rows[0]!).where(and(eq(entries.id, id), eq(entries.ownerEmail, email))),
        ...relations(db, email, [id], input.references, input.assetIds), ...inserts(db, rows.slice(1), input, email)] : inserts(db, rows, input, email))])
    return result(db, email, id)
  }
  const series = await ownedSeries(db, email, current, raw)
  const scope = scopeOf(raw)
  if (scope === 'single') {
    if (raw.recurrence === null || (raw.recurrence !== undefined && !same(checkedRule(raw, false).rule, series.rule))) fail(400, '更改重复规则请选择「本次及以后」或「整个系列」')
    const saved = await publicEntry(db, email, id)
    const edited = ['title', 'projectId', 'date', 'description'].some(field => input[field as keyof Input] !== saved[field as keyof Entry]) ||
      !same(input.encryptedDescription ?? null, saved.encryptedDescription ?? null) || !sameIds(input.references, saved.references) || !sameIds(input.assetIds, saved.assetIds)
    await guardedBatch(db, series, [db.update(entries).set({ ...values(input, now), exception: current.exception || edited })
      .where(and(eq(entries.id, id), eq(entries.ownerEmail, email))), ...relations(db, email, [id], input.references, input.assetIds)])
    return result(db, email, id)
  }
  const allRows = await db.select().from(entries).where(and(eq(entries.seriesId, series.id), eq(entries.ownerEmail, email)))
  const selected = allRows.filter(row => scope === 'all' || row.scheduledDate! >= current.scheduledDate!)
  const saved = await publicEntry(db, email, id)
  const patch: Partial<Row> = { updatedAt: now }
  for (const field of ['title', 'projectId', 'description'] as const) if (input[field] !== saved[field]) patch[field] = input[field]
  if (!same(input.encryptedDescription ?? null, saved.encryptedDescription ?? null)) patch.encryptedDescription = input.encryptedDescription ?? null
  const changingBody = patch.description !== undefined || patch.encryptedDescription !== undefined
  const projectRows = await db.select().from(projects).where(eq(projects.ownerEmail, email))
  const descriptionFor = (projectId: string) => {
    const overrides = raw.projectDescriptions
    if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) fail(400, '项目描述列表格式无效')
    const override = overrides ? (overrides as Record<string, unknown>)[projectId] : undefined
    const body = override ?? (projectId === input.projectId ? { description: input.description, encryptedDescription: input.encryptedDescription ?? null } : undefined)
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(409, '批量修改涉及其他项目，请解锁相关项目后重新保存')
    const data = body as { description: unknown; encryptedDescription: unknown }
    if (typeof data.description !== 'string' || data.description.length > DESCRIPTION_MAX_LENGTH ||
      (data.encryptedDescription !== null && !isEncryptedDescription(data.encryptedDescription))) fail(400, '批量描述格式无效')
    const project = projectRows.find(row => row.id === projectId)
    if (!project) fail(404, '项目不存在')
    validateProjectDescription(projectId, project.encryption, data.description, data.encryptedDescription)
    return { description: data.description, encryptedDescription: data.encryptedDescription as EncryptedDescription | null }
  }
  const changeRefs = !sameIds(input.references, saved.references)
  const changeAssets = !sameIds(input.assetIds, saved.assetIds)
  const expanded = raw.recurrence === null ? undefined : checkedRule(raw.recurrence === undefined ? { ...raw, recurrence: series.rule } : raw)
  const changedRule = !expanded || !same(expanded.rule, series.rule)
  if (expanded && changedRule && scope === 'following' && expanded.rule.startDate < current.scheduledDate!) fail(400, '本次及以后的开始日期不能早于本次原始排期')
  const writes: Write[] = []
  const deletedIds: string[] = []
  const relationIds: string[] = []
  const skips = await db.select().from(seriesSkips).where(eq(seriesSkips.seriesId, series.id))
  const skipDates = new Set(skips.map(skip => skip.date))
  const nextSeriesId = expanded && changedRule && scope === 'following' ? crypto.randomUUID() : series.id
  if (expanded && changedRule) {
    if (nextSeriesId !== series.id) {
      writes.push(db.insert(entrySeries).values({ id: nextSeriesId, ownerEmail: email, rule: expanded.rule }),
        db.update(entrySeries).set({ rule: { ...series.rule, until: previousDay(current.scheduledDate!) } }).where(eq(entrySeries.id, series.id)))
      for (const group of chunks(skips.filter(skip => skip.date >= current.scheduledDate!).map(skip => ({ seriesId: nextSeriesId, date: skip.date })), 40)) writes.push(db.insert(seriesSkips).values(group))
    } else writes.push(db.update(entrySeries).set({ rule: expanded.rule }).where(eq(entrySeries.id, series.id)))
  }
  const wanted = new Set(expanded?.dates ?? [])
  for (const row of selected) {
    const keep = !changedRule || (expanded && wanted.has(row.scheduledDate!))
    if (!keep && expanded && !row.completed && !row.exception && row.id !== id) { deletedIds.push(row.id); continue }
    const meta = row.exception && row.id !== id ? { updatedAt: now } : { ...patch }
    if ((!row.exception || row.id === id) && (changingBody || (patch.projectId !== undefined && patch.projectId !== row.projectId))) {
      Object.assign(meta, descriptionFor(patch.projectId ?? row.projectId))
    }
    writes.push(db.update(entries).set({ ...meta, ...(row.id === id ? { completed: input.completed } : {}),
      ...(changedRule ? { seriesId: keep ? nextSeriesId : null, scheduledDate: keep ? row.scheduledDate : null, exception: keep ? row.exception : false } : {}) })
      .where(and(eq(entries.id, row.id), eq(entries.ownerEmail, email))))
    if (changedRule && !keep && row.scheduledDate) {
      skipDates.add(row.scheduledDate)
      writes.push(db.insert(seriesSkips).values({ seriesId: nextSeriesId, date: row.scheduledDate }).onConflictDoNothing())
    }
    if (!row.exception || row.id === id) relationIds.push(row.id)
  }
  if (changeRefs) writes.push(...referenceWrites(db, email, relationIds, input.references.filter(target => !deletedIds.includes(target))))
  if (changeAssets) writes.push(...assetWrites(db, email, relationIds, input.assetIds))
  for (const group of chunks(deletedIds, 80)) writes.push(db.delete(entries).where(and(eq(entries.ownerEmail, email), inArray(entries.id, group))))
  if (expanded && changedRule) {
    const existingDates = new Set(selected.map(row => row.scheduledDate!))
    const added = expanded.dates.filter(date => !existingDates.has(date) && !skipDates.has(date))
      .map(date => ({ ...values(input, now), id: crypto.randomUUID(), ownerEmail: email, date, completed: false, createdAt: now,
        seriesId: nextSeriesId, scheduledDate: date, exception: false }))
    writes.push(...inserts(db, added, { ...input, references: input.references.filter(target => !deletedIds.includes(target)) }, email))
  }
  if (!expanded) {
    if (scope === 'all') writes.push(db.delete(entrySeries).where(eq(entrySeries.id, series.id)))
    else writes.push(db.update(entrySeries).set({ rule: { ...series.rule, until: previousDay(current.scheduledDate!) } }).where(eq(entrySeries.id, series.id)))
  }
  await guardedBatch(db, series, writes)
  await cleanupSeries(db, email)
  return result(db, email, id)
}

export async function removeRecurring(db: Database, email: string, row: Row, raw: Record<string, unknown>) {
  const series = await ownedSeries(db, email, row, raw)
  const scope = scopeOf(raw)
  if (scope === 'all') await guardedBatch(db, series, [db.delete(entrySeries).where(eq(entrySeries.id, series.id))])
  else {
    const members = await db.select().from(entries).where(and(eq(entries.seriesId, series.id), eq(entries.ownerEmail, email)))
    const selected = members.filter(member => scope === 'single' ? member.id === row.id : member.scheduledDate! >= row.scheduledDate!)
    const writes: Write[] = chunks(selected.map(member => ({ seriesId: series.id, date: member.scheduledDate! })), 40)
      .map(group => db.insert(seriesSkips).values(group).onConflictDoNothing())
    for (const group of chunks(selected.map(member => member.id), 80)) writes.push(db.delete(entries).where(and(eq(entries.ownerEmail, email), inArray(entries.id, group))))
    if (scope === 'following') writes.push(db.update(entrySeries).set({ rule: { ...series.rule, until: previousDay(row.scheduledDate!) } }).where(eq(entrySeries.id, series.id)))
    await guardedBatch(db, series, writes)
  }
  await cleanupSeries(db, email)
}

export async function patchRecurring(db: Database, email: string, row: Row, changes: { date: string | null } | { completed: boolean }) {
  const series = await ownedSeries(db, email, row, {})
  await guardedBatch(db, series, [db.update(entries).set({ ...changes, updatedAt: new Date().toISOString(),
    ...('date' in changes ? { exception: true } : {}) }).where(and(eq(entries.id, row.id), eq(entries.ownerEmail, email)))])
}
