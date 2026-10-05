import { test, expect } from './fixtures'

test('安卓手动回跳：保留内存结果、清除地址并生成正确应用链接', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  const code = 'fixture +/中文#Intent;scheme=untrusted'
  const state = 'fixture-state'
  const params = new URLSearchParams({ code, state, access_token: 'never-forward-this-token', error_description: 'never-forward-this-description' })
  await page.goto(`/android/oauth/callback?${params}`)
  await expect(page.getByRole('link', { name: '返回日迹 App', exact: true })).toBeVisible()
  const clean = new URL(page.url())
  expect(clean.search).toBe('')
  expect(clean.hash).toBe('')
  const direct = new URL((await page.getByRole('link', { name: '返回日迹 App', exact: true }).getAttribute('href'))!)
  expect(direct.protocol).toBe('club.hoshino.agenda:')
  expect(direct.host).toBe('oauth')
  expect(direct.pathname).toBe('/callback')
  expect(direct.searchParams.get('code')).toBe(code)
  expect(direct.searchParams.get('state')).toBe(state)
  expect([...direct.searchParams.keys()]).toEqual(['state', 'code'])
  const pinned = (await page.getByRole('link', { name: '如果没有打开，尝试指定日迹 App' }).getAttribute('href'))!
  expect(pinned).toContain('package=club.hoshino.agenda;component=club.hoshino.agenda/.auth.OAuthLinkActivity;end')
  expect(pinned).not.toContain('never-forward')
  await expect(page.locator('body')).not.toContainText(code)
  await expect(page.locator('body')).not.toContainText('never-forward')
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('android-manual-callback.png'), fullPage: true })
})

test('安卓手动回跳：错误结果仅交接 error 与 state', async ({ page }) => {
  await page.goto('/android/oauth/callback?error=access_denied&state=fixture-state&error_description=private-description')
  const button = page.getByRole('link', { name: '返回日迹 App', exact: true })
  await expect(button).toBeVisible()
  const direct = new URL((await button.getAttribute('href'))!)
  expect([...direct.searchParams.keys()]).toEqual(['state', 'error'])
  expect(direct.searchParams.get('error')).toBe('access_denied')
  await expect(page.locator('body')).not.toContainText('private-description')
  expect(new URL(page.url()).search).toBe('')
})

test('安卓手动回跳：缺失或冲突结果不生成链接，刷新不恢复授权数据', async ({ page }) => {
  for (const query of ['', 'code=x', 'code=x&state=a&state=b', 'code=a&code=b&state=s', 'code=x&error=access_denied&state=s', 'code=&state=s']) {
    await page.goto(`/android/oauth/callback${query ? `?${query}` : ''}`)
    await expect(page.getByRole('status')).toContainText('没有可交接')
    await expect(page.locator('#open-app')).toBeHidden()
    await expect(page.locator('#open-app-intent')).toBeHidden()
  }
  await page.goto('/android/oauth/callback?code=fixture-code&state=fixture-state')
  await expect(page.locator('#open-app')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('status')).toContainText('没有可交接')
  await expect(page.locator('#open-app')).toBeHidden()
})
