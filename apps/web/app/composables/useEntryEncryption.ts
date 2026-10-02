import { inject, provide, shallowReactive, watch, onUnmounted, type InjectionKey, type Ref } from 'vue'
import type { EncryptedDescription, Entry } from '../../../../shared/types'
import { decryptDescription, decryptDescriptionWithKey } from '../../../../shared/encryption'

interface Secret {
  fingerprint: string
  description: string
  key: CryptoKey
}

function createEntryEncryption(email: Ref<string>, entries: Ref<Entry[]>) {
  // Keep decrypted text and non-extractable keys out of API data and browser storage.
  const secrets = shallowReactive(new Map<string, Secret>())
  const attempts = new Map<string, number>()
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
  }
  function clear() {
    generation++
    secrets.clear()
    attempts.clear()
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
    for (const [id, secret] of secrets) {
      const entry = items.get(id)
      if (!entry || fingerprint(entry) !== secret.fingerprint) lock(id)
    }
  }, { flush: 'sync' })
  onUnmounted(clear)
  return { get, description, lock, unlock, unlockWithKey }
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
