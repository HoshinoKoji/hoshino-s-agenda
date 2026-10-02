import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export function checkRuntime() {
  const expectedNode = manifest.optionalDependencies[`node-${process.platform}-${process.arch}`]
  const expectedBun = manifest.packageManager.replace('bun@', '')
  if (process.versions.bun || (expectedNode && process.versions.node !== expectedNode)) {
    throw new Error(`请先执行 bun install --frozen-lockfile，并通过 bun run 使用仓库内的 Node.js ${expectedNode ?? '22.12+'}。当前入口：${process.execPath}`)
  }
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('工具链需要 Node.js 22.12+。')
  const bunVersion = execFileSync('bun', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim()
  if (bunVersion !== expectedBun) throw new Error(`需要仓库内的 Bun ${expectedBun}，当前为 ${bunVersion}；请重新执行 bun install --frozen-lockfile。`)
  console.log(`[toolchain] Node.js ${process.versions.node} · Bun ${bunVersion}`)
}

export async function checkBrowser() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0'
  const { chromium } = require('@playwright/test')
  if (!existsSync(chromium.executablePath())) throw new Error('Chromium 未安装，请执行 bun run test:install。')
  try {
    const browser = await chromium.launch({ timeout: 10_000 })
    await browser.close()
    console.log('[toolchain] Chromium 启动检查通过')
  } catch (error) {
    const detail = error.message.match(/error while loading shared libraries:[^\n]+/)?.[0] ?? error.message.split('\n')[0]
    throw new Error(`Chromium 无法启动：${detail}\nLinux 系统库可通过 bun run test:deps 安装（需要系统安装权限）。`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkRuntime()
    await checkBrowser()
  } catch (error) {
    console.error(`[toolchain] ${error.message}`)
    process.exitCode = 1
  }
}
