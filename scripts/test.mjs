import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import process from 'node:process'
import { checkRuntime, checkBrowser } from './doctor.mjs'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)

async function checkPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`无效测试端口：${port}`)
  await new Promise((resolve, reject) => {
    const server = createServer()
    const timer = setTimeout(() => {
      server.close()
      reject(new Error(`检查端口 ${port} 超时。`))
    }, 2000)
    server.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`测试端口 ${port} 不可用（${error.code}）。请停止占用服务，或用 AGENDA_TEST_PORT 指定空闲的 Worker 端口。`))
    })
    server.listen(port, '127.0.0.1', () => {
      clearTimeout(timer)
      server.close(resolve)
    })
  })
}

try {
  checkRuntime()
  if (!args.some(arg => ['--list', '--help', '-h'].includes(arg))) {
    await checkPort(Number(process.env.AGENDA_TEST_PORT || 8787))
    if (process.env.AGENDA_TEST_DEV === '1') await checkPort(3000)
    const projects = args.flatMap((arg, index) => arg.startsWith('--project=') ? [arg.slice(10)] : arg === '--project' ? [args[index + 1]] : [])
    if (!projects.length || projects.some(project => project !== 'api')) await checkBrowser()
    console.log('[test] 端口检查通过，启动 Playwright（全局时限 5 分钟）。')
  }
  const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...args], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0', CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? '1' },
  })
  let stopping = false
  let forcedStop
  const stop = (signal) => {
    if (stopping) return
    stopping = true
    child.kill(signal)
    forcedStop = setTimeout(() => child.kill('SIGKILL'), 10_000)
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))
  child.once('error', (error) => {
    console.error(`[test] ${error.message}`)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    clearTimeout(forcedStop)
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
  })
} catch (error) {
  console.error(`[test] ${error.message}`)
  process.exitCode = 1
}
