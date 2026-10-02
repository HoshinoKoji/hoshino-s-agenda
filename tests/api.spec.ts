import { test, expect } from './fixtures'
import { DESCRIPTION_MAX_LENGTH, JSON_BODY_MAX_BYTES, PROJECT_COLORS } from '../shared/types'
import { samplePng } from './image'
import { apiURL } from './environment'
import { MAX_CIPHERTEXT_BYTES, decryptDescription, decryptDescriptionWithKey, encryptDescription, encryptDescriptionWithKey, isEncryptedDescription } from '../shared/encryption'

test('描述加密无损往返、独立随机盐与 IV、错误密码和篡改拒绝', async () => {
  const password = '  独立密码 😀  '
  for (const description of ['', ' \n\t\r\n**正文** 😀\u0000\ud800  ', '\u0000'.repeat(4000),
    '汉'.repeat(DESCRIPTION_MAX_LENGTH), '\u0000'.repeat(DESCRIPTION_MAX_LENGTH),
    '\ud800'.repeat(DESCRIPTION_MAX_LENGTH), '😀'.repeat(DESCRIPTION_MAX_LENGTH / 2)]) {
    const { encryptedDescription, key } = await encryptDescription(description, password)
    expect(isEncryptedDescription(encryptedDescription)).toBe(true)
    expect(Buffer.from(encryptedDescription.ciphertext, 'base64')).toHaveLength(Buffer.byteLength(JSON.stringify(description)) + 16)
    expect((await decryptDescription(encryptedDescription, password)).description).toBe(description)
    const clonedKey = structuredClone(key)
    expect(clonedKey.extractable).toBe(false)
    expect((await decryptDescriptionWithKey(encryptedDescription, clonedKey)).description).toBe(description)
    await expect(crypto.subtle.exportKey('raw', clonedKey)).rejects.toThrow()
    const again = await encryptDescriptionWithKey(description, key, encryptedDescription.salt)
    expect(again.iv).not.toBe(encryptedDescription.iv)
    expect((await decryptDescription(again, password)).description).toBe(description)
  }
  const first = (await encryptDescription('秘密', password)).encryptedDescription
  const second = (await encryptDescription('秘密', password)).encryptedDescription
  expect(first.salt).not.toBe(second.salt)
  expect(first.ciphertext).not.toBe(second.ciphertext)
  await expect(decryptDescription(first, '错误的密码123')).rejects.toThrow('密码错误或加密描述已损坏')
  const tampered = { ...first, ciphertext: (first.ciphertext[0] === 'A' ? 'B' : 'A') + first.ciphertext.slice(1) }
  await expect(decryptDescription(tampered, password)).rejects.toThrow('密码错误或加密描述已损坏')
  const unrelatedKey = (await encryptDescription('另一个事项', password)).key
  await expect(decryptDescriptionWithKey(first, unrelatedKey)).rejects.toThrow('密码错误或加密描述已损坏')
  await expect(decryptDescriptionWithKey(first, {} as CryptoKey)).rejects.toThrow('解密密钥无效')
  const extractableKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['decrypt'])
  await expect(decryptDescriptionWithKey(first, extractableKey)).rejects.toThrow('解密密钥无效')
  await expect(encryptDescription('x'.repeat(DESCRIPTION_MAX_LENGTH + 1), password)).rejects.toThrow(String(DESCRIPTION_MAX_LENGTH))
  await expect(encryptDescription('秘密', '短密码')).rejects.toThrow('8–256')
})

test('加密描述仅存密文、格式与旧客户端保护、锁定保存和显式取消加密', async ({ space, otherSpace }) => {
  const project = await space.project('加密项目')
  const target = await space.entry(project.id, '引用目标', null)
  const description = `**私密正文** @[引用目标](item:${target})`.padEnd(DESCRIPTION_MAX_LENGTH, '\u0000')
  const { encryptedDescription } = await encryptDescription(description, '每个事项独立密码')
  const input = { projectId: project.id, title: '标题仍可见', date: null, completed: false, references: [target], encryptedDescription }
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(65_536)
  const response = await space.api.post('/api/entries', { data: input })
  expect(response.status()).toBe(201)
  const { id } = await response.json()
  const current = async () => (await space.agenda()).entries.find(entry => entry.id === id)!
  expect(await current()).toMatchObject({ description: '', encryptedDescription, references: [target] })
  expect(JSON.stringify(await space.agenda())).not.toContain('私密正文')
  expect((await otherSpace.api.put(`/api/entries/${id}`, { data: input })).status()).toBe(404)
  for (const changes of [{ completed: true }, { date: '2026-10-02' }]) {
    expect((await space.api.patch(`/api/entries/${id}`, { data: changes })).status()).toBe(200)
    expect((await current()).encryptedDescription).toEqual(encryptedDescription)
  }
  const { encryptedDescription: _, ...oldInput } = input
  const before = await space.agenda()
  expect((await space.api.put(`/api/entries/${id}`, { data: { ...oldInput, description: '旧客户端不得覆盖' } })).status()).toBe(409)
  expect(await space.agenda()).toEqual(before)
  const invalid = [false, '', [], {}, { ...encryptedDescription, version: 2 }, { ...encryptedDescription, iv: 'abc' },
    { ...encryptedDescription, salt: 'A'.repeat(24) },
    { ...encryptedDescription, ciphertext: 'AAAA'.repeat(Math.ceil((MAX_CIPHERTEXT_BYTES + 1) / 3)) },
    { ...encryptedDescription, ciphertext: '!' + 'A'.repeat(23) },
    { ...encryptedDescription, ciphertext: 'A'.repeat(24) + '\n   ' },
    { ...encryptedDescription, ciphertext: 'A'.repeat(25) + 'B==' },
    { ...encryptedDescription, ciphertext: 'AA='.repeat(8) },
    { ...encryptedDescription, extra: '拒绝未知格式' }]
  for (const payload of invalid) {
    for (const [method, path] of [['POST', '/api/entries'], ['PUT', `/api/entries/${id}`]] as const) {
      expect((await space.api.fetch(path, { method, data: { ...input, encryptedDescription: payload } })).status()).toBe(400)
      expect(await space.agenda()).toEqual(before)
    }
  }
  expect((await space.api.put(`/api/entries/${id}`, { data: { ...input, description: '不得同时提交明文' } })).status()).toBe(400)
  expect(await space.agenda()).toEqual(before)
  expect((await space.api.put(`/api/entries/${id}`, { data: { ...input, description } })).status()).toBe(413)
  expect(await space.agenda()).toEqual(before)
  expect((await space.api.put(`/api/entries/${id}`, { data: { ...input, title: '锁定时改标题' } })).status()).toBe(200)
  expect((await current()).encryptedDescription).toEqual(encryptedDescription)
  expect((await space.api.put(`/api/entries/${id}`, { data: { ...input, encryptedDescription: null, description } })).status()).toBe(200)
  expect(await current()).toMatchObject({ description, references: [target] })
  expect((await current()).encryptedDescription).toBeUndefined()
})

test('R2 素材上传、事项复用、私有下载与被引用时拒绝删除', async ({ space, otherSpace }) => {
  const project = await space.project('素材项目')
  const png = samplePng()
  const upload = (name: string, contentType: string, data: Buffer) => space.api.post('/api/assets', {
    headers: { 'X-File-Name': encodeURIComponent(name), 'Content-Type': contentType }, data,
  })
  const pictureResponse = await upload('小图.png', 'image/png', png)
  expect(pictureResponse.status()).toBe(201)
  const picture = await pictureResponse.json()
  expect(picture).toMatchObject({ name: '小图.png', image: true, size: png.length, usageCount: 0 })
  const doc = await (await upload('说明.pdf', 'application/pdf', Buffer.from('%PDF-1.7\nhello'))).json()
  expect(doc).toMatchObject({ contentType: 'application/pdf', image: false })
  const image = await space.api.get(`/api/assets/${picture.id}/content`)
  expect(image.headers()['content-type']).toContain('image/png')
  expect(Buffer.from(await image.body())).toEqual(png)
  const thumbnail = await space.api.get(`/api/assets/${picture.id}/thumbnail`)
  expect(thumbnail.status()).toBe(200)
  expect(thumbnail.headers()['content-type']).toContain('image/webp')
  const thumbBytes = Buffer.from(await thumbnail.body())
  expect(thumbBytes.subarray(0, 4).toString()).toBe('RIFF')
  expect(thumbBytes.length).toBeLessThan(png.length)
  expect(Buffer.from(await (await space.api.get(`/api/assets/${picture.id}/thumbnail`)).body())).toEqual(thumbBytes)
  expect((await otherSpace.api.get(`/api/assets/${picture.id}/thumbnail`)).status()).toBe(404)
  expect((await otherSpace.api.get(`/api/assets/${picture.id}/content`)).status()).toBe(404)
  expect((await otherSpace.api.delete(`/api/assets/${picture.id}`)).status()).toBe(404)
  const download = await space.api.get(`/api/assets/${doc.id}/content`)
  expect(download.headers()['content-type']).toContain('application/octet-stream')
  expect(download.headers()['content-disposition']).toContain('attachment')
  expect((await space.api.get(`/api/assets/${doc.id}/thumbnail`)).status()).toBe(404)
  expect((await otherSpace.api.patch(`/api/assets/${picture.id}`, { data: { name: '越权.png' } })).status()).toBe(404)
  for (const name of ['', '  ', '../bad.png', 'bad\\name.png', 'x'.repeat(256), null, 1]) {
    expect((await space.api.patch(`/api/assets/${picture.id}`, { data: { name } })).status()).toBe(400)
  }
  expect((await space.api.patch(`/api/assets/${picture.id}`, { data: { name: '  新图.png  ' } })).status()).toBe(200)
  expect((await space.agenda()).assets.find(asset => asset.id === picture.id)?.name).toBe('新图.png')
  expect((await space.api.get(`/api/assets/${picture.id}/content`)).headers()['content-disposition']).toContain(encodeURIComponent('新图.png'))
  expect(Buffer.from(await (await space.api.get(`/api/assets/${picture.id}/content`)).body())).toEqual(png)
  const first = await space.entry(project.id, '第一件', null)
  const second = await space.entry(project.id, '第二件', '2026-09-24')
  const item = (id: string, assetIds: unknown) => space.api.put(`/api/entries/${id}`, {
    data: { title: '关联素材', projectId: project.id, date: null, completed: false, references: [], assetIds },
  })
  expect((await item(first, [picture.id, doc.id])).ok()).toBe(true)
  expect((await item(second, [picture.id])).ok()).toBe(true)
  expect((await space.agenda()).assets.find(asset => asset.id === picture.id)?.usageCount).toBe(2)
  const before = await space.agenda()
  expect((await item(first, [picture.id, picture.id])).status()).toBe(200)
  expect((await item(first, [picture.id, 'missing'])).status()).toBe(400)
  expect((await otherSpace.api.post('/api/entries', { data: {
    title: '跨邮箱', projectId: (await otherSpace.project('其他')).id, date: null, completed: false,
    references: [], assetIds: [picture.id],
  } })).status()).toBe(400)
  expect((await space.api.delete(`/api/assets/${picture.id}`)).status()).toBe(409)
  expect((await space.agenda()).entries.find(entry => entry.id === first)?.assetIds).toEqual([picture.id])
  expect((await space.api.patch(`/api/entries/${first}`, { data: { completed: true } })).ok()).toBe(true)
  expect((await space.agenda()).entries.find(entry => entry.id === first)?.assetIds).toEqual([picture.id])
  expect((await item(first, [])).ok()).toBe(true)
  expect((await space.api.delete(`/api/entries/${second}`)).ok()).toBe(true)
  expect((await space.api.delete(`/api/assets/${picture.id}`)).ok()).toBe(true)
  expect((await space.api.get(`/api/assets/${picture.id}/content`)).status()).toBe(404)
  expect((await space.api.get(`/api/assets/${picture.id}/thumbnail`)).status()).toBe(404)
  expect((await space.agenda()).assets.find(asset => asset.id === picture.id)).toBeUndefined()
  expect(before.assets).toHaveLength(2)
  expect((await upload('伪图片.png', 'image/png', Buffer.from('not-a-png'))).status()).toBe(201)
  const falseImage = (await space.agenda()).assets.find(asset => asset.name === '伪图片.png')!
  expect(falseImage.image).toBe(false)
  expect((await space.api.get(`/api/assets/${falseImage.id}/content`)).headers()['content-disposition']).toContain('attachment')
  const broken = await (await upload('损坏.png', 'image/png', Buffer.concat([png.subarray(0, 8), Buffer.from('invalid')]))).json()
  expect(broken.image).toBe(true)
  expect((await space.api.get(`/api/assets/${broken.id}/thumbnail`)).status()).toBe(422)
  expect((await upload('空文件', 'text/plain', Buffer.alloc(0))).status()).toBe(400)
  expect((await upload('大图.png', 'image/png', Buffer.concat([png.subarray(0, 8), Buffer.alloc(20_000_000 - 7)]))).status()).toBe(413)
  expect((await upload('太大.bin', 'application/octet-stream', Buffer.alloc(20 * 1024 * 1024 + 1))).status()).toBe(413)
})

test('项目排序持久化、追加、编辑保序与无效请求隔离', async ({ space, otherSpace }) => {
  const a = await space.project('甲')
  const b = await space.project('乙')
  const c = await space.project('丙')
  const foreign = await otherSpace.project('其他空间')
  const original = [a.id, b.id, c.id]
  const ordered = [c.id, a.id, b.id]
  const order = (projectIds: unknown, previousIds: unknown = original) => space.api.put('/api/projects/order', { data: { projectIds, previousIds } })
  expect((await order(ordered)).status()).toBe(200)
  expect((await space.agenda()).projects.map(project => project.id)).toEqual(ordered)
  const before = await space.agenda()
  for (const invalid of [[a.id, a.id, b.id], [a.id], [a.id, b.id, foreign.id], null, 'invalid', [123]]) {
    expect((await order(invalid, ordered)).status()).toBe(400)
    expect(await space.agenda()).toEqual(before)
  }
  expect((await order(original)).status()).toBe(409)
  expect((await otherSpace.api.put('/api/projects/order', { data: { projectIds: ordered, previousIds: ordered } })).status()).toBe(400)
  expect((await otherSpace.agenda()).projects).toEqual([foreign])
  await space.api.put(`/api/projects/${a.id}`, { data: { name: '改名', color: a.color } })
  expect((await space.agenda()).projects.map(project => project.id)).toEqual(ordered)
  const d = await space.project('新项目')
  expect((await space.agenda()).projects.map(project => project.id)).toEqual([...ordered, d.id])
  expect((await order(original, ordered)).status()).toBe(400)
  await space.api.delete(`/api/projects/${a.id}`)
  const remaining = [c.id, b.id, d.id]
  expect((await space.agenda()).projects.map(project => project.id)).toEqual(remaining)
  expect((await order([...remaining].reverse(), remaining)).status()).toBe(200)
})

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
  const normalized = await request.get(`${apiURL}/api/agenda`, { headers: { 'X-User-Email': `  ${space.email.toUpperCase()}  ` } })
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
  expect((await space.api.post('/api/projects', { data: { name: 'x'.repeat(JSON_BODY_MAX_BYTES) } })).status()).toBe(413)
  expect((await request.get(`${apiURL}/api/agenda`)).status()).toBe(400)
})

test('无日期事项往返、补充与清除日期、引用及隔离', async ({ space, otherSpace }) => {
  const project = await space.project('未排期项目')
  const other = await space.project('有日期项目')
  const target = await space.entry(other.id, '有日期目标', '2026-09-13')
  const id = await space.entry(project.id, '待安排', null, [target], '日期之后再定')
  const original = (await space.agenda()).entries.find(entry => entry.id === id)!
  expect(original).toMatchObject({ date: null, references: [target], description: '日期之后再定' })
  const dated = (await space.agenda()).entries.find(entry => entry.id === target)!
  expect((await space.api.put(`/api/entries/${target}`, { data: { ...dated, references: [id] } })).status()).toBe(200)
  expect((await space.api.patch(`/api/entries/${id}`, { data: { completed: true } })).status()).toBe(200)
  expect((await space.agenda()).entries.find(entry => entry.id === id)).toMatchObject({ ...original, completed: true, updatedAt: expect.any(String) })

  for (const date of ['2024-02-29', null]) {
    expect((await space.api.put(`/api/entries/${id}`, { data: { ...original, date, completed: true } })).status()).toBe(200)
    expect((await space.agenda()).entries.find(entry => entry.id === id)).toMatchObject({ ...original, date, completed: true, updatedAt: expect.any(String) })
    expect((await space.agenda()).entries.find(entry => entry.id === target)?.references).toEqual([id])
  }
  const before = await space.agenda()
  for (const date of [undefined, '', ' ', false, 123, '2026-02-29', '2026-13-01', '2026-09-13T00:00:00Z']) {
    expect((await space.api.post('/api/entries', { data: { ...original, date } })).status()).toBe(400)
    expect((await space.api.put(`/api/entries/${id}`, { data: { ...original, date } })).status()).toBe(400)
    expect(await space.agenda()).toEqual(before)
  }
  expect((await otherSpace.agenda()).entries).toEqual([])
  expect((await otherSpace.api.put(`/api/entries/${id}`, { data: original })).status()).toBe(404)
  const foreign = await otherSpace.project('其他空间')
  expect((await otherSpace.api.post('/api/entries', { data: { ...original, projectId: foreign.id, references: [id] } })).status()).toBe(400)
  expect(await space.agenda()).toEqual(before)
  expect((await space.api.delete(`/api/projects/${project.id}`)).status()).toBe(200)
  expect((await space.agenda()).entries).toEqual([expect.objectContaining({ id: target, references: [] })])
})

test('仅改期 PATCH 保留事项内容与引用并验证日期及邮箱', async ({ space, otherSpace }) => {
  const project = await space.project('改期项目')
  const referenced = await space.entry(project.id, '引用目标', '2026-12-31')
  const id = await space.entry(project.id, '跨年事项', '2026-12-31', [referenced], '**正文**')
  const original = (await space.agenda()).entries.find(entry => entry.id === id)!
  for (const date of ['2027-01-01', null, '2026-12-30']) {
    expect((await space.api.patch(`/api/entries/${id}`, { data: { date } })).status()).toBe(200)
    expect((await space.agenda()).entries.find(entry => entry.id === id)).toMatchObject({ ...original, date, updatedAt: expect.any(String) })
  }
  const before = await space.agenda()
  for (const date of ['', '2027-02-29', '2026-12-31T00:00:00Z', 1, undefined]) {
    expect((await space.api.patch(`/api/entries/${id}`, { data: { date } })).status()).toBe(400)
    expect(await space.agenda()).toEqual(before)
  }
  expect((await space.api.patch(`/api/entries/${id}`, { data: { date: '2027-01-02', completed: true } })).status()).toBe(400)
  expect((await otherSpace.api.patch(`/api/entries/${id}`, { data: { date: '2027-01-02' } })).status()).toBe(404)
  expect(await space.agenda()).toEqual(before)
})

test('自定义 RGB 颜色创建、修改、归一化及无效值拒绝', async ({ space }) => {
  const project = await space.project('自定义颜色', '#12abef')
  expect(project.color).toBe('#12ABEF')
  for (const color of ['#000000', '#ffffff', '#a1B2c3']) {
    expect((await space.api.put(`/api/projects/${project.id}`, { data: { name: project.name, color } })).status()).toBe(200)
    expect((await space.agenda()).projects[0]?.color).toBe(color.toUpperCase())
  }
  const before = await space.agenda()
  for (const color of ['#123', '#12345678', '#GG0000', 'rgb(18, 171, 239)', '', null, 123456]) {
    const data = { name: project.name, color }
    expect((await space.api.post('/api/projects', { data })).status()).toBe(400)
    expect((await space.api.put(`/api/projects/${project.id}`, { data })).status()).toBe(400)
    expect(await space.agenda()).toEqual(before)
  }
})

test('支持 50 个引用，替换和清空引用时保持事项数据完整', async ({ space }) => {
  const project = await space.project('引用边界')
  const targets: string[] = []
  for (let index = 0; index < 50; index++) {
    targets.push(await space.entry(project.id, `目标 ${index}`, '2026-09-13'))
  }
  const source = await space.entry(project.id, '引用汇总', '2026-09-14', targets, '\u0000'.repeat(DESCRIPTION_MAX_LENGTH))
  let agenda = await space.agenda()
  const original = agenda.entries.find(entry => entry.id === source)!
  expect(original.references).toEqual([...targets].sort())
  expect(original.completed).toBe(false)
  expect(original.description).toBe('\u0000'.repeat(DESCRIPTION_MAX_LENGTH))

  for (const references of [[targets[0]], []]) {
    const input = { projectId: project.id, title: '更新汇总', date: '2026-09-15', completed: true, references }
    expect((await space.api.put(`/api/entries/${source}`, { data: input })).status()).toBe(200)
    agenda = await space.agenda()
    expect(agenda.entries.find(entry => entry.id === source)).toEqual({
      id: source, ...input, assetIds: [], description: '', createdAt: original.createdAt, updatedAt: expect.any(String),
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
  for (const description of ['', '  \n\t \r\n末尾  ', '<b>字面 HTML</b>\n**Markdown**', '汉'.repeat(DESCRIPTION_MAX_LENGTH),
    '😀'.repeat(DESCRIPTION_MAX_LENGTH / 2), '\u0000'.repeat(DESCRIPTION_MAX_LENGTH)]) {
    const created = await space.entry(project.id, '往返', '2026-09-14', [], description)
    expect((await space.agenda()).entries.find(entry => entry.id === created)?.description).toBe(description)
    const response = await space.api.put(`/api/entries/${source}`, { data: { ...input, description } })
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ id: source, description })
    expect(await current()).toMatchObject({ description, references: [target] })
  }
  const before = await space.agenda()
  for (const description of [null, 42, false, [], {}, 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1), '😀'.repeat(DESCRIPTION_MAX_LENGTH / 2) + 'x']) {
    for (const [method, path] of [['POST', '/api/entries'], ['PUT', `/api/entries/${source}`]] as const) {
      expect((await space.api.fetch(path, { method, data: { ...input, title: '不得写入', description, references: [] } })).status()).toBe(400)
      expect(await space.agenda()).toEqual(before)
    }
  }
  expect((await space.api.patch(`/api/entries/${source}`, { data: { completed: true } })).status()).toBe(200)
  expect((await current()).description).toBe('\u0000'.repeat(DESCRIPTION_MAX_LENGTH))
  expect((await space.api.put(`/api/entries/${source}`, { data: input })).status()).toBe(200)
  expect(await current()).toMatchObject({ description: '', references: [target] })
})

test('请求体按实际 UTF-8 字节限制到 256KiB（含无 Content-Length 的流式请求）', async ({ space }) => {
  const project = await space.project('请求边界')
  const source = await space.entry(project.id, '边界记录', '2026-09-13')
  const input = { projectId: project.id, title: '边界记录', description: '中文😀', date: '2026-09-13', completed: false, references: [] }
  const json = JSON.stringify(input)
  // JSON trailing whitespace keeps the input valid without conflating field and body limits.
  for (const size of [JSON_BODY_MAX_BYTES - 1, JSON_BODY_MAX_BYTES, JSON_BODY_MAX_BYTES + 1]) {
    const before = await space.agenda()
    const data = json + ' '.repeat(size - Buffer.byteLength(json))
    expect(Buffer.byteLength(data)).toBe(size)
    for (const streamed of [false, true]) {
      const response = streamed
        ? await fetch(`${apiURL}/api/entries/${source}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-User-Email': space.email },
            body: new ReadableStream({ start(controller) {
              const bytes = new TextEncoder().encode(data)
              controller.enqueue(bytes.slice(0, 32_768))
              controller.enqueue(bytes.slice(32_768))
              controller.close()
            } }), duplex: 'half',
          } as RequestInit & { duplex: 'half' })
        : await space.api.put(`/api/entries/${source}`, { data, headers: { 'Content-Type': 'application/json' } })
      expect(typeof response.status === 'function' ? response.status() : response.status).toBe(size > JSON_BODY_MAX_BYTES ? 413 : 200)
      if (size > JSON_BODY_MAX_BYTES) expect(await space.agenda()).toEqual(before)
      else expect((await space.agenda()).entries[0]?.description).toBe(input.description)
    }
  }
})

test('同源请求可预检及读写，未允许的跨域来源被拒绝', async ({ space }) => {
  const origin = apiURL
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
