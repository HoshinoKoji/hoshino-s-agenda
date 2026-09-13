import { defineConfig, devices } from '@playwright/test'
import process from 'node:process'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testMatch: 'api.spec.ts' },
    { name: 'desktop', testMatch: 'web.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', testMatch: 'web.spec.ts', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: 'bun run --cwd apps/api db:migrate --persist-to ../../.wrangler/test-state && bun run --cwd apps/api dev --persist-to ../../.wrangler/test-state',
      url: 'http://127.0.0.1:8787/api/health',
      env: { WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve('.wrangler/logs') },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'bun run --filter @agenda/web dev',
      url: 'http://127.0.0.1:3000',
      env: { NUXT_PUBLIC_API_BASE: 'http://127.0.0.1:8787', NUXT_TELEMETRY_DISABLED: '1' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
