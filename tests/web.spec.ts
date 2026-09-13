import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

async function enter(page: Page, email: string) {
  await page.goto('/')
  await page.getByRole('textbox', { name: '邮箱地址' }).fill(email)
  await page.getByRole('button', { name: '进入我的日历' }).click()
  await expect(page.locator('.sync-button')).toContainText('已与云端同步')
}

async function switchSpace(page: Page, email: string) {
  await page.getByRole('button', { name: /我的空间/ }).click()
  await page.getByRole('textbox', { name: '邮箱地址' }).fill(email)
  await page.getByRole('button', { name: '切换数据空间' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.sync-button')).toContainText('已与云端同步')
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('邮箱进入、项目和事项编辑、完成、双向引用跳转与删除', async ({ page, space, otherSpace }, testInfo) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.setFixedTime(new Date('2026-09-13T04:00:00Z'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /让每一天的进展/ })).toBeVisible()
  await noOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('welcome.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('textbox', { name: '邮箱地址' }).fill(space.email.toUpperCase())
  await page.getByRole('button', { name: '进入我的日历' }).click()
  await expect(page.locator('.sync-button')).toContainText('已与云端同步')
  await expect(page.getByRole('heading', { name: '每个项目，都从一个想法开始' })).toBeVisible()

  for (const [name, color] of [['个人网站', '颜色 1'], ['阅读计划', '颜色 2']] as const) {
    await page.getByRole('button', { name: '创建新项目', exact: true }).click()
    await page.getByRole('textbox', { name: '项目名称' }).fill(name)
    await page.getByRole('button', { name: color, exact: true }).click()
    await page.getByRole('button', { name: '创建项目', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  }
  await page.getByRole('button', { name: '编辑项目 个人网站' }).click()
  await page.getByRole('textbox', { name: '项目名称' }).fill('网站计划')
  await page.getByRole('button', { name: '保存项目' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.locator('.add-main').click()
  await page.getByRole('textbox', { name: '事项标题' }).fill('设计首页')
  await page.getByLabel('所属项目').selectOption({ label: '网站计划' })
  await page.getByRole('dialog').getByRole('button', { name: '添加事项', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.entry-title')).toHaveText('设计首页')
  await page.getByRole('button', { name: '标为完成：设计首页', exact: true }).click()
  await expect(page.getByRole('button', { name: '标为未完成：设计首页', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: '本月概览' })).toContainText('100%')

  await page.getByRole('button', { name: '下个月', exact: true }).click()
  await page.getByRole('button', { name: '选择 2026-10-02', exact: true }).click()
  await page.locator('.add-main').click()
  await page.getByRole('textbox', { name: '事项标题' }).fill('整理设计灵感')
  await page.getByLabel('所属项目').selectOption({ label: '阅读计划' })
  await expect(page.getByLabel('记录日期')).toHaveValue('2026-10-02')
  await page.getByRole('textbox', { name: '搜索引用事项' }).fill('网站计划')
  await page.locator('.reference-option').filter({ hasText: '设计首页' }).getByRole('checkbox').check()
  await noOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('entry-editor.png'), animations: 'disabled' })
  await page.getByRole('dialog').getByRole('button', { name: '添加事项', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.entry-title')).toHaveText('整理设计灵感')

  const projectNav = page.getByRole('navigation', { name: '项目筛选' })
  await projectNav.getByRole('button', { name: /^阅读计划/ }).click()
  await page.locator('.reference-chip').filter({ hasText: '设计首页' }).click()
  await expect(page.locator('.month-heading h2')).toHaveText('2026年9月')
  await expect(projectNav.getByRole('button', { name: /^全部项目/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.entry-title')).toHaveText('设计首页')
  await expect(page.locator('.reference-chip.backlink')).toContainText('整理设计灵感')
  await page.getByRole('button', { name: '编辑事项 设计首页', exact: true }).click()
  await page.getByRole('textbox', { name: '事项标题' }).fill('首页设计定稿')
  await page.getByRole('checkbox', { name: '已完成这件事项' }).uncheck()
  await page.getByRole('textbox', { name: '搜索引用事项' }).fill('2026-10-02')
  await page.locator('.reference-option').filter({ hasText: '整理设计灵感' }).getByRole('checkbox').check()
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.entry-title')).toHaveText('首页设计定稿')
  await expect(page.locator('.reference-group')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '标为完成：首页设计定稿', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await noOverflow(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('calendar.png'), fullPage: true, animations: 'disabled' })

  await page.reload()
  await expect(page.locator('.entry-title')).toHaveText('首页设计定稿')
  await expect(page.locator('.reference-group')).toHaveCount(2)
  await switchSpace(page, otherSpace.email)
  await expect(projectNav.getByRole('button', { name: /^网站计划/ })).toHaveCount(0)
  await expect(page.locator('.entry-card')).toHaveCount(0)
  await switchSpace(page, space.email)
  await expect(page.locator('.entry-title')).toHaveText('首页设计定稿')

  await page.getByRole('button', { name: '编辑事项 首页设计定稿', exact: true }).click()
  await page.getByRole('button', { name: '删除事项', exact: true }).click()
  await page.getByRole('button', { name: '确认删除事项', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: '下个月', exact: true }).click()
  await page.getByRole('button', { name: '选择 2026-10-02', exact: true }).click()
  await expect(page.locator('.entry-title')).toHaveText('整理设计灵感')
  await expect(page.locator('.reference-chip')).toHaveCount(0)
  await page.getByRole('button', { name: '编辑项目 阅读计划', exact: true }).click()
  await page.getByRole('button', { name: '删除项目', exact: true }).click()
  await expect(page.locator('.delete-confirm')).toContainText('1 个事项')
  await page.getByRole('button', { name: '确认删除项目', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.entry-card')).toHaveCount(0)
  await expect(projectNav.getByRole('button', { name: /^阅读计划/ })).toHaveCount(0)
  expect((await space.agenda()).entries).toEqual([])
  expect(errors).toEqual([])
})

test('同步失败可重试，切换邮箱后迟到的旧响应不会覆盖新空间', async ({ page, space, otherSpace }) => {
  await space.project('旧空间项目')
  await otherSpace.project('新空间项目')
  await enter(page, space.email)
  await page.route('**/api/agenda', route => route.abort('failed'), { times: 1 })
  await page.locator('.sync-button').click()
  await expect(page.getByRole('alert')).toContainText('连接云端失败')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.locator('.sync-button')).toContainText('已与云端同步')
  await expect(page.getByRole('alert')).toHaveCount(0)

  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const pending = new Promise<void>(resolve => { started = resolve })
  await page.route('**/api/agenda', async route => {
    if (route.request().headers()['x-user-email'] !== space.email) return route.continue()
    const response = await route.fetch()
    started()
    await gate
    await route.fulfill({ response })
  })
  await page.locator('.sync-button').click()
  await pending
  try {
    await switchSpace(page, otherSpace.email)
    await expect(page.getByRole('button', { name: /^新空间项目/ })).toBeVisible()
  } finally { release() }
  await expect(page.locator('.sync-button')).toContainText('已与云端同步')
  // Drain the old browser request before asserting the final rendered space.
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /^旧空间项目/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^新空间项目/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('agenda:email'))).toBe(otherSpace.email)
})
