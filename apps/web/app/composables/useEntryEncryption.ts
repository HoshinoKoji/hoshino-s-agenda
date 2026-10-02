import { inject, provide, shallowReactive, watch, onUnmounted, type InjectionKey, type Ref } from 'vue'
import type { EncryptedDescription, Entry, EntrySaveResult } from '../../../../shared/types'
import { decryptDescription, decryptDescriptionWithKey } from '../../../../shared/encryption'

interface Secret {
  fingerprint: string
  description: string
  key: CryptoKey
}

export interface EntrySaveSnapshot {
  encryptedDescription: EncryptedDescription
  description: string
  key: CryptoKey
}

function createEntryEncryption(email: Ref<string>, entries: Ref<Entry[]>) {
  // Keep decrypted text and non-extractable keys out of API data and browser storage.
  const secrets = shallowReactive(new Map<string, Secret>())
  const attempts = new Map<string, number>()
  const pendingSaves = new Map<string, { secret: Secret; previousFingerprint: string | undefined }>()
  let generation = 0
  const fingerprint = (entry: Entry) => JSON.stringify(entry.encryptedDescription)

  function get(entry: Entry) {
    const secret = secrets.get(entry.id)
    return secret?.fingerprint === fingerprint(entry) ? secret : undefined
  }
  function description(entry: Entry): string | undefined {
    return entry.encryptedDescription ? get(entry)?.description : entry.description
  }
  function lock(id: string) {
    attempts.set(id, (attempts.get(id) || 0) + 1)
    secrets.delete(id)
    pendingSaves.delete(id)
  }
  function clear() {
    generation++
    secrets.clear()
    attempts.clear()
    pendingSaves.clear()
  }
  function prepareSave(entry?: Entry) {
    const currentGeneration = generation
    const id = entry?.id
    const attempt = id ? attempts.get(id) || 0 : 0
    const previousFingerprint = entry ? fingerprint(entry) : undefined
    let confirmed = false
    function isCurrent() {
      if (confirmed || currentGeneration !== generation) return false
      if (!id) return true
      const latest = entries.value.find(item => item.id === id)
      return !!latest && (attempts.get(id) || 0) === attempt && fingerprint(latest) === previousFingerprint
    }
    function confirm(result: EntrySaveResult, snapshot: EntrySaveSnapshot) {
      if (!isCurrent()) return
      confirmed = true
      const savedFingerprint = JSON.stringify(snapshot.encryptedDescription)
      if (typeof result.id !== 'string' || !result.id || (id && result.id !== id) || result.description !== '' ||
        JSON.stringify(result.encryptedDescription) !== savedFingerprint || (!id && attempts.has(result.id))) return
      // Only an acknowledged write may queue a plaintext/key snapshot for its matching GET.
      pendingSaves.set(result.id, {
        secret: { fingerprint: savedFingerprint, description: snapshot.description, key: snapshot.key },
        previousFingerprint,
      })
    }
    return { isCurrent, confirm }
  }
  async function unlockUsing(entry: Entry, decrypt: (data: EncryptedDescription) => ReturnType<typeof decryptDescription>) {
    if (!entry.encryptedDescription) return
    const currentGeneration = generation
    const attempt = (attempts.get(entry.id) || 0) + 1
    attempts.set(entry.id, attempt)
    const original = fingerprint(entry)
    const secret = await decrypt(entry.encryptedDescription)
    const latest = entries.value.find(item => item.id === entry.id)
    if (currentGeneration !== generation || attempts.get(entry.id) !== attempt || !latest || fingerprint(latest) !== original) {
      throw new Error('事项或空间已变化，请重新解锁')
    }
    secrets.set(entry.id, { ...secret, fingerprint: original })
  }
  const unlock = (entry: Entry, password: string) => unlockUsing(entry, data => decryptDescription(data, password))
  const unlockWithKey = (entry: Entry, key: CryptoKey) => unlockUsing(entry, data => decryptDescriptionWithKey(data, key))

  watch(email, clear, { flush: 'sync' })
  watch(entries, latest => {
    const items = new Map(latest.map(entry => [entry.id, entry]))
    for (const [id, pending] of pendingSaves) {
      const entry = items.get(id)
      if (entry && fingerprint(entry) === pending.secret.fingerprint) {
        const current = secrets.get(id)
        // Retain the same cache object for metadata-only saves and pending print handoffs.
        if (!current || current.fingerprint !== pending.secret.fingerprint || current.description !== pending.secret.description || current.key !== pending.secret.key) {
          secrets.set(id, pending.secret)
        }
        pendingSaves.delete(id)
      } else if (!entry || fingerprint(entry) !== pending.previousFingerprint) {
        pendingSaves.delete(id)
      }
    }
    for (const [id, secret] of secrets) {
      const entry = items.get(id)
      if (!entry || fingerprint(entry) !== secret.fingerprint) lock(id)
    }
  }, { flush: 'sync' })
  onUnmounted(clear)
  return { get, description, lock, unlock, unlockWithKey, prepareSave }
}

export type EntryEncryption = ReturnType<typeof createEntryEncryption>

const encryptionKey: InjectionKey<ReturnType<typeof createEntryEncryption>> = Symbol('entry-encryption')

export function provideEntryEncryption(email: Ref<string>, entries: Ref<Entry[]>) {
  const encryption = createEntryEncryption(email, entries)
  provide(encryptionKey, encryption)
  return encryption
}

export function useEntryEncryption() {
  const encryption = inject(encryptionKey)
  if (!encryption) throw new Error('Entry encryption provider is missing')
  return encryption
}
