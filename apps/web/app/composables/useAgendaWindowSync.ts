import { onMounted, onUnmounted, watch, type Ref } from 'vue'

/** Send invalidations only: every window reads its own cloud data. */
export function useAgendaWindowSync(email: Ref<string>, busy: Ref<boolean>, refresh: () => Promise<void>) {
  let channel: BroadcastChannel | undefined
  let pending = false
  function drain() {
    if (!pending || busy.value || !email.value) return
    pending = false
    void refresh()
  }
  onMounted(() => {
    try {
      channel = new BroadcastChannel('agenda:changes')
      channel.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (!data || typeof data !== 'object') return
        const message = data as Record<string, unknown>
        if (message.type !== 'changed' || message.email !== email.value) return
        pending = true
        drain()
      }
    } catch { /* Manual sync remains available without BroadcastChannel. */ }
  })
  watch(busy, drain)
  watch(email, () => { pending = false }, { flush: 'sync' })
  onUnmounted(() => channel?.close())
  return {
    notify(account: string) {
      try { channel?.postMessage({ type: 'changed', email: account }) } catch { /* The write has already succeeded. */ }
    },
  }
}
