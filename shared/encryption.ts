import { DESCRIPTION_MAX_LENGTH, type EncryptedDescription } from './types'

const ITERATIONS = 600_000
const MAX_CIPHERTEXT_BYTES = DESCRIPTION_MAX_LENGTH * 6 + 2 + 16
const encoder = new TextEncoder()
const additionalData = encoder.encode('agenda:description:v1')

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0))
}

function base64(value: unknown, min: number, max = min): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false
  const bytes = decode(value)
  return bytes.length >= min && bytes.length <= max && encode(bytes) === value
}

/** Version 1 fixes the algorithm and KDF cost; callers cannot supply arbitrary iterations. */
export function isEncryptedDescription(value: unknown): value is EncryptedDescription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return Object.keys(data).length === 4 && data.version === 1 && base64(data.salt, 16) &&
    base64(data.iv, 12) && base64(data.ciphertext, 18, MAX_CIPHERTEXT_BYTES)
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

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const api = subtle()
  const material = await api.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return api.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptDescriptionWithKey(description: string, key: CryptoKey, salt: string): Promise<EncryptedDescription> {
  const bytes = plaintext(description)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, bytes)
  return { version: 1, salt, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }
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
  validateEncryptionPassword(password)
  const api = subtle()
  const key = await deriveKey(password, decode(data.salt))
  try {
    const bytes = await api.decrypt({ name: 'AES-GCM', iv: decode(data.iv), additionalData, tagLength: 128 }, key, decode(data.ciphertext))
    const description: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
    if (typeof description !== 'string' || description.length > DESCRIPTION_MAX_LENGTH) throw new Error('Invalid plaintext')
    return { description, key }
  } catch { throw new Error('密码错误或加密描述已损坏，请重试') }
}
