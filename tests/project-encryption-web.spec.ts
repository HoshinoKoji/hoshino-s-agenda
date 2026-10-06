import type { Locator, Page } from '@playwright/test'
import { test, expect, type Space } from './fixtures'
import { createProjectEncryption, unlockProjectEncryption } from '../shared/projectEncryption'
import { decryptDescriptionWithKey, encryptDescription, encryptProjectDescription } from '../shared/encryption'

const password = '项目统一口令123'
async function enter(page: Page, email: string) {
  await page.goto('/')
  await page.getByRole('textbox', { name: '邮箱地址' }).fill(email)
  await page.getByRole('button', { name: '进入我的日历' }).click()
  await expect(page.locator('.sync-button')).toContainText('已与云端同步')
  await overview(page)
}
async function overview(page: Page) {
  await page.getByRole('combobox', { name: '工作台视图' }).click()
  await page.getByRole('option', { name: '项目总览', exact: true }).click()
}
async function editProject(page: Page, name: string) {
  await page.getByRole('button', { name: `编辑项目 ${name}`, exact: true }).click()
  return page.getByRole('dialog', { name: '编辑项目', exact: true })
}
async function unlock(container: Locator, value = password) {
  await container.getByLabel('项目解锁口令', { exact: true }).fill(value)
  await container.getByRole('button', { name: '解锁项目描述', exact: true }).click()
}
async function choice(page: Page, editor: Locator, label: string, option: string) {
  await editor.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
async function encryptedProject(space: Space, name: string, value = password) {
  const id = crypto.randomUUID()
  const sealed = await createProjectEncryption(id, value)
  const response = await space.api.post('/api/projects', { data: { requestId: id, name, color: '#123456', encryption: sealed.encryption } })
  expect(response.status()).toBe(201)
  return { id, ...sealed }
}
async function encryptedEntry(space: Space, project: Awaited<ReturnType<typeof encryptedProject>>, title: string, description: string) {
  const response = await space.api.post('/api/entries', { data: { projectId: project.id, title, date: null, completed: false, references: [],
    encryptedDescription: await encryptProjectDescription(description, project.key, project.id, project.encryption.keyId) } })
  expect(response.status()).toBe(201)
  return (await response.json()).id as string
}

test('项目口令：已有描述全部统一、一次解锁共享、改口令和取消加密', async ({ page, space, isMobile }, testInfo) => {
  test.setTimeout(90_000)
  if (isMobile) await page.setViewportSize({ width: 320, height: 568 })
  const project = await space.project('统一项目')
  const first = await space.entry(project.id, '原明文', null, [], '原明文正文')
  const old = await encryptDescription('原独立正文', '原独立口令123')
  const response = await space.api.post('/api/entries', { data: { projectId: project.id, title: '原独立加密', date: null, completed: false, references: [first], encryptedDescription: old.encryptedDescription } })
  const second = (await response.json()).id as string
  await enter(page, space.email)
  const editor = await editProject(page, project.name)
  await editor.getByRole('checkbox', { name: '项目描述加密', exact: true }).check()
  await editor.getByLabel('项目加密口令', { exact: true }).fill(password)
  await editor.getByLabel('确认项目口令', { exact: true }).fill(password)
  await editor.getByRole('button', { name: '保存项目', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('先解锁')
  expect((await space.agenda()).projects[0]?.encryption).toBeUndefined()
  await editor.getByLabel('解锁密码', { exact: true }).fill('原独立口令123')
  await editor.getByRole('button', { name: '解锁描述', exact: true }).click()
  await expect(editor.locator('.project-encryption-pending')).toBeHidden()
  const sent: string[] = []
  page.on('request', request => { if (request.url().includes('/encryption')) sent.push(request.postData() ?? '') })
  await editor.getByRole('button', { name: '保存项目', exact: true }).click()
  await expect(editor).toBeHidden()
  const cards = [page.locator(`#entry-${first}`), page.locator(`#entry-${second}`)]
  await expect(cards[0]!.locator('.entry-description')).toHaveText('原明文正文')
  await expect(cards[1]!.locator('.entry-description')).toHaveText('原独立正文')
  for (const body of sent) for (const secret of [password, '原独立口令123', '原明文正文', '原独立正文']) expect(body).not.toContain(secret)
  await cards[0]!.getByRole('button', { name: '重新锁定项目', exact: true }).click()
  for (const card of cards) await expect(card.locator('.entry-description')).toHaveCount(0)
  await unlock(cards[0]!, '错误项目口令123')
  await expect(cards[0]!.getByRole('alert')).toContainText('项目口令错误')
  await unlock(cards[0]!)
  await expect(cards[1]!.locator('.entry-description')).toHaveText('原独立正文')
  await page.screenshot({ path: testInfo.outputPath('project-unified-encryption.png'), fullPage: true })
  const changing = await editProject(page, project.name)
  await changing.getByRole('button', { name: '修改项目口令', exact: true }).click()
  await changing.getByLabel('当前项目口令', { exact: true }).fill(password)
  await changing.getByLabel('项目加密口令', { exact: true }).fill('新项目口令12345')
  await changing.getByLabel('确认项目口令', { exact: true }).fill('新项目口令12345')
  const before = (await space.agenda()).entries.map(row => row.encryptedDescription)
  await changing.getByRole('button', { name: '保存项目', exact: true }).click()
  await expect(changing).toBeHidden()
  expect((await space.agenda()).entries.map(row => row.encryptedDescription)).toEqual(before)
  await page.reload(); await overview(page)
  await unlock(cards[0]!)
  await expect(cards[0]!.getByRole('alert')).toContainText('项目口令错误')
  await unlock(cards[0]!, '新项目口令12345')
  await expect(cards[1]!.locator('.entry-description')).toHaveText('原独立正文')
  const disabling = await editProject(page, project.name)
  await disabling.getByRole('checkbox', { name: '项目描述加密', exact: true }).uncheck()
  await disabling.getByRole('button', { name: '保存项目', exact: true }).click()
  await expect(disabling).toBeHidden()
  const agenda = await space.agenda()
  expect(agenda.projects[0]?.encryption).toBeUndefined()
  expect(agenda.entries.find(row => row.id === first)?.description).toBe('原明文正文')
  expect(agenda.entries.find(row => row.id === second)?.description).toBe('原独立正文')
  await noOverflow(page)
})

test('项目口令：新建默认加密、锁定元数据保存、复制及编辑打印交接', async ({ page, space, isMobile }, testInfo) => {
  test.setTimeout(90_000)
  if (isMobile) await page.setViewportSize({ width: 320, height: 568 })
  await enter(page, space.email)
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const projectEditor = page.getByRole('dialog', { name: '创建项目', exact: true })
  await projectEditor.getByRole('textbox', { name: '项目名称', exact: true }).fill('新建统一项目')
  await projectEditor.getByRole('checkbox', { name: '项目描述加密', exact: true }).check()
  await projectEditor.getByLabel('项目加密口令', { exact: true }).fill(password)
  await projectEditor.getByLabel('确认项目口令', { exact: true }).fill(password)
  await projectEditor.getByRole('button', { name: '创建项目', exact: true }).click()
  await expect(projectEditor).toBeHidden()
  await page.getByRole('button', { name: '为 新建统一项目 添加事项', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '添加事项', exact: true })
  await editor.getByRole('textbox', { name: '事项标题', exact: true }).fill('项目事项')
  await expect(editor.getByLabel('加密密码', { exact: true })).toHaveCount(0)
  await editor.getByRole('textbox', { name: '描述' }).fill('项目自动加密正文')
  await editor.getByRole('button', { name: '添加事项', exact: true }).click()
  await expect(editor).toBeHidden()
  const project = (await space.agenda()).projects[0]!
  const entry = (await space.agenda()).entries[0]!
  const card = page.locator(`#entry-${entry.id}`)
  await expect(card.locator('.entry-description')).toHaveText('项目自动加密正文')
  await page.reload(); await overview(page)
  await card.getByRole('button', { name: '编辑事项 项目事项', exact: true }).click()
  const locked = page.getByRole('dialog', { name: '编辑事项', exact: true })
  await locked.getByRole('textbox', { name: '事项标题', exact: true }).fill('改标题仍锁定')
  await locked.getByRole('button', { name: '保存', exact: true }).click()
  await expect(locked).toBeHidden()
  expect((await space.agenda()).entries[0]?.encryptedDescription).toEqual(entry.encryptedDescription)
  await card.getByRole('button', { name: '复制事项 改标题仍锁定', exact: true }).click()
  const copy = page.getByRole('dialog', { name: '复制事项', exact: true })
  await copy.getByRole('textbox', { name: '事项标题', exact: true }).fill('锁定副本')
  await copy.getByRole('button', { name: '添加事项', exact: true }).click()
  await expect(copy).toBeHidden()
  await unlock(card)
  const copied = (await space.agenda()).entries.find(row => row.title === '锁定副本')!
  await expect(page.locator(`#entry-${copied.id}`).locator('.entry-description')).toHaveText('项目自动加密正文')
  const opening = page.waitForEvent('popup')
  await card.getByRole('button', { name: '在新标签页编辑 改标题仍锁定', exact: true }).click()
  const editPage = await opening
  if (isMobile) await editPage.setViewportSize({ width: 320, height: 568 })
  const sheet = editPage.locator('.entry-edit-sheet')
  await expect(sheet.getByRole('textbox', { name: '描述' })).toHaveValue('项目自动加密正文')
  const printing = page.waitForEvent('popup')
  await card.getByRole('button', { name: '导出事项 改标题仍锁定', exact: true }).click()
  const printPage = await printing
  await expect(printPage.locator('.entry-description')).toHaveText('项目自动加密正文')
  await card.getByRole('button', { name: '重新锁定项目', exact: true }).click()
  await expect(printPage.getByRole('button', { name: '打印 / 保存为 PDF', exact: true })).toBeEnabled()
  await sheet.getByRole('textbox', { name: '描述' }).fill('独立页修改正文')
  await sheet.getByRole('button', { name: '保存', exact: true }).click()
  await expect(sheet.getByRole('textbox', { name: '描述' })).toHaveValue('独立页修改正文')
  const saved = (await space.agenda()).entries.find(row => row.id === entry.id)!
  const key = await unlockProjectEncryption(project.id, project.encryption!, password)
  expect((await decryptDescriptionWithKey(saved.encryptedDescription!, key)).description).toBe('独立页修改正文')
  const storage = await editPage.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))
  expect(storage).not.toContain(password); expect(storage).not.toContain('独立页修改正文')
  await noOverflow(editPage)
  await editPage.screenshot({ path: testInfo.outputPath('project-encrypted-edit.png'), fullPage: true })
  await printPage.close(); await editPage.close()
})

test('项目口令：跨项目移动需解锁双方、普通项目保存与独立密码', async ({ page, space, isMobile }) => {
  test.setTimeout(90_000)
  if (isMobile) await page.setViewportSize({ width: 320, height: 568 })
  const first = await encryptedProject(space, '来源项目')
  const second = await encryptedProject(space, '目标项目', '目标项目口令123')
  const ordinary = await space.project('普通项目')
  const id = await encryptedEntry(space, first, '跨项目事项', '跨项目正文')
  await enter(page, space.email)
  const card = page.locator(`#entry-${id}`)
  await card.getByRole('button', { name: '编辑事项 跨项目事项', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑事项', exact: true })
  await choice(page, editor, '所属项目', '目标项目')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('先解锁原描述')
  await unlock(editor.locator('.description-unlock').filter({ hasText: '· 来源项目' }))
  await unlock(editor.locator('.description-unlock').filter({ hasText: '· 目标项目' }), '目标项目口令123')
  await expect(editor.getByRole('textbox', { name: '描述' })).toHaveValue('跨项目正文')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor).toBeHidden()
  let saved = (await space.agenda()).entries.find(row => row.id === id)!
  expect(saved.projectId).toBe(second.id)
  expect((await decryptDescriptionWithKey(saved.encryptedDescription!, second.key)).description).toBe('跨项目正文')
  await card.getByRole('button', { name: '编辑事项 跨项目事项', exact: true }).click()
  await choice(page, editor, '所属项目', '普通项目')
  await expect(editor.getByLabel('加密密码', { exact: true })).toBeVisible()
  await editor.getByLabel('加密密码', { exact: true }).fill('独立迁移口令123')
  await editor.getByLabel('确认加密密码', { exact: true }).fill('独立迁移口令123')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor).toBeHidden()
  saved = (await space.agenda()).entries.find(row => row.id === id)!
  expect(saved.projectId).toBe(ordinary.id)
  expect(saved.encryptedDescription?.version).toBe(1)
  await noOverflow(page)
})

test('项目口令：转换失败保留原数据、关闭清理与响应丢失幂等重试', async ({ page, space }) => {
  test.setTimeout(90_000)
  const project = await space.project('转换重试项目')
  const id = await space.entry(project.id, '重试事项', null, [], '重试正文')
  await enter(page, space.email)
  let editor = await editProject(page, project.name)
  async function configure() {
    await editor.getByRole('checkbox', { name: '项目描述加密', exact: true }).check()
    await editor.getByLabel('项目加密口令', { exact: true }).fill(password)
    await editor.getByLabel('确认项目口令', { exact: true }).fill(password)
  }
  await configure()
  let failedPath = ''
  await page.route('**/encryption/*/chunks', async route => {
    failedPath = new URL(route.request().url()).pathname.replace(/\/chunks$/, '')
    await route.fulfill({ status: 503, json: { error: '模拟转换失败' } })
  }, { times: 1 })
  await editor.getByRole('button', { name: '保存项目', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('模拟转换失败')
  expect((await space.agenda()).entries[0]?.description).toBe('重试正文')
  const cancellation = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(failedPath))
  await editor.getByRole('button', { name: '取消', exact: true }).click()
  await cancellation
  expect((await space.api.post(`${failedPath}/commit`, { data: {} })).status()).toBe(404)
  editor = await editProject(page, project.name)
  await configure()
  let commitPath = ''
  let committed: unknown
  await page.route('**/encryption/*/commit', async route => {
    commitPath = new URL(route.request().url()).pathname
    expect((await route.fetch()).status()).toBe(200)
    committed = (await space.agenda()).entries.find(row => row.id === id)?.encryptedDescription
    await route.abort('failed')
  }, { times: 1 })
  await editor.getByRole('button', { name: '保存项目', exact: true }).click()
  await expect(editor.getByRole('alert')).toBeVisible()
  const retry = page.waitForResponse(response => new URL(response.url()).pathname === commitPath)
  await editor.getByRole('button', { name: '保存项目', exact: true }).click()
  await retry
  await expect(editor).toBeHidden()
  expect((await space.agenda()).entries.find(row => row.id === id)?.encryptedDescription).toEqual(committed)
  await expect(page.locator(`#entry-${id} .entry-description`)).toHaveText('重试正文')
})

test('项目口令：跨项目重复系列批量描述、独立密文与完成例外保留', async ({ page, space, isMobile }) => {
  test.setTimeout(90_000)
  if (isMobile) await page.setViewportSize({ width: 320, height: 568 })
  const first = await encryptedProject(space, '系列甲')
  const second = await encryptedProject(space, '系列乙', '系列乙项目口令123')
  const response = await space.api.post('/api/entries', { data: { projectId: first.id, title: '跨项目系列', date: '2026-10-05', completed: false, references: [],
    encryptedDescription: await encryptProjectDescription('原系列正文', first.key, first.id, first.encryption.keyId),
    recurrence: { frequency: 'daily', startDate: '2026-10-05', until: '2026-10-07' } } })
  expect(response.status()).toBe(201)
  let rows = (await space.agenda()).entries
  const middle = rows.find(row => row.date === '2026-10-06')!
  const body = await encryptProjectDescription('原系列正文', second.key, second.id, second.encryption.keyId)
  expect((await space.api.put(`/api/entries/${middle.id}`, { data: { ...middle, description: '', encryptedDescription: body,
    projectId: second.id, recurrence: middle.recurrence!.rule, scope: 'following', seriesVersion: middle.recurrence!.version } })).status()).toBe(200)
  rows = (await space.agenda()).entries
  const last = rows.find(row => row.date === '2026-10-07')!
  expect((await space.api.put(`/api/entries/${last.id}`, { data: { ...last, description: '', completed: true,
    encryptedDescription: await encryptProjectDescription('已完成单次例外', second.key, second.id, second.encryption.keyId), recurrence: last.recurrence!.rule, scope: 'single', seriesVersion: last.recurrence!.version } })).status()).toBe(200)
  await enter(page, space.email)
  const head = rows.find(row => row.date === '2026-10-05')!
  await page.locator(`#entry-${head.id}`).getByRole('button', { name: '编辑事项 跨项目系列', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑事项', exact: true })
  await unlock(editor)
  await choice(page, editor, '修改／删除范围', '整个系列')
  await editor.getByRole('textbox', { name: '描述' }).fill('批量新正文')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('先解锁项目「系列乙」')
  await unlock(editor.getByRole('region', { name: '批量修改涉及的项目', exact: true }), '系列乙项目口令123')
  await expect(editor.getByRole('region', { name: '批量修改涉及的项目', exact: true })).toContainText('项目描述已解锁')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor).toBeHidden()
  rows = (await space.agenda()).entries
  for (const row of rows) {
    const key = row.projectId === first.id ? first.key : second.key
    expect((await decryptDescriptionWithKey(row.encryptedDescription!, key)).description).toBe(row.id === last.id ? '已完成单次例外' : '批量新正文')
  }
  expect(rows.find(row => row.id === last.id)).toMatchObject({ completed: true, recurrence: { exception: true } })
  await noOverflow(page)
})

test('项目口令：新事项同步共享解锁、保存期间主动锁定与切换空间清理', async ({ page, space, otherSpace }) => {
  test.setTimeout(90_000)
  const project = await encryptedProject(space, '同步加密项目')
  const first = await encryptedEntry(space, project, '原事项', '原加密正文')
  await enter(page, space.email)
  await page.getByRole('button', { name: '项目操作 同步加密项目', exact: true }).click()
  await page.getByRole('menuitem', { name: '解锁项目描述', exact: true }).click()
  const projectDialog = page.getByRole('dialog', { name: '解锁项目描述', exact: true })
  await unlock(projectDialog)
  await expect(projectDialog).toBeHidden()
  const next = await encryptedEntry(space, project, '外部新事项', '外部新加密正文')
  await page.locator('.sync-button').click()
  await expect(page.locator(`#entry-${next} .entry-description`)).toHaveText('外部新加密正文')
  await page.getByRole('button', { name: '为 同步加密项目 添加事项', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '添加事项', exact: true })
  await editor.getByRole('textbox', { name: '事项标题', exact: true }).fill('保存时锁定的新事项')
  await editor.getByRole('textbox', { name: '描述' }).fill('保存但不应自动解锁的正文')
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const written = new Promise<void>(resolve => { started = resolve })
  await page.route('**/api/entries', async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    started(); await gate
    await route.fulfill({ response })
  }, { times: 1 })
  await editor.getByRole('button', { name: '添加事项', exact: true }).click()
  await written
  await page.locator(`#entry-${first}`).getByRole('button', { name: '重新锁定项目', exact: true }).evaluate(button => (button as HTMLButtonElement).click())
  release()
  await expect(editor).toBeHidden()
  const saved = (await space.agenda()).entries.find(row => row.title === '保存时锁定的新事项')!
  await expect(page.locator(`#entry-${saved.id} .entry-description`)).toHaveCount(0)
  await unlock(page.locator(`#entry-${first}`))
  await expect(page.locator(`#entry-${saved.id} .entry-description`)).toHaveText('保存但不应自动解锁的正文')
  await otherSpace.project('另一个空间')
  for (const email of [otherSpace.email, space.email]) {
    await page.getByRole('button', { name: /我的空间/ }).click()
    await page.getByRole('textbox', { name: '邮箱地址', exact: true }).fill(email)
    await page.getByRole('button', { name: '切换数据空间', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.locator('.sync-button')).toContainText('已与云端同步')
  }
  await overview(page)
  await expect(page.locator(`#entry-${first} .entry-description`)).toHaveCount(0)
  await expect(page.locator(`#entry-${first}`).getByLabel('项目解锁口令', { exact: true })).toBeVisible()
})
