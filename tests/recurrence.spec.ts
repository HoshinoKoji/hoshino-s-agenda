import { test, expect } from './fixtures'
import { expandRecurrence, MAX_RECURRENCE_OCCURRENCES } from '../shared/recurrence'
import type { Entry, EntryInput } from '../shared/types'

test('重复日期：截止包含、工作日、月末不漂移、闰年与日期范围', () => {
  expect(expandRecurrence({ frequency: 'daily', startDate: '2026-12-30', until: '2027-01-01' }).dates).toEqual(['2026-12-30', '2026-12-31', '2027-01-01'])
  expect(expandRecurrence({ frequency: 'weekdays', startDate: '2026-10-03', until: '2026-10-07' }).dates).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
  expect(expandRecurrence({ frequency: 'weekly', startDate: '2026-12-28', until: '2027-01-11' }).dates).toEqual(['2026-12-28', '2027-01-04', '2027-01-11'])
  const monthly = expandRecurrence({ frequency: 'monthly', startDate: '2024-01-31', until: '2024-05-31' })
  expect(monthly.dates).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31'])
  expect(monthly.adjustments).toEqual([{ requested: '2024-02-31', actual: '2024-02-29' }, { requested: '2024-04-31', actual: '2024-04-30' }])
  expect(expandRecurrence({ frequency: 'yearly', startDate: '2024-02-29', until: '2028-02-29' }).dates).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  expect(expandRecurrence({ frequency: 'monthly', startDate: '2026-02-28', anchorDate: '2026-01-31', until: '2026-04-30' }).dates).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  expect(expandRecurrence({ frequency: 'yearly', startDate: '2025-02-28', anchorDate: '2024-02-29', until: '2028-02-29' }).dates).toEqual(['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  expect(expandRecurrence({ frequency: 'yearly', startDate: '0096-02-29', until: '0100-03-01' }).dates).toEqual(['0096-02-29', '0097-02-28', '0098-02-28', '0099-02-28', '0100-02-28'])
  expect(expandRecurrence({ frequency: 'daily', startDate: '9999-12-31', until: '9999-12-31' }).dates).toEqual(['9999-12-31'])
  expect(expandRecurrence({ frequency: 'daily', startDate: '2024-01-01', until: '2024-12-31' }).dates).toHaveLength(MAX_RECURRENCE_OCCURRENCES)
  for (const rule of [null, {}, { frequency: 'custom', startDate: '2026-01-01', until: '2026-01-02' },
    { frequency: 'daily', startDate: '2026-02-29', until: '2026-03-01' },
    { frequency: 'daily', startDate: '0000-01-01', until: '0001-01-01' },
    { frequency: 'daily', startDate: '2026-01-01' },
    { frequency: 'daily', startDate: '2026-01-02', until: '2026-01-01' },
    { frequency: 'weekdays', startDate: '2026-10-03', until: '2026-10-04' },
    { frequency: 'daily', startDate: '2024-01-01', until: '2025-01-01' }]) expect(() => expandRecurrence(rule)).toThrow()
})

test('重复事项 API：生成上限、原子并发保护、删除例外不复活与项目级联', async ({ space }) => {
  const project = await space.project('周期原子性')
  const movedProject = await space.project('单次迁移项目')
  const input: EntryInput = { projectId: project.id, title: '周期原子任务', date: '2024-01-01', description: '', completed: false, references: [],
    recurrence: { frequency: 'daily', startDate: '2024-01-01', until: '2025-01-01' } }
  expect((await space.api.post('/api/entries', { data: input })).status()).toBe(400)
  expect((await space.agenda()).entries).toHaveLength(0)
  expect((await space.api.post('/api/entries', { data: { ...input, recurrence: { ...input.recurrence, until: '2024-12-31' } } })).status()).toBe(201)
  let rows = (await space.agenda()).entries
  expect(rows).toHaveLength(MAX_RECURRENCE_OCCURRENCES)
  const first = rows[0]!
  const concurrent = await Promise.all(['并发 A', '并发 B'].map(title => space.api.put(`/api/entries/${first.id}`, {
    data: { ...inputFor(first), title, scope: 'all' },
  })))
  expect(concurrent.map(response => response.status()).sort()).toEqual([200, 409])
  rows = (await space.agenda()).entries
  expect(new Set(rows.map(entry => entry.title)).size).toBe(1)
  const reference = await space.entry(project.id, '366 次批量引用目标', null)
  expect((await space.api.put(`/api/entries/${rows[0]!.id}`, { data: { ...inputFor(rows[0]!), scope: 'all', references: [reference] } })).status()).toBe(200)
  rows = (await space.agenda()).entries.filter(entry => entry.recurrence)
  expect(rows.every(entry => entry.references[0] === reference)).toBe(true)
  expect((await space.api.delete(`/api/entries/${reference}`)).status()).toBe(200)
  rows = (await space.agenda()).entries
  expect((await space.api.delete(`/api/entries/${rows[0]!.id}`, { data: { scope: 'all', seriesVersion: rows[0]!.recurrence!.version } })).status()).toBe(200)
  const small = { ...input, date: '2026-10-01', recurrence: { frequency: 'daily', startDate: '2026-10-01', until: '2026-10-03' } }
  expect((await space.api.post('/api/entries', { data: small })).status()).toBe(201)
  rows = (await space.agenda()).entries
  const deleted = rows[1]!
  expect((await space.api.delete(`/api/entries/${deleted.id}`, { data: { scope: 'single', seriesVersion: deleted.recurrence!.version } })).status()).toBe(200)
  rows = (await space.agenda()).entries
  expect((await space.api.put(`/api/entries/${rows[0]!.id}`, { data: { ...inputFor(rows[0]!), scope: 'all', recurrence: { ...small.recurrence, until: '2026-10-04' } } })).status()).toBe(200)
  rows = (await space.agenda()).entries
  expect(rows.map(entry => entry.date)).toEqual(['2026-10-01', '2026-10-03', '2026-10-04'])
  const moved = rows[1]!
  expect((await space.api.put(`/api/entries/${moved.id}`, { data: { ...inputFor(moved), projectId: movedProject.id } })).status()).toBe(200)
  const previousVersion = (await space.agenda()).entries.find(entry => entry.id === moved.id)!.recurrence!.version
  expect((await space.api.delete(`/api/projects/${project.id}`)).status()).toBe(200)
  rows = (await space.agenda()).entries
  expect(rows.map(entry => entry.id)).toEqual([moved.id])
  expect(rows[0]!.recurrence!.version).toBeGreaterThan(previousVersion)
  expect((await space.api.put(`/api/entries/${moved.id}`, { data: { ...inputFor(rows[0]!), scope: 'all', recurrence: { ...small.recurrence, until: '2026-10-05' } } })).status()).toBe(200)
  expect((await space.agenda()).entries.map(entry => entry.date)).toEqual(['2026-10-03', '2026-10-05'])
})

const inputFor = (entry: Entry): EntryInput => ({ ...entry, recurrence: entry.recurrence?.rule, seriesVersion: entry.recurrence?.version })

test('重复事项 API：创建确认、幂等重试、附件引用、版本冲突与三种删除范围', async ({ space, otherSpace }) => {
  const project = await space.project('周期 API')
  const reference = await space.entry(project.id, '引用目标', null)
  const asset = await space.api.post('/api/assets', { data: Buffer.from('repeat attachment'), headers: { 'X-File-Name': 'repeat.txt', 'Content-Type': 'text/plain' } })
  const assetId = (await asset.json()).id as string
  const requestId = crypto.randomUUID()
  const input: EntryInput = { projectId: project.id, title: '月末复盘', date: '2026-01-31', description: '重复正文', completed: false, references: [reference], assetIds: [assetId],
    recurrence: { frequency: 'monthly', startDate: '2026-01-31', until: '2026-04-30' }, requestId }
  const before = await space.agenda()
  expect((await space.api.post('/api/entries', { data: input })).status()).toBe(409)
  expect(await space.agenda()).toEqual(before)
  expect((await space.api.post('/api/entries', { data: { ...input, acknowledgeAdjustments: true } })).status()).toBe(201)
  expect((await space.api.post('/api/entries', { data: { ...input, acknowledgeAdjustments: true } })).status()).toBe(201)
  let rows = (await space.agenda()).entries.filter(entry => entry.recurrence)
  expect(rows.map(entry => entry.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  expect(rows.every(entry => entry.assetIds[0] === assetId && entry.references[0] === reference)).toBe(true)
  expect((await otherSpace.api.put(`/api/entries/${requestId}`, { data: input })).status()).toBe(404)
  expect((await space.api.patch(`/api/entries/${rows[1]!.id}`, { data: { completed: true } })).status()).toBe(200)
  expect((await space.api.put(`/api/entries/${rows[0]!.id}`, { data: { ...inputFor(rows[0]!), title: '过期修改', scope: 'all', acknowledgeAdjustments: true } })).status()).toBe(409)
  rows = (await space.agenda()).entries.filter(entry => entry.recurrence)
  const current = rows[2]!
  expect((await space.api.delete(`/api/entries/${current.id}`, { data: { scope: 'single', seriesVersion: current.recurrence!.version } })).status()).toBe(200)
  rows = (await space.agenda()).entries.filter(entry => entry.recurrence)
  expect(rows).toHaveLength(3)
  expect(rows.find(entry => entry.date === '2026-02-28')?.completed).toBe(true)
  const following = rows[1]!
  expect((await space.api.delete(`/api/entries/${following.id}`, { data: { scope: 'following', seriesVersion: following.recurrence!.version } })).status()).toBe(200)
  rows = (await space.agenda()).entries.filter(entry => entry.recurrence)
  expect(rows).toHaveLength(1)
  expect((await space.api.delete(`/api/entries/${rows[0]!.id}`, { data: { scope: 'all', seriesVersion: rows[0]!.recurrence!.version } })).status()).toBe(200)
  expect((await space.agenda()).entries.map(entry => entry.id)).toEqual([reference])
  expect((await space.agenda()).assets[0]?.usageCount).toBe(0)
})

test('重复事项 API：范围编辑、单次例外、规则重排与完成记录保留', async ({ space }) => {
  const project = await space.project('周期范围')
  const create = { projectId: project.id, title: '每日任务', date: '2026-10-01', description: '', completed: false, references: [],
    recurrence: { frequency: 'daily' as const, startDate: '2026-10-01', until: '2026-10-05' } }
  expect((await space.api.post('/api/entries', { data: create })).status()).toBe(201)
  let rows = (await space.agenda()).entries
  const exceptionId = rows[1]!.id
  expect((await space.api.put(`/api/entries/${exceptionId}`, { data: { ...inputFor(rows[1]!), title: '本次例外', date: null } })).status()).toBe(200)
  rows = (await space.agenda()).entries.sort((a, b) => a.recurrence!.scheduledDate.localeCompare(b.recurrence!.scheduledDate))
  const completedId = rows[2]!.id
  expect((await space.api.patch(`/api/entries/${completedId}`, { data: { completed: true } })).status()).toBe(200)
  rows = (await space.agenda()).entries.sort((a, b) => a.recurrence!.scheduledDate.localeCompare(b.recurrence!.scheduledDate))
  expect((await space.api.put(`/api/entries/${rows[3]!.id}`, { data: { ...inputFor(rows[3]!), title: '后续改名', scope: 'following' } })).status()).toBe(200)
  rows = (await space.agenda()).entries.sort((a, b) => a.recurrence!.scheduledDate.localeCompare(b.recurrence!.scheduledDate))
  expect(rows.map(entry => entry.title)).toEqual(['每日任务', '本次例外', '每日任务', '后续改名', '后续改名'])
  const first = rows[0]!
  expect((await space.api.put(`/api/entries/${first.id}`, { data: { ...inputFor(first), title: '整个系列改名', scope: 'all', recurrence: { ...create.recurrence, frequency: 'weekly', until: '2026-10-15' } } })).status()).toBe(200)
  rows = (await space.agenda()).entries
  expect(rows.find(entry => entry.id === completedId)).toMatchObject({ completed: true })
  expect(rows.find(entry => entry.id === completedId)?.recurrence).toBeUndefined()
  expect(rows.find(entry => entry.id === exceptionId)).toMatchObject({ title: '本次例外', date: null })
  expect(rows.filter(entry => entry.recurrence).map(entry => entry.date)).toEqual(['2026-10-01', '2026-10-08', '2026-10-15'])
  const last = rows.find(entry => entry.date === '2026-10-08')!
  expect((await space.api.put(`/api/entries/${last.id}`, { data: { ...inputFor(last), title: '拆分后的任务', scope: 'following', recurrence: { frequency: 'daily', startDate: '2026-10-08', until: '2026-10-10' } } })).status()).toBe(200)
  rows = (await space.agenda()).entries
  expect(rows.find(entry => entry.id === first.id)?.recurrence?.rule.until).toBe('2026-10-07')
  expect(rows.filter(entry => entry.recurrence?.seriesId !== first.recurrence?.seriesId && entry.recurrence).map(entry => entry.date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10'])
})
