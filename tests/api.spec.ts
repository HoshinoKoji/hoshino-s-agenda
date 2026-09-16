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
    { title: '   ', description: '有描述仍须填写标题' },
  ]) {
    const response = await space.api.put(`/api/entries/${first}`, { data: { ...input, ...invalid } })
    expect(response.status()).toBe(400)
    expect(await space.agenda()).toEqual(before)
  }
  expect((await space.api.post('/api/entries', { data: { ...input, projectId: foreignProject.id } })).status()).toBe(404)
  expect((await space.api.post('/api/projects', { data: { name: '项目', color: 'red' } })).status()).toBe(400)
  expect((await space.api.post('/api/projects', { data: 'not json', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400)
  expect((await space.api.post('/api/projects', { data: 'text' })).status()).toBe(415)
  expect((await space.api.post('/api/projects', { data: { name: 'x'.repeat(65_536) } })).status()).toBe(413)
  expect((await request.get('http://127.0.0.1:8787/api/agenda')).status()).toBe(400)
})

test('支持 50 个引用，替换和清空引用时保持事项数据完整', async ({ space }) => {
  const project = await space.project('引用边界')
  const targets: string[] = []
  for (let index = 0; index < 50; index++) {
    targets.push(await space.entry(project.id, `目标 ${index}`, '2026-09-13'))
  }
  const source = await space.entry(project.id, '引用汇总', '2026-09-14', targets, '\u0000'.repeat(4000))
  let agenda = await space.agenda()
  const original = agenda.entries.find(entry => entry.id === source)!
  expect(original.references).toEqual([...targets].sort())
  expect(original.completed).toBe(false)
  expect(original.description).toBe('\u0000'.repeat(4000))

  for (const references of [[targets[0]], []]) {
    const input = { projectId: project.id, title: '更新汇总', date: '2026-09-15', completed: true, references }
    expect((await space.api.put(`/api/entries/${source}`, { data: input })).status()).toBe(200)
    agenda = await space.agenda()
    expect(agenda.entries.find(entry => entry.id === source)).toEqual({
      id: source, ...input, description: '', createdAt: original.createdAt, updatedAt: expect.any(String),
    })
    expect(agenda.entries.filter(entry => entry.id !== source)).toHaveLength(50)
  }
})

test('描述缺省、空白、多行与 UTF-16 边界往返，PUT 修改及清空，拒绝输入保持数据不变', async ({ space }) => {
  const project = await space.project('描述边界')
  const target = await space.entry(project.id, '引用目标', '2026-09-13')
  const source = await space.entry(project.id, '必填标题', '2026-09-13', [target])
  const input = { projectId: project.id, title: '必填标题', date: '2026-09-13', completed: false, references: [target] }
  const current = async () => (await space.agenda()).entries.find(entry => entry.id === source)!
  expect((await current()).description).toBe('')
  for (const description of ['', '  \n\t \r\n末尾  ', '<b>字面 HTML</b>\n**Markdown**', '😀'.repeat(2000), '\u0000'.repeat(4000)]) {
    const created = await space.entry(project.id, '往返', '2026-09-14', [], description)
    expect((await space.agenda()).entries.find(entry => entry.id === created)?.description).toBe(description)
    const response = await space.api.put(`/api/entries/${source}`, { data: { ...input, description } })
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ id: source, description })
    expect(await current()).toMatchObject({ description, references: [target] })
  }
  const before = await space.agenda()
  for (const description of [null, 42, false, [], {}, 'x'.repeat(4001), '😀'.repeat(2000) + 'x']) {
    for (const [method, path] of [['POST', '/api/entries'], ['PUT', `/api/entries/${source}`]] as const) {
      expect((await space.api.fetch(path, { method, data: { ...input, title: '不得写入', description, references: [] } })).status()).toBe(400)
      expect(await space.agenda()).toEqual(before)
    }
  }
  expect((await space.api.patch(`/api/entries/${source}`, { data: { completed: true } })).status()).toBe(200)
  expect((await current()).description).toBe('\u0000'.repeat(4000))
  expect((await space.api.put(`/api/entries/${source}`, { data: input })).status()).toBe(200)
  expect(await current()).toMatchObject({ description: '', references: [target] })
})

test('请求体按实际 UTF-8 字节限制到 64KiB（含无 Content-Length 的流式请求）', async ({ space }) => {
  const project = await space.project('请求边界')
  const source = await space.entry(project.id, '边界记录', '2026-09-13')
  const input = { projectId: project.id, title: '边界记录', description: '中文😀', date: '2026-09-13', completed: false, references: [] }
  const json = JSON.stringify(input)
  // JSON trailing whitespace keeps the input valid without conflating field and body limits.
  for (const size of [65_535, 65_536, 65_537]) {
    const before = await space.agenda()
    const data = json + ' '.repeat(size - Buffer.byteLength(json))
    expect(Buffer.byteLength(data)).toBe(size)
    for (const streamed of [false, true]) {
      const response = streamed
        ? await fetch(`http://127.0.0.1:8787/api/entries/${source}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-User-Email': space.email },
            body: new ReadableStream({ start(controller) {
              const bytes = new TextEncoder().encode(data)
              controller.enqueue(bytes.slice(0, 32_768))
              controller.enqueue(bytes.slice(32_768))
              controller.close()
            } }), duplex: 'half',
          } as RequestInit & { duplex: 'half' })
        : await space.api.put(`/api/entries/${source}`, { data, headers: { 'Content-Type': 'application/json' } })
      expect(typeof response.status === 'function' ? response.status() : response.status).toBe(size > 65_536 ? 413 : 200)
      if (size > 65_536) expect(await space.agenda()).toEqual(before)
      else expect((await space.agenda()).entries[0]?.description).toBe(input.description)
    }
  }
})

test('同源请求可预检及读写，未允许的跨域来源被拒绝', async ({ space }) => {
  const origin = 'http://127.0.0.1:8787'
  const response = await space.api.fetch('/api/agenda', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Headers': 'x-user-email,content-type' } })
  expect(response.status()).toBe(204)
  expect(response.headers()['access-control-allow-origin']).toBe(origin)
  expect(response.headers()['access-control-allow-headers']).toContain('X-User-Email')
  const agenda = await space.api.get('/api/agenda', { headers: { Origin: origin } })
  expect(agenda.status()).toBe(200)
  expect(agenda.headers()['cache-control']).toBe('no-store')
  expect(agenda.headers()['vary']).toBe('Origin')
  expect((await space.api.post('/api/projects', {
    headers: { Origin: origin }, data: { name: '同源写入', color: PROJECT_COLORS[0] },
  })).status()).toBe(201)
  expect((await space.api.get('/api/agenda', { headers: { Origin: 'https://unlisted.example.com' } })).status()).toBe(403)
})
