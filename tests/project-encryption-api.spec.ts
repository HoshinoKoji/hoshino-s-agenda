import { test, expect, type Space } from './fixtures'
import { createProjectEncryption, rewrapProjectEncryption, unlockProjectEncryption } from '../shared/projectEncryption'
import { decryptDescriptionWithKey, encryptDescription, encryptProjectDescription } from '../shared/encryption'
import type { ProjectEncryption } from '../shared/types'

async function start(space: Space, projectId: string, encryption: ProjectEncryption | null, rewrap = false) {
  const project = (await space.agenda()).projects.find(item => item.id === projectId)!
  const id = crypto.randomUUID()
  expect((await space.api.post(`/api/projects/${projectId}/encryption`, { data: { requestId: id, expectedRevision: project.encryptionRevision, encryption, rewrap } })).status()).toBe(200)
  return `/api/projects/${projectId}/encryption/${id}`
}

test('项目加密密钥封装、身份绑定、改口令与描述独立 IV', async () => {
  const projectId = crypto.randomUUID()
  const original = await createProjectEncryption(projectId, '项目口令1234')
  expect(original.key.extractable).toBe(false)
  const key = await unlockProjectEncryption(projectId, original.encryption, '项目口令1234')
  const text = '\u0000\ud800😀\n  项目正文  '
  const first = await encryptProjectDescription(text, key, projectId, original.encryption.keyId)
  const second = await encryptProjectDescription(text, key, projectId, original.encryption.keyId)
  expect(first.iv).not.toBe(second.iv)
  expect((await decryptDescriptionWithKey(first, structuredClone(key))).description).toBe(text)
  await expect(unlockProjectEncryption(projectId, original.encryption, '错误口令1234')).rejects.toThrow('项目口令错误')
  await expect(unlockProjectEncryption(crypto.randomUUID(), original.encryption, '项目口令1234')).rejects.toThrow('项目口令错误')
  await expect(decryptDescriptionWithKey({ ...first, projectId: crypto.randomUUID() }, key)).rejects.toThrow('已损坏')
  const next = await rewrapProjectEncryption(projectId, original.encryption, '项目口令1234', '新的项目口令123')
  expect(next.keyId).toBe(original.encryption.keyId)
  expect(next.salt).not.toBe(original.encryption.salt)
  await expect(unlockProjectEncryption(projectId, next, '项目口令1234')).rejects.toThrow('项目口令错误')
  expect((await decryptDescriptionWithKey(first, await unlockProjectEncryption(projectId, next, '新的项目口令123'))).description).toBe(text)
})

test('项目加密原子转换、分块完整性、邮箱隔离与旧客户端保护', async ({ space, otherSpace }) => {
  const project = await space.project('统一口令项目')
  const first = await space.entry(project.id, '明文事项', null, [], '旧明文正文')
  const old = await encryptDescription('独立加密正文', '原独立口令123')
  const response = await space.api.post('/api/entries', { data: { projectId: project.id, title: '独立加密事项', date: null, completed: false, references: [first], encryptedDescription: old.encryptedDescription } })
  const second = (await response.json()).id as string
  const initial = (await space.agenda()).entries
  const sealed = await createProjectEncryption(project.id, '项目统一口令123')
  const path = await start(space, project.id, sealed.encryption)
  expect((await otherSpace.api.post(`${path}/commit`, { data: {} })).status()).toBe(404)
  expect((await space.api.put(`${path}/chunks`, { data: { entries: [{ id: first, description: '', encryptedDescription: await encryptProjectDescription('旧明文正文', sealed.key, project.id, sealed.encryption.keyId) }] } })).status()).toBe(200)
  expect((await space.api.post(`${path}/commit`, { data: {} })).status()).toBe(409)
  expect((await space.agenda()).entries).toEqual(initial)
  expect((await space.agenda()).projects[0]?.encryption).toBeUndefined()
  expect((await space.api.put(`${path}/chunks`, { data: { entries: [{ id: second, description: '', encryptedDescription: await encryptProjectDescription('独立加密正文', sealed.key, project.id, sealed.encryption.keyId) }] } })).status()).toBe(200)
  expect((await space.api.post(`${path}/commit`, { data: {} })).status()).toBe(200)
  expect((await space.api.post(`${path}/commit`, { data: {} })).status()).toBe(200)
  const agenda = await space.agenda()
  expect(agenda.projects[0]?.encryption).toEqual(sealed.encryption)
  for (const row of agenda.entries) {
    expect(row.description).toBe('')
    expect(row.encryptedDescription?.version).toBe(2)
    expect((await decryptDescriptionWithKey(row.encryptedDescription!, sealed.key)).description).toBe(row.id === first ? '旧明文正文' : '独立加密正文')
  }
  const input = { projectId: project.id, title: '旧客户端', date: null, completed: false, references: [] }
  expect((await space.api.post('/api/entries', { data: { ...input, description: '禁止明文' } })).status()).toBe(409)
  expect((await space.api.put(`/api/entries/${first}`, { data: input })).status()).toBe(409)
  expect((await space.api.put(`/api/entries/${first}`, { data: { ...input, encryptedDescription: old.encryptedDescription } })).status()).toBe(409)
  expect((await space.api.patch(`/api/entries/${first}`, { data: { completed: true } })).status()).toBe(200)
  expect((await space.agenda()).entries.find(row => row.id === first)?.encryptedDescription).toEqual(agenda.entries.find(row => row.id === first)?.encryptedDescription)
})

test('项目加密并发变更拒绝、取消清理与加密项目幂等创建', async ({ space }) => {
  const project = await space.project('转换冲突')
  const id = await space.entry(project.id, '原事项', null, [], '原正文')
  const sealed = await createProjectEncryption(project.id, '项目口令1234')
  const path = await start(space, project.id, sealed.encryption)
  const rows = [{ id, description: '', encryptedDescription: await encryptProjectDescription('原正文', sealed.key, project.id, sealed.encryption.keyId) }]
  expect((await space.api.put(`${path}/chunks`, { data: { entries: rows } })).status()).toBe(200)
  expect((await space.api.patch(`/api/entries/${id}`, { data: { completed: true } })).status()).toBe(200)
  expect((await space.api.post(`${path}/commit`, { data: {} })).status()).toBe(409)
  expect((await space.agenda()).entries[0]).toMatchObject({ description: '原正文', completed: true })
  expect((await space.api.delete(path)).status()).toBe(200)
  expect((await space.api.post(`${path}/commit`, { data: {} })).status()).toBe(404)
  const requestId = crypto.randomUUID()
  const empty = await createProjectEncryption(requestId, '新建项目口令123')
  const input = { requestId, name: '新建加密项目', color: '#123456', encryption: empty.encryption }
  expect((await space.api.post('/api/projects', { data: input })).status()).toBe(201)
  expect((await space.api.post('/api/projects', { data: input })).status()).toBe(201)
  expect((await space.agenda()).projects.filter(row => row.id === requestId)).toHaveLength(1)
  const wrong = await encryptProjectDescription('正文', sealed.key, project.id, sealed.encryption.keyId)
  expect((await space.api.post('/api/entries', { data: { projectId: requestId, title: '错误归属', date: null, completed: false, references: [], encryptedDescription: wrong } })).status()).toBe(409)
})

test('项目加密超出单次请求的完整转换、改口令与取消加密', async ({ space }) => {
  const project = await space.project('长描述项目')
  const text = '\u0000'.repeat(20_000)
  const ids = [await space.entry(project.id, '长描述一', null, [], text), await space.entry(project.id, '长描述二', null, [], text)]
  const sealed = await createProjectEncryption(project.id, '长描述项目口令123')
  const path = await start(space, project.id, sealed.encryption)
  const rows = await Promise.all(ids.map(async id => ({ id, description: '', encryptedDescription: await encryptProjectDescription(text, sealed.key, project.id, sealed.encryption.keyId) })))
  for (const row of rows) expect((await space.api.put(`${path}/chunks`, { data: { entries: [row] } })).status()).toBe(200)
  expect((await space.api.put(`${path}/chunks`, { data: { entries: rows } })).status()).toBe(413)
  expect((await space.api.post(`${path}/commit`, { data: {} })).status()).toBe(200)
  const ciphertexts = (await space.agenda()).entries.map(row => row.encryptedDescription)
  const next = await rewrapProjectEncryption(project.id, sealed.encryption, '长描述项目口令123', '新口令123456')
  const rewrap = await start(space, project.id, next, true)
  expect((await space.api.post(`${rewrap}/commit`, { data: {} })).status()).toBe(200)
  expect((await space.agenda()).entries.map(row => row.encryptedDescription)).toEqual(ciphertexts)
  const disable = await start(space, project.id, null)
  for (const id of ids) expect((await space.api.put(`${disable}/chunks`, { data: { entries: [{ id, description: text, encryptedDescription: null }] } })).status()).toBe(200)
  expect((await space.api.post(`${disable}/commit`, { data: {} })).status()).toBe(200)
  expect((await space.agenda()).projects[0]?.encryption).toBeUndefined()
  for (const row of (await space.agenda()).entries) { expect(row.description).toBe(text); expect(row.encryptedDescription).toBeUndefined() }
})

test('项目加密真实并发提交仅一组生效、失败事务保留完整描述', async ({ space }) => {
  const project = await space.project('并发加密项目')
  const id = await space.entry(project.id, '并发事项', null, [], '同一份原正文')
  const sealed = await Promise.all([createProjectEncryption(project.id, '第一项目口令123'), createProjectEncryption(project.id, '第二项目口令123')])
  const paths = []
  for (const config of sealed) {
    const path = await start(space, project.id, config.encryption)
    expect((await space.api.put(`${path}/chunks`, { data: { entries: [{ id, description: '',
      encryptedDescription: await encryptProjectDescription('同一份原正文', config.key, project.id, config.encryption.keyId) }] } })).status()).toBe(200)
    paths.push(path)
  }
  const responses = await Promise.all(paths.map(path => space.api.post(`${path}/commit`, { data: {} })))
  expect(responses.map(response => response.status()).sort()).toEqual([200, 409])
  const winner = responses.findIndex(response => response.status() === 200)
  const agenda = await space.agenda()
  expect(agenda.projects[0]?.encryption).toEqual(sealed[winner]!.encryption)
  expect((await decryptDescriptionWithKey(agenda.entries[0]!.encryptedDescription!, sealed[winner]!.key)).description).toBe('同一份原正文')
  expect((await space.api.post(`${paths[winner]}/commit`, { data: {} })).status()).toBe(200)
})

test('项目加密 100 项暂存批次满足 D1 参数上限，重复实例完整转换', async ({ space }) => {
  const project = await space.project('百项转换')
  const response = await space.api.post('/api/entries', { data: { projectId: project.id, title: '百项系列', date: '2026-10-05', completed: false, references: [],
    recurrence: { frequency: 'daily', startDate: '2026-10-05', until: '2027-01-12' } } })
  expect(response.status()).toBe(201)
  const entries = (await space.agenda()).entries
  expect(entries).toHaveLength(100)
  const sealed = await createProjectEncryption(project.id, '百项项目口令123')
  const path = await start(space, project.id, sealed.encryption)
  const body = await encryptProjectDescription('', sealed.key, project.id, sealed.encryption.keyId)
  expect((await space.api.put(`${path}/chunks`, { data: { entries: entries.map(entry => ({ id: entry.id, description: '', encryptedDescription: body })) } })).status()).toBe(200)
  expect((await space.api.post(`${path}/commit`, { data: {} })).status()).toBe(200)
  const saved = (await space.agenda()).entries
  expect(saved).toHaveLength(100)
  for (const entry of saved) {
    expect(entry.encryptedDescription).toEqual(body)
    expect(entry.recurrence?.exception).toBe(false)
  }
})
