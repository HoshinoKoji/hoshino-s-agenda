import type { ProjectEncryption } from './types'
import { base64, decode, deriveKey, encode, validEncryptionId, validateEncryptionPassword } from './encryption'

const encoder = new TextEncoder()
const aad = (projectId: string, keyId: string) => encoder.encode(`agenda:project-key:v1:${projectId}:${keyId}`)

export function isProjectEncryption(value: unknown): value is ProjectEncryption {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return Object.keys(data).length === 5 && data.version === 1 && validEncryptionId(data.keyId) &&
    base64(data.salt, 16) && base64(data.iv, 12) && base64(data.wrappedKey, 48)
}

async function seal(projectId: string, keyId: string, raw: Uint8Array<ArrayBuffer>, password: string) {
  validateEncryptionPassword(password)
  if (!validEncryptionId(projectId)) throw new Error('项目 ID 无效')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrappingKey = await deriveKey(password, salt)
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(projectId, keyId), tagLength: 128 }, wrappingKey, raw)
  return { version: 1, keyId, salt: encode(salt), iv: encode(iv), wrappedKey: encode(new Uint8Array(wrapped)) } satisfies ProjectEncryption
}

export async function createProjectEncryption(projectId: string, password: string) {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  try {
    const encryption = await seal(projectId, crypto.randomUUID(), raw, password)
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
    return { encryption, key }
  } finally { raw.fill(0) }
}

async function unwrap(projectId: string, encryption: ProjectEncryption, password: string) {
  if (!isProjectEncryption(encryption) || !validEncryptionId(projectId)) throw new Error('项目加密格式无效')
  validateEncryptionPassword(password)
  const key = await deriveKey(password, decode(encryption.salt))
  try {
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(encryption.iv), additionalData: aad(projectId, encryption.keyId), tagLength: 128 }, key, decode(encryption.wrappedKey))
    if (raw.byteLength !== 32) throw new Error('Invalid key')
    return new Uint8Array(raw)
  } catch { throw new Error('项目口令错误或加密密钥已损坏，请重试') }
}

export async function unlockProjectEncryption(projectId: string, encryption: ProjectEncryption, password: string) {
  const raw = await unwrap(projectId, encryption, password)
  try { return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) }
  finally { raw.fill(0) }
}

export async function rewrapProjectEncryption(projectId: string, encryption: ProjectEncryption, password: string, nextPassword: string) {
  const raw = await unwrap(projectId, encryption, password)
  try { return await seal(projectId, encryption.keyId, raw, nextPassword) }
  finally { raw.fill(0) }
}
