import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import process from 'node:process'
import { test } from 'node:test'

function run(args, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/test.mjs', ...args], {
      env: { ...process.env, AGENDA_TEST_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`测试入口未在 5 秒内退出：${output}`))
    }, 5000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); resolve({ code, output }) })
  })
}

test('占用端口的服务即使不响应 HTTP，也应立即退出并提示', async () => {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await run(['--project=api'], server.address().port)
    assert.equal(result.code, 1)
    assert.match(result.output, /EADDRINUSE/)
    assert.match(result.output, /AGENDA_TEST_PORT/)
    assert.doesNotMatch(result.output, /启动 Playwright/)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('非法端口在构建或服务启动前被拒绝', async () => {
  const result = await run(['--project=api'], 65536)
  assert.equal(result.code, 1)
  assert.match(result.output, /无效测试端口/)
})

test('--list 传递给 Playwright，列举用例无需空闲端口', async () => {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await run(['--list', '--project=api'], server.address().port)
    assert.equal(result.code, 0)
    assert.match(result.output, /\[api\]/)
    assert.doesNotMatch(result.output, /\[desktop\]|\[mobile\]/)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
