import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tools = join(root, '.android-tools')
const project = join(root, 'apps/android')
const jdk = join(tools, 'jdk-21')
const sdk = join(tools, 'sdk')
const gradle = join(tools, 'gradle-8.13/bin/gradle')
const command = process.argv[2]
const env = {
  ...process.env,
  JAVA_HOME: existsSync(join(jdk, 'bin/java')) ? jdk : process.env.JAVA_HOME,
  ANDROID_HOME: existsSync(sdk) ? sdk : process.env.ANDROID_HOME,
  ANDROID_USER_HOME: join(tools, 'android-user'),
  GRADLE_USER_HOME: join(tools, 'gradle-home'),
  TMPDIR: join(tools, 'tmp'),
  JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS || ''} -Duser.home=${join(tools, 'home')} -Djava.io.tmpdir=${join(tools, 'tmp')}`.trim(),
  PATH: `${join(jdk, 'bin')}:${process.env.PATH}`,
}

async function run(program, args, input, capture = false) {
  return new Promise((accept, reject) => {
    const child = spawn(program, args, { cwd: project, env, stdio: [input ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit', 'inherit'] })
    let output = ''
    child.stdout?.on('data', value => { output += value })
    if (input) child.stdin.end(input)
    child.on('error', reject)
    child.on('exit', code => code === 0 ? accept(output) : reject(new Error(`${program} exited with ${code}`)))
  })
}

async function download(url, name, digest, algorithm = 'sha256') {
  const path = join(tools, 'downloads', name)
  await mkdir(dirname(path), { recursive: true })
  let bytes
  if (existsSync(path)) bytes = await readFile(path)
  else {
    console.log(`Downloading ${name}`)
    for (const source of Array.isArray(url) ? url : [url]) {
      try {
        const response = await fetch(source, { signal: AbortSignal.timeout(300_000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        bytes = Buffer.from(await response.arrayBuffer())
        break
      } catch (error) {
        console.warn(`${new URL(source).host}: ${error.cause?.message || error.message}`)
      }
    }
    if (!bytes) throw new Error(`Download failed: ${name}`)
  }
  if (createHash(algorithm).update(bytes).digest('hex') !== digest) throw new Error(`Checksum mismatch: ${name}`)
  await writeFile(path, bytes)
  return { bytes, path }
}

// Extract ZIP central-directory entries without requiring a global unzip binary.
async function unzip(bytes, destination, prefix = '') {
  let end = bytes.length - 22
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--
  if (end < Math.max(0, bytes.length - 65557) || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('Invalid ZIP archive')
  let at = bytes.readUInt32LE(end + 16)
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw new Error('Invalid ZIP directory')
    const method = bytes.readUInt16LE(at + 10)
    const length = bytes.readUInt32LE(at + 20)
    const nameLength = bytes.readUInt16LE(at + 28)
    const extraLength = bytes.readUInt16LE(at + 30)
    const commentLength = bytes.readUInt16LE(at + 32)
    const mode = bytes.readUInt32LE(at + 38) >>> 16
    const offset = bytes.readUInt32LE(at + 42)
    const original = bytes.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + extraLength + commentLength
    if (!original.startsWith(prefix)) continue
    const name = original.slice(prefix.length)
    if (!name || name.endsWith('/')) continue
    const path = resolve(destination, name)
    if (!path.startsWith(resolve(destination) + '/') || (mode & 0xf000) === 0xa000) throw new Error('Unsafe ZIP entry')
    const dataAt = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28)
    const data = bytes.subarray(dataAt, dataAt + length)
    const content = method === 0 ? data : method === 8 ? inflateRawSync(data) : null
    if (!content) throw new Error('Unsupported ZIP compression')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
    if (mode & 0o111) await chmod(path, 0o755)
  }
}

async function setup() {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('自动工具链安装支持 Linux x64；其他平台请配置 JDK 21 与 Android SDK，再使用 Gradle Wrapper。')
  await mkdir(jdk, { recursive: true })
  if (!existsSync(join(jdk, 'bin/java'))) {
    const archive = await download('https://corretto.aws/downloads/resources/21.0.9.10.1/amazon-corretto-21.0.9.10.1-linux-x64.tar.gz', 'corretto-21.0.9.tar.gz', '9e0813f60fb96195b8bef0deb85fa225344c4c2dc5ce8e8fe4bdeec91ea9f4f0')
    await run('tar', ['-xzf', archive.path, '-C', jdk, '--strip-components=1'])
  }
  env.JAVA_HOME = jdk
  if (!existsSync(gradle)) {
    const archive = await download(['https://services.gradle.org/distributions/gradle-8.13-bin.zip', 'https://repo.huaweicloud.com/gradle/gradle-8.13-bin.zip'], 'gradle-8.13.zip', '20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78')
    await unzip(archive.bytes, tools)
  }
  const manager = join(sdk, 'cmdline-tools/19.0/bin/sdkmanager')
  if (!existsSync(manager)) {
    const archive = await download('https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip', 'commandlinetools-19.0.zip', '5fdcc763663eefb86a5b8879697aa6088b041e70', 'sha1')
    await unzip(archive.bytes, join(sdk, 'cmdline-tools/19.0'), 'cmdline-tools/')
  }
  env.ANDROID_HOME = sdk
  await run(manager, [`--sdk_root=${sdk}`, '--licenses'], 'y\n'.repeat(100), true)
  await run(manager, [`--sdk_root=${sdk}`, 'platforms;android-36', 'build-tools;36.0.0', 'platform-tools'], 'y\n'.repeat(100))
  const wrapper = await download('https://raw.githubusercontent.com/gradle/gradle/v8.13.0/gradle/wrapper/gradle-wrapper.jar', 'gradle-wrapper.jar', '81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f')
  await writeFile(join(project, 'gradle/wrapper/gradle-wrapper.jar'), wrapper.bytes)
  console.log('Android tools ready (all caches and credentials remain inside this project).')
}

async function debugKey() {
  if (process.env.AGENDA_ANDROID_KEYSTORE) return
  const path = join(env.ANDROID_USER_HOME, 'debug.keystore')
  if (existsSync(path)) return
  await mkdir(dirname(path), { recursive: true })
  await run(join(env.JAVA_HOME, 'bin/keytool'), ['-genkeypair', '-keystore', path, '-alias', 'androiddebugkey', '-storepass', 'android', '-keypass', 'android', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Android Debug,O=Android,C=US'])
}

async function assetlinks() {
  const keystore = process.env.AGENDA_ANDROID_KEYSTORE || join(env.ANDROID_USER_HOME, 'debug.keystore')
  const alias = process.env.AGENDA_ANDROID_KEY_ALIAS || 'androiddebugkey'
  env.AGENDA_KEYSTORE_PASSWORD = process.env.AGENDA_ANDROID_STORE_PASSWORD || 'android'
  const output = await run(join(env.JAVA_HOME || '', 'bin/keytool'), ['-J-Duser.language=en', '-list', '-v', '-keystore', keystore, '-alias', alias, '-storepass:env', 'AGENDA_KEYSTORE_PASSWORD'], undefined, true)
  const fingerprint = output.match(/SHA256:\s*([A-F0-9:]+)/)?.[1]
  if (!fingerprint) throw new Error('Cannot read signing certificate SHA-256')
  const path = join(root, 'apps/web/public/.well-known/assetlinks.json')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'club.hoshino.agenda', sha256_cert_fingerprints: [fingerprint] },
  }], null, 2) + '\n')
  console.log(`Generated ${path}; deploy it and configure its exact Access path for anonymous reads.`)
}

try {
  await mkdir(join(tools, 'tmp'), { recursive: true })
  if (command === 'setup') await setup()
  else if (command === 'assetlinks') await assetlinks()
  else {
    const tasks = { build: [':app:assembleDebug'], test: [':app:testDebugUnitTest'], check: [':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebug'] }[command]
    if (!tasks) throw new Error('Usage: bun run android:setup|android:build|android:test|android:check|android:assetlinks')
    if (!env.JAVA_HOME || !env.ANDROID_HOME) throw new Error('先运行 bun run android:setup，或配置 JAVA_HOME / ANDROID_HOME。')
    await debugKey()
    await run(existsSync(gradle) ? gradle : 'sh', [...(existsSync(gradle) ? [] : ['gradlew']), '--no-daemon', '--console=plain', ...tasks, ...process.argv.slice(3)])
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
