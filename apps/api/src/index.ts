import { and, count, eq, inArray, max } from 'drizzle-orm'
import { DESCRIPTION_MAX_LENGTH, type AgendaData, type Asset, type EntryInput, type ProjectInput } from '../../../shared/types'
import { createDb, type Database } from './db'
import { accounts, assetDeletions, assets, entries, entryAssets, entryReferences, projects } from './db/schema'

interface Env {
  DB: D1Database
  ASSETS: R2Bucket
  ALLOWED_ORIGINS: string
}

const MAX_ASSET_SIZE = 20 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function isImage(bytes: Uint8Array, type: string) {
  if (type === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (type === 'image/gif') return new TextDecoder().decode(bytes.subarray(0, 6)).match(/^GIF8[79]a$/) !== null
  if (type === 'image/webp') return new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP'
  return false
}

async function assetBody(request: Request) {
  const rawName = request.headers.get('X-File-Name')
  let name: string
  try { name = decodeURIComponent(rawName || '').trim() } catch { return fail(400, '文件名无效') }
  if (!name || name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(name)) fail(400, '文件名无效')
  const reader = request.body?.getReader()
  if (!reader) fail(400, '文件不能为空')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_ASSET_SIZE) { await reader.cancel(); fail(413, '文件不能超过 20 MiB') }
    chunks.push(value)
  }
  if (!size) fail(400, '文件不能为空')
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const suppliedType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream'
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(suppliedType)) fail(400, '文件类型无效')
  const image = IMAGE_TYPES.has(suppliedType) && isImage(bytes, suppliedType)
  // Unverified image types and active content are downloaded, never rendered inline.
  const contentType = !image && IMAGE_TYPES.has(suppliedType) ? 'application/octet-stream' : suppliedType
  return { name, bytes, size, contentType, image }
}

async function retryAssetDeletions(db: Database, bucket: R2Bucket) {
  const pending = await db.select().from(assetDeletions).limit(10)
  for (const { objectKey } of pending) {
    try {
      await bucket.delete(objectKey)
      await db.delete(assetDeletions).where(eq(assetDeletions.objectKey, objectKey))
    } catch (error) { console.error('R2 cleanup failed', error) }
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const json = (data: unknown, status = 200) => Response.json(data, { status })
function fail(status: number, message: string): never { throw new HttpError(status, message) }

function getEmail(request: Request) {
  const email = (request.headers.get('X-User-Email') || '').trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, '请提供有效的邮箱地址')
  }
  return email
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) fail(415, '请使用 JSON 请求')
  // Bound the actual stream as well as Content-Length (which clients can omit).
  const reader = request.body?.getReader()
  if (!reader) fail(400, '请求内容不能为空')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    // Allow JSON escaping of the description plus up to 50 reference IDs.
    if (size > 65_536) {
      await reader.cancel()
      fail(413, '请求内容过大')
    }
    chunks.push(value)
  }
  try {
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '请求内容必须是对象')
    return value as Record<string, unknown>
  } catch { return fail(400, '请求内容不是有效的 JSON 对象') }
}

function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    fail(400, `${label}需为 1–${max} 个字符`)
  }
  return value.trim()
}

function projectInput(value: Record<string, unknown>): ProjectInput {
  const name = text(value.name, '项目名称', 64)
  if (typeof value.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.color)) fail(400, '请选择有效的 RGB 项目颜色')
  return { name, color: (value.color as string).toUpperCase() }
}

function entryDate(value: unknown): string | null {
  const date = value === null ? null : text(value, '日期', 10)
  if (date !== null) {
    const parsed = new Date(`${date}T00:00:00.000Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      fail(400, '请提供有效的日期，格式为 YYYY-MM-DD，或用 null 表示未设日期')
    }
  }
  return date
}

function entryInput(value: Record<string, unknown>, id: string): EntryInput & { description: string } {
  const title = text(value.title, '事项标题', 200)
  if (value.description !== undefined && typeof value.description !== 'string') {
    fail(400, '事项描述必须为字符串')
  }
  // POST and PUT both normalize omission to ''; PUT replaces rather than preserves it.
  const description = value.description === undefined ? '' : value.description
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    fail(400, `事项描述不能超过 ${DESCRIPTION_MAX_LENGTH} 个 UTF-16 单元`)
  }
  const projectId = text(value.projectId, '项目 ID', 64)
  const date = entryDate(value.date)
  if (typeof value.completed !== 'boolean') fail(400, '完成状态必须为布尔值')
  if (!Array.isArray(value.references) || value.references.length > 50 ||
    !value.references.every(ref => typeof ref === 'string' && ref.length > 0 && ref.length <= 64)) {
    fail(400, '引用必须为事项 ID 列表，最多 50 个')
  }
  const references = [...new Set(value.references as string[])]
  if (references.includes(id)) fail(400, '事项不能引用自身')
  if (value.assetIds !== undefined && (!Array.isArray(value.assetIds) || value.assetIds.length > 50 ||
    !value.assetIds.every(assetId => typeof assetId === 'string' && /^[\w-]{1,64}$/.test(assetId)))) {
    fail(400, '素材引用必须为素材 ID 列表，最多 50 个')
  }
  const assetIds = value.assetIds === undefined ? undefined : [...new Set(value.assetIds as string[])]
  return { title, description, projectId, date, completed: value.completed, references, assetIds }
}

async function ensureOwned(db: Database, table: typeof projects | typeof entries, id: string, email: string) {
  const row = await db.select({ id: table.id }).from(table)
    .where(and(eq(table.id, id), eq(table.ownerEmail, email))).get()
  if (!row) fail(404, table === projects ? '项目不存在' : '事项不存在')
}

async function route(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, '')
  const method = request.method
  if (path === '/api/health' && method === 'GET') return json({ ok: true })
  const email = getEmail(request)
  const db = createDb(env.DB)

  if (path === '/api/agenda' && method === 'GET') {
    const [projectRows, entryRows, referenceRows, assetRows, attachmentRows] = await db.batch([
      db.select({ id: projects.id, name: projects.name, color: projects.color, createdAt: projects.createdAt })
        .from(projects).where(eq(projects.ownerEmail, email)).orderBy(projects.sortOrder, projects.createdAt, projects.id),
      db.select({
        id: entries.id, projectId: entries.projectId, date: entries.date, title: entries.title,
        description: entries.description,
        completed: entries.completed, createdAt: entries.createdAt, updatedAt: entries.updatedAt,
      }).from(entries).where(eq(entries.ownerEmail, email)).orderBy(entries.date, entries.createdAt, entries.id),
      db.select({ sourceId: entryReferences.sourceId, targetId: entryReferences.targetId })
        .from(entryReferences).where(eq(entryReferences.ownerEmail, email)).orderBy(entryReferences.targetId),
      db.select({ id: assets.id, name: assets.name, contentType: assets.contentType, size: assets.size,
        image: assets.image, createdAt: assets.createdAt })
        .from(assets).where(eq(assets.ownerEmail, email)).orderBy(assets.createdAt, assets.id),
      db.select({ entryId: entryAssets.entryId, assetId: entryAssets.assetId })
        .from(entryAssets).where(eq(entryAssets.ownerEmail, email)).orderBy(entryAssets.assetId),
    ])
    const references = new Map<string, string[]>()
    const attachments = new Map<string, string[]>()
    const usage = new Map<string, number>()
    for (const row of referenceRows) {
      references.set(row.sourceId, [...(references.get(row.sourceId) || []), row.targetId])
    }
    for (const row of attachmentRows) {
      attachments.set(row.entryId, [...(attachments.get(row.entryId) || []), row.assetId])
      usage.set(row.assetId, (usage.get(row.assetId) || 0) + 1)
    }
    return json({
      projects: projectRows,
      entries: entryRows.map(row => ({ ...row, references: references.get(row.id) || [], assetIds: attachments.get(row.id) || [] })),
      assets: assetRows.map(row => ({ ...row, usageCount: usage.get(row.id) || 0 })),
    } satisfies AgendaData)
  }

  if (path === '/api/assets' && method === 'POST') {
    const data = await assetBody(request)
    const id = crypto.randomUUID()
    const objectKey = `assets/${id}`
    const createdAt = new Date().toISOString()
    await env.ASSETS.put(objectKey, data.bytes, { httpMetadata: { contentType: data.contentType } })
    try {
      await db.batch([
        db.insert(accounts).values({ email }).onConflictDoNothing({ target: accounts.email }),
        db.insert(assets).values({ id, objectKey, ownerEmail: email, name: data.name,
          contentType: data.contentType, size: data.size, image: data.image, createdAt }),
      ])
    } catch (error) {
      try { await env.ASSETS.delete(objectKey) } catch (cleanupError) { console.error('R2 upload cleanup failed', cleanupError) }
      throw error
    }
    await retryAssetDeletions(db, env.ASSETS)
    return json({ id, name: data.name, contentType: data.contentType, size: data.size,
      image: data.image, createdAt, usageCount: 0 } satisfies Asset, 201)
  }

  const assetMatch = path.match(/^\/api\/assets\/([\w-]+)$/)
  const assetContentMatch = path.match(/^\/api\/assets\/([\w-]+)\/content$/)
  if (assetContentMatch && method === 'GET') {
    const row = await db.select().from(assets)
      .where(and(eq(assets.id, assetContentMatch[1]), eq(assets.ownerEmail, email))).get()
    if (!row) fail(404, '素材不存在')
    const object = await env.ASSETS.get(row.objectKey)
    if (!object) fail(404, '素材文件不存在')
    const headers = new Headers({
      'Content-Type': row.image ? row.contentType : 'application/octet-stream',
      'Content-Length': String(row.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${row.image ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    })
    return new Response(object.body, { headers })
  }
  if (assetMatch && method === 'DELETE') {
    const id = assetMatch[1]
    const row = await db.select({ objectKey: assets.objectKey }).from(assets)
      .where(and(eq(assets.id, id), eq(assets.ownerEmail, email))).get()
    if (!row) fail(404, '素材不存在')
    const used = await db.select({ count: count() }).from(entryAssets)
      .where(and(eq(entryAssets.assetId, id), eq(entryAssets.ownerEmail, email))).get()
    if (used?.count) fail(409, '素材仍被事项引用，请先移除关联')
    try {
      await db.batch([
        db.insert(assetDeletions).values({ objectKey: row.objectKey }),
        db.delete(assets).where(and(eq(assets.id, id), eq(assets.ownerEmail, email))),
      ])
    } catch { fail(409, '素材仍被事项引用，请先移除关联') }
    await retryAssetDeletions(db, env.ASSETS)
    return json({ ok: true })
  }

  if (path === '/api/projects' && method === 'POST') {
    const data = projectInput(await body(request))
    const last = await db.select({ value: max(projects.sortOrder) }).from(projects).where(eq(projects.ownerEmail, email)).get()
    const project = { id: crypto.randomUUID(), ...data, createdAt: new Date().toISOString() }
    await db.batch([
      db.insert(accounts).values({ email }).onConflictDoNothing({ target: accounts.email }),
      db.insert(projects).values({ ...project, ownerEmail: email, sortOrder: (last?.value ?? -1) + 1 }),
    ])
    return json(project, 201)
  }

  if (path === '/api/projects/order' && method === 'PUT') {
    const data = await body(request)
    const validIds = (value: unknown): value is string[] => Array.isArray(value) &&
      value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 64) && new Set(value).size === value.length
    if (!validIds(data.projectIds) || !validIds(data.previousIds)) fail(400, '排序需提供不重复的项目 ID 列表及原顺序')
    const ids = data.projectIds as string[]
    const previous = data.previousIds as string[]
    const current = await db.select({ id: projects.id }).from(projects).where(eq(projects.ownerEmail, email))
      .orderBy(projects.sortOrder, projects.createdAt, projects.id)
    if (ids.length !== current.length || ids.some(id => !current.some(project => project.id === id))) fail(400, '排序必须包含当前邮箱的全部项目')
    if (previous.length !== current.length || current.some((project, index) => project.id !== previous[index])) fail(409, '项目顺序已变化，请同步后重试')
    const writes = ids.map((id, sortOrder) => db.update(projects).set({ sortOrder }).where(and(eq(projects.id, id), eq(projects.ownerEmail, email))))
    if (writes.length) await db.batch([writes[0]!, ...writes.slice(1)])
    return json({ ok: true })
  }

  const projectMatch = path.match(/^\/api\/projects\/([\w-]+)$/)
  if (projectMatch && (method === 'PUT' || method === 'DELETE')) {
    const id = projectMatch[1]
    await ensureOwned(db, projects, id, email)
    if (method === 'DELETE') {
      await db.delete(projects).where(and(eq(projects.id, id), eq(projects.ownerEmail, email)))
    } else {
      const data = projectInput(await body(request))
      await db.update(projects).set(data).where(and(eq(projects.id, id), eq(projects.ownerEmail, email)))
    }
    return json({ ok: true })
  }

  const entryMatch = path.match(/^\/api\/entries\/([\w-]+)$/)
  if ((path === '/api/entries' && method === 'POST') || (entryMatch && method === 'PUT')) {
    const id = entryMatch?.[1] || crypto.randomUUID()
    if (entryMatch) await ensureOwned(db, entries, id, email)
    const data = entryInput(await body(request), id)
    await ensureOwned(db, projects, data.projectId, email)
    if (data.references.length) {
      const row = await db.select({ count: count() }).from(entries)
        .where(and(eq(entries.ownerEmail, email), inArray(entries.id, data.references))).get()
      if (row?.count !== data.references.length) fail(400, '引用的事项不存在或不属于当前邮箱')
    }
    const assetIds = data.assetIds ?? (entryMatch
      ? (await db.select({ id: entryAssets.assetId }).from(entryAssets)
          .where(and(eq(entryAssets.entryId, id), eq(entryAssets.ownerEmail, email)))).map(row => row.id)
      : [])
    if (assetIds.length) {
      const row = await db.select({ count: count() }).from(assets)
        .where(and(eq(assets.ownerEmail, email), inArray(assets.id, assetIds))).get()
      if (row?.count !== assetIds.length) fail(400, '素材不存在或不属于当前邮箱')
    }
    const now = new Date().toISOString()
    const values = {
      projectId: data.projectId, date: data.date, title: data.title, description: data.description,
      completed: data.completed, updatedAt: now,
    }
    const write = entryMatch
      ? db.update(entries).set(values).where(and(eq(entries.id, id), eq(entries.ownerEmail, email)))
      : db.insert(entries).values({ ...values, id, ownerEmail: email, createdAt: now })
    // Drizzle's D1 batch is transactional: an entry and all its references change together.
    await db.batch([
      write,
      db.delete(entryReferences).where(and(eq(entryReferences.sourceId, id), eq(entryReferences.ownerEmail, email))),
      ...data.references.map(targetId => db.insert(entryReferences).values({ sourceId: id, targetId, ownerEmail: email })),
      db.delete(entryAssets).where(and(eq(entryAssets.entryId, id), eq(entryAssets.ownerEmail, email))),
      ...assetIds.map(assetId => db.insert(entryAssets).values({ entryId: id, assetId, ownerEmail: email })),
    ])
    return json({ id, description: data.description }, entryMatch ? 200 : 201)
  }

  if (entryMatch && (method === 'PATCH' || method === 'DELETE')) {
    const id = entryMatch[1]
    await ensureOwned(db, entries, id, email)
    if (method === 'DELETE') {
      await db.delete(entries).where(and(eq(entries.id, id), eq(entries.ownerEmail, email)))
    } else {
      const data = await body(request)
      const hasDate = Object.hasOwn(data, 'date')
      if (hasDate && Object.hasOwn(data, 'completed')) fail(400, '每次只能更新日期或完成状态')
      if (!hasDate && typeof data.completed !== 'boolean') fail(400, '完成状态必须为布尔值')
      const changes = hasDate ? { date: entryDate(data.date) } : { completed: data.completed as boolean }
      await db.update(entries).set({ ...changes, updatedAt: new Date().toISOString() })
        .where(and(eq(entries.id, id), eq(entries.ownerEmail, email)))
    }
    return json({ ok: true })
  }
  return fail(404, '接口不存在')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
    const headers = new Headers({ 'Vary': 'Origin', 'Cache-Control': 'no-store' })
    const matchesOrigin = origin === new URL(request.url).origin || allowed.some(pattern => {
      // Only * is special; anchor the escaped pattern to the entire origin.
      const source = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
      return new RegExp(`^${source}$`).test(origin || '')
    })
    if (origin && !matchesOrigin) return json({ error: '此站点来源未被允许' }, 403)
    if (origin) headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type, X-User-Email, X-File-Name')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    let response: Response
    try { response = await route(request, env) }
    catch (error) {
      if (error instanceof HttpError) response = json({ error: error.message }, error.status)
      else {
        console.error('Agenda request failed', error)
        response = json({ error: '暂时无法访问数据，请稍后重试' }, 500)
      }
    }
    headers.forEach((value, key) => response.headers.set(key, value))
    return response
  },
} satisfies ExportedHandler<Env>
