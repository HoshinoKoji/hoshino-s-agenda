import { test, expect } from './fixtures'

test('同一入口提供静态资源与 API，API 导航不会回退为 HTML', async ({ request, space }) => {
  const home = await request.get('/')
  expect(home.status()).toBe(200)
  expect(home.headers()['content-type']).toContain('text/html')
  expect(await home.text()).toContain('日迹')

  const fallback = await request.get('/calendar/2026/09', { headers: { 'Sec-Fetch-Mode': 'navigate' } })
  expect(fallback.status()).toBe(200)
  expect(fallback.headers()['content-type']).toContain('text/html')

  const icon = await request.get('/favicon.svg')
  expect(icon.status()).toBe(200)
  expect(icon.headers()['content-type']).toContain('image/svg+xml')

  const navigation = { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' }
  const health = await request.get('/api/health', { headers: navigation })
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ ok: true })

  for (const path of ['/api', '/api/nonexistent']) {
    const missing = await request.get(path, { headers: { ...navigation, 'X-User-Email': space.email } })
    expect(missing.status()).toBe(404)
    expect(await missing.json()).toEqual({ error: '接口不存在' })
  }
  const invalid = await request.get('/api/agenda', { headers: navigation })
  expect(invalid.status()).toBe(400)
  expect(invalid.headers()['content-type']).toContain('application/json')
})

test('安卓授权回跳与域名关联文件按静态资源提供', async ({ request }) => {
  const links = await request.get('/.well-known/assetlinks.json')
  expect(links.status()).toBe(200)
  expect(links.headers()['content-type']).toContain('application/json')
  const associations = await links.json()
  expect(associations).toHaveLength(1)
  expect(associations[0].relation).toContain('delegate_permission/common.handle_all_urls')
  expect(associations[0].target.package_name).toBe('club.hoshino.agenda')
  expect(associations[0].target.sha256_cert_fingerprints.length).toBeGreaterThan(0)
  for (const fingerprint of associations[0].target.sha256_cert_fingerprints) {
    expect(fingerprint).toMatch(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/)
  }
  const callback = await request.get('/android/oauth/callback?code=one-time-code&state=attempt')
  expect(callback.status()).toBe(200)
  expect(callback.headers()['content-type']).toContain('text/html')
  const page = await callback.text()
  expect(page).toContain('返回日迹安卓 App')
  expect(page).toContain('history.replaceState')
  expect(page).toContain('返回日迹 App')
  expect(page).toContain('club.hoshino.agenda://oauth/callback?')
  expect(page).not.toContain('one-time-code')
  expect(page).not.toContain('attempt')
})
