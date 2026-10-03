import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import type { Entry } from '../../../../shared/types'
import type { EntryEncryption } from './useEntryEncryption'

const TIMEOUT = 30_000
const TOKEN_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/

interface Identity {
  email: string
  entryId: string
  fingerprint: string
}

function matches(value: unknown, identity: Identity): value is Identity & { type?: unknown; key?: CryptoKey } {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return message.email === identity.email && message.entryId === identity.entryId && message.fingerprint === identity.fingerprint
}

/** One-shot key handoffs; accepted page caches are independent of their source. */
export function useEntryUnlockTransfer(email: Ref<string>, entries: Ref<Entry[]>, encryption: EntryEncryption, purpose: 'print' | 'edit') {
  const pending = new Set<() => void>()

  function open(token: string) {
    if (typeof BroadcastChannel === 'undefined') return
    let channel: BroadcastChannel
    try { channel = new BroadcastChannel(`agenda:${purpose}-unlock:` + token) } catch { return }
    let closed = false
    let stopWatching: (() => void) | undefined
    const timer = setTimeout(close, TIMEOUT)
    function close() {
      if (closed) return
      closed = true
      clearTimeout(timer)
      stopWatching?.()
      channel.onmessage = null
      channel.onmessageerror = null
      channel.close()
      pending.delete(close)
    }
    function observe(stop: () => void) {
      if (closed) stop()
      else stopWatching = stop
    }
    pending.add(close)
    channel.onmessageerror = close
    return { channel, close, observe }
  }

  function clear() { for (const close of pending) close() }
  onMounted(() => window.addEventListener('pagehide', clear))
  onUnmounted(() => { clear(); window.removeEventListener('pagehide', clear) })

  function prepareExport(entry: Entry): string {
    const secret = encryption.get(entry)
    if (!entry.encryptedDescription || !secret) return ''
    const token = crypto.randomUUID()
    const session = open(token)
    if (!session) return ''
    const { channel, close, observe } = session
    const identity: Identity = { email: email.value, entryId: entry.id, fingerprint: secret.fingerprint }
    let sent = false
    function valid() {
      const latest = entries.value.find(item => item.id === entry.id)
      return email.value === identity.email && !!latest && encryption.get(latest) === secret
    }
    observe(watch([email, entries, () => encryption.get(entry)], () => { if (!valid()) close() }, { flush: 'sync' }))
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (matches(data, identity) && data.type === 'received' && sent) { close(); return }
      if (!data || typeof data !== 'object' || (data as Record<string, unknown>).type !== 'request' || sent) return
      try {
        if (!matches(data, identity) || !valid()) {
          channel.postMessage({ type: 'unavailable' })
          close()
          return
        }
        // Structured cloning preserves extractable:false; neither password nor plaintext is sent.
        channel.postMessage({ ...identity, type: 'key', key: secret.key })
        sent = true
      } catch {
        try { channel.postMessage({ type: 'unavailable' }) } catch { /* Manual unlock remains available. */ }
        close()
      }
    }
    return token
  }

  function receiveExport(entryId: string, token: string) {
    if (!entryId || !email.value || !TOKEN_PATTERN.test(token)) return
    const session = open(token)
    if (!session) return
    const { channel, close, observe } = session
    const account = email.value
    let requested: Identity | undefined
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (data && typeof data === 'object' && (data as Record<string, unknown>).type === 'unavailable') { close(); return }
      if (!requested || !matches(data, requested) || data.type !== 'key') return
      const entry = entries.value.find(item => item.id === entryId)
      if (email.value !== account || !entry || JSON.stringify(entry.encryptedDescription) !== requested.fingerprint || encryption.get(entry)) {
        close()
        return
      }
      try { channel.postMessage({ ...requested, type: 'received' }) } catch { /* The source may already have closed. */ }
      // End the handoff before decrypting: subsequent source locks cannot revoke this page.
      close()
      void encryption.unlockWithKey(entry, data.key as CryptoKey).catch(() => { /* Fall back to the password input. */ })
    }
    observe(watch([email, entries, () => {
      const entry = entries.value.find(item => item.id === entryId)
      return entry && encryption.get(entry)
    }], () => {
      if (email.value !== account) { close(); return }
      const entry = entries.value.find(item => item.id === entryId)
      if (!entry) { if (requested) close(); return }
      if (!entry.encryptedDescription || encryption.get(entry)) { close(); return }
      const fingerprint = JSON.stringify(entry.encryptedDescription)
      if (requested) { if (fingerprint !== requested.fingerprint) close(); return }
      requested = { email: account, entryId, fingerprint }
      try { channel.postMessage({ ...requested, type: 'request' }) } catch { close() }
    }, { immediate: true, flush: 'sync' }))
  }

  return { prepareExport, receiveExport }
}
