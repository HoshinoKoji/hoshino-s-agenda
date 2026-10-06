import { defineConfig, devices } from '@playwright/test'
import process from 'node:process'
import { resolve } from 'node:path'
import { apiPort, apiURL } from './tests/environment'

const dev = process.env.AGENDA_TEST_DEV === '1'
const workerEnv = { WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve('.wrangler/logs'), NUXT_TELEMETRY_DISABLED: '1' }
const browserEnv = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined))

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // The complete API + two-browser suite includes expensive Web Crypto flows.
  globalTimeout: 600_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: dev ? 'http://127.0.0.1:3000' : apiURL,
    locale: 'zh-CN',
    // Chromium uses the Linux process locale for filenames, separately from context locale.
    ...(process.platform === 'linux' ? { launchOptions: { env: { ...browserEnv, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } } } : {}),
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testMatch: /(?:api|mentions|deployment|recurrence)\.spec\.ts/ },
    { name: 'desktop', testMatch: ['web.spec.ts', 'project-encryption-web.spec.ts', 'android-callback.spec.ts'], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', testMatch: ['web.spec.ts', 'project-encryption-web.spec.ts', 'android-callback.spec.ts'], use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: dev ? [
    {
      command: `bun run --cwd apps/api db:migrate --persist-to ../../.wrangler/test-state && bun run --cwd apps/api test:serve --port ${apiPort} --log-level warn --assets ../web/public --var ALLOWED_ORIGINS:http://localhost:3000,http://127.0.0.1:3000 --persist-to ../../.wrangler/test-state`,
      url: `${apiURL}/api/health`,
      env: workerEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
    {
      command: 'bun run --cwd apps/web dev',
      url: 'http://127.0.0.1:3000',
      env: { NUXT_TELEMETRY_DISABLED: '1' },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
  ] : [{
    command: `bun run --cwd apps/web generate && bun run --cwd apps/api db:migrate --persist-to ../../.wrangler/test-state && bun run --cwd apps/api test:serve --port ${apiPort} --log-level warn --persist-to ../../.wrangler/test-state --var ALLOWED_ORIGINS:`,
    url: `${apiURL}/api/health`,
    env: workerEnv,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  }],
})
