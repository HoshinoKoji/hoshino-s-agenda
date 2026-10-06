import { DESCRIPTION_MAX_LENGTH, type EncryptedDescription, type PasswordEncryptedDescription, type ProjectEncryptedDescription } from './types'

const ITERATIONS = 600_000
export const MAX_CIPHERTEXT_BYTES = DESCRIPTION_MAX_LENGTH * 6 + 2 + 16
const encoder = new TextEncoder()
const additionalData = encoder.encode('agenda:description:v1')

export function encode(bytes: Uint8Array): string {
  const chunks: string[] = []
  // Keep each call below argument-count limits even for fully escaped descriptions.
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)))
  }
  return btoa(chunks.join(''))
}

export function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0))
}

export function base64(value: unknown, min: number, max = min): value is string {
  if (typeof value !== 'string' || value.length % 4 !== 0 || value.length > Math.ceil(max / 3) * 4) return false
  try {
    const bytes = decode(value)
    // Re-encoding also rejects whitespace, missing padding and nonzero padding bits.
    return bytes.length >= min && bytes.length <= max && encode(bytes) === value
  } catch { return false }
}

/** Versions fix the algorithm and identity fields; callers cannot supply arbitrary parameters. */
export function isEncryptedDescription(value: unknown): value is EncryptedDescription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  const identity = data.version === 1 ? Object.keys(data).length === 4 && base64(data.salt, 16)
    : data.version === 2 && Object.keys(data).length === 5 && validEncryptionId(data.projectId) && validEncryptionId(data.keyId)
  return !!identity && base64(data.iv, 12) && base64(data.ciphertext, 18, MAX_CIPHERTEXT_BYTES)
}

export const validEncryptionId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)

function descriptionAAD(data: EncryptedDescription) {
  return data.version === 1 ? additionalData : encoder.encode(`agenda:description:v2:${data.projectId}:${data.keyId}`)
}

function subtle() {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('此浏览器无法使用加密，请通过 HTTPS 或 localhost 打开，并使用支持 Web Crypto 的浏览器')
  return crypto.subtle
}

function plaintext(description: string) {
  if (description.length > DESCRIPTION_MAX_LENGTH) throw new Error(`描述不能超过 ${DESCRIPTION_MAX_LENGTH} 个 UTF-16 单元`)
  // JSON preserves even lone UTF-16 surrogates, NULs and whitespace losslessly.
  return encoder.encode(JSON.stringify(description))
}

export function validateEncryptionPassword(password: string) {
  if (password.length < 8 || password.length > 256) throw new Error('加密密码需为 8–256 个字符')
}

export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const api = subtle()
  const material = await api.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return api.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptDescriptionWithKey(description: string, key: CryptoKey, salt: string): Promise<PasswordEncryptedDescription> {
  const bytes = plaintext(description)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, bytes)
  return { version: 1, salt, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }
}

export async function encryptProjectDescription(description: string, key: CryptoKey, projectId: string, keyId: string): Promise<ProjectEncryptedDescription> {
  if (!validEncryptionId(projectId) || !validEncryptionId(keyId)) throw new Error('项目加密身份无效')
  const data: ProjectEncryptedDescription = { version: 2, projectId, keyId, iv: '', ciphertext: '' }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: descriptionAAD(data), tagLength: 128 }, key, plaintext(description))
  return { ...data, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }
}

export async function encryptDescription(description: string, password: string) {
  validateEncryptionPassword(password)
  plaintext(description)
  subtle()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt)
  return { encryptedDescription: await encryptDescriptionWithKey(description, key, encode(salt)), key }
}

export async function decryptDescription(data: EncryptedDescription, password: string) {
  if (!isEncryptedDescription(data)) throw new Error('加密描述格式无效或版本不受支持')
  if (data.version !== 1) throw new Error('请使用所属项目的口令解锁描述')
  validateEncryptionPassword(password)
  return decryptDescriptionWithKey(data, await deriveKey(password, decode(data.salt)))
}

export async function decryptDescriptionWithKey(data: EncryptedDescription, key: CryptoKey) {
  if (!isEncryptedDescription(data)) throw new Error('加密描述格式无效或版本不受支持')
  if (typeof CryptoKey === 'undefined' || !(key instanceof CryptoKey) || key.type !== 'secret' || key.extractable ||
    key.algorithm.name !== 'AES-GCM' || (key.algorithm as { length?: number }).length !== 256 || !key.usages.includes('decrypt')) {
    throw new Error('解密密钥无效')
  }
  const api = subtle()
  try {
    const bytes = await api.decrypt({ name: 'AES-GCM', iv: decode(data.iv), additionalData: descriptionAAD(data), tagLength: 128 }, key, decode(data.ciphertext))
    const description: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
    if (typeof description !== 'string' || description.length > DESCRIPTION_MAX_LENGTH) throw new Error('Invalid plaintext')
    return { description, key }
  } catch { throw new Error('密码错误或加密描述已损坏，请重试') }
}
