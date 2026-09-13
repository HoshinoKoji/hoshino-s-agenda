import { test, expect } from './fixtures'
import { PROJECT_COLORS } from '../shared/types'

test('项目与事项 CRUD、跨项目/日期互相引用、两端级联清理', async ({ space }) => {
  const project = await space.project('  个人网站  ')
  const reading = await space.project('阅读计划', PROJECT_COLORS[1])
  expect(project.name).toBe('个人网站')
  const first = await space.entry(project.id, '设计首页', '2026-09-13')
  const second = await space.entry(reading.id, '整理灵感', '2026-10-02', [first])
  const update = { projectId: project.id, title: '完成首页设计', date: '2026-09-14', completed: true, references: [second, second] }
  expect((await space.api.put(`/api/entries/${first}`, { data: update })).status()).toBe(200)
  let agenda = await space.agenda()
  expect(agenda.entries.find(entry => entry.id === first)).toMatchObject({ ...update, references: [second] })
  expect(agenda.entries.find(entry => entry.id === second)?.references).toEqual([first])

  expect((await space.api.patch(`/api/entries/${first}`, { data: { completed: false } })).status()).toBe(200)
  expect((await space.api.put(`/api/projects/${project.id}`, { data: { name: '新网站', color: PROJECT_COLORS[2] } })).status()).toBe(200)
  agenda = await space.agenda()
  expect(agenda.projects.find(item => item.id === project.id)).toMatchObject({ name: '新网站', color: PROJECT_COLORS[2] })
  expect(agenda.entries.find(entry => entry.id === first)).toMatchObject({ completed: false, references: [second] })

  expect((await space.api.delete(`/api/entries/${first}`)).status()).toBe(200)
  expect((await space.agenda()).entries).toEqual([expect.objectContaining({ id: second, references: [] })])

  const third = await space.entry(project.id, '下一版首页', '2026-11-01', [second])
  expect((await space.api.put(`/api/entries/${second}`, { data: { projectId: reading.id, title: '整理灵感', date: '2026-10-02', completed: false, references: [third] } })).ok()).toBeTruthy()
  expect((await space.api.delete(`/api/projects/${project.id}`)).status()).toBe(200)
  agenda = await space.agenda()
  expect(agenda.projects).toEqual([reading])
  expect(agenda.entries).toEqual([expect.objectContaining({ id: second, references: [] })])
})

test('邮箱归一化与读写隔离，拒绝无效引用且保留原记录', async ({ space, otherSpace, request }) => {
  const project = await space.project('自己的项目')
  const first = await space.entry(project.id, '自己的事项', '2026-09-13')
  const foreignProject = await otherSpace.project('另一空间')
  const foreignEntry = await otherSpace.entry(foreignProject.id, '另一空间事项', '2026-09-15')
  const normalized = await request.get('http://127.0.0.1:8787/api/agenda', { headers: { 'X-User-Email': `  ${space.email.toUpperCase()}  ` } })
  expect(await normalized.json()).toEqual(await space.agenda())
  expect((await otherSpace.agenda()).entries.map(entry => entry.id)).toEqual([foreignEntry])

  const input = { projectId: project.id, title: '自己的事项', date: '2026-09-13', completed: false, references: [] }
  for (const [method, path, data] of [
    ['PUT', `/api/projects/${project.id}`, { name: '越界修改', color: PROJECT_COLORS[0] }],
    ['DELETE', `/api/projects/${project.id}`, undefined],
    ['PUT', `/api/entries/${first}`, input],
    ['PATCH', `/api/entries/${first}`, { completed: true }],
    ['DELETE', `/api/entries/${first}`, undefined],
    ['POST', '/api/entries', input],
  ] as const) {
    expect((await otherSpace.api.fetch(path, { method, data })).status()).toBe(404)
  }
  const before = await space.agenda()
  for (const invalid of [
    { references: [first] },
    { references: [foreignEntry] },
    { references: ['missing-entry'] },
    { references: Array(51).fill(foreignEntry) },
    { date: '2026-02-30' },
    { completed: 'true' },
    { title: '   ' },
  ]) {
    const response = await space.api.put(`/api/entries/${first}`, { data: { ...input, ...invalid } })
    expect(response.status()).toBe(400)
    expect(await space.agenda()).toEqual(before)
  }
  expect((await space.api.post('/api/entries', { data: { ...input, projectId: foreignProject.id } })).status()).toBe(404)
  expect((await space.api.post('/api/projects', { data: { name: '项目', color: 'red' } })).status()).toBe(400)
  expect((await space.api.post('/api/projects', { data: 'not json', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400)
  expect((await space.api.post('/api/projects', { data: 'text' })).status()).toBe(415)
  expect((await space.api.post('/api/projects', { data: { name: 'x'.repeat(17_000) } })).status()).toBe(413)
  expect((await request.get('http://127.0.0.1:8787/api/agenda')).status()).toBe(400)
})

test('支持 50 个引用，替换和清空引用时保持事项数据完整', async ({ space }) => {
  const project = await space.project('引用边界')
  const targets: string[] = []
  for (let index = 0; index < 50; index++) {
    targets.push(await space.entry(project.id, `目标 ${index}`, '2026-09-13'))
  }
  const source = await space.entry(project.id, '引用汇总', '2026-09-14', targets)
  let agenda = await space.agenda()
  const original = agenda.entries.find(entry => entry.id === source)!
  expect(original.references).toEqual([...targets].sort())
  expect(original.completed).toBe(false)

  for (const references of [[targets[0]], []]) {
    const input = { projectId: project.id, title: '更新汇总', date: '2026-09-15', completed: true, references }
    expect((await space.api.put(`/api/entries/${source}`, { data: input })).status()).toBe(200)
    agenda = await space.agenda()
    expect(agenda.entries.find(entry => entry.id === source)).toEqual({
      id: source, ...input, createdAt: original.createdAt, updatedAt: expect.any(String),
    })
    expect(agenda.entries.filter(entry => entry.id !== source)).toHaveLength(50)
  }
})

test('允许的来源可预检及读取，未允许的来源被拒绝', async ({ space }) => {
  const response = await space.api.fetch('/api/agenda', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:3000', 'Access-Control-Request-Headers': 'x-user-email,content-type' } })
  expect(response.status()).toBe(204)
  expect(response.headers()['access-control-allow-origin']).toBe('http://127.0.0.1:3000')
  expect(response.headers()['access-control-allow-headers']).toContain('X-User-Email')
  const agenda = await space.api.get('/api/agenda', { headers: { Origin: 'http://localhost:3000' } })
  expect(agenda.status()).toBe(200)
  expect(agenda.headers()['cache-control']).toBe('no-store')
  expect(agenda.headers()['vary']).toBe('Origin')
  expect((await space.api.get('/api/agenda', { headers: { Origin: 'https://unlisted.example.com' } })).status()).toBe(403)
})
