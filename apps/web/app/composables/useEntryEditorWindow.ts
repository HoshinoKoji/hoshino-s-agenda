import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

const PREFIX = 'agenda:edit-window:'
const TOKEN_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/
const TIMEOUT = 30_000

export function useEntryEditorWindow(email: Ref<string>) {
  const opening = ref(false)
  const error = ref('')
  let cancelPending: (() => void) | undefined
  const receivers = new Set<() => void>()
  function cancel() { cancelPending?.(); for (const close of receivers) close(); error.value = '' }
  watch(email, cancel, { flush: 'sync' })
  onMounted(() => window.addEventListener('pagehide', cancel))
  onUnmounted(() => { cancel(); window.removeEventListener('pagehide', cancel) })

  function open(entryId: string, date: string | null, projectId: string, unlockToken: string, onReady: () => void, fromDialog = true) {
    cancel()
    const token = crypto.randomUUID()
    const account = email.value
    const query = new URLSearchParams(entryId ? { editEntry: entryId } : { newEntry: '1', project: projectId, date: date ?? '' })
    const fragment = new URLSearchParams({ editSession: token })
    if (unlockToken) fragment.set('editUnlock', unlockToken)
    let channel: BroadcastChannel | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let closed = false
    let contextSent = false
    function close() {
      if (closed) return
      closed = true
      clearTimeout(timer)
      channel?.close()
      opening.value = false
      cancelPending = undefined
    }
    try {
      channel = new BroadcastChannel(PREFIX + token)
      channel.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (!data || typeof data !== 'object') return
        const message = data as Record<string, unknown>
        if (message.type === 'request-context' && message.entryId === entryId && email.value === account && !contextSent) {
          contextSent = true
          try { channel?.postMessage({ type: 'context', email: account, entryId }) } catch { close() }
          return
        }
        if (message.type !== 'ready' || message.email !== account || message.entryId !== entryId || email.value !== account) return
        close()
        onReady()
      }
      opening.value = true
      cancelPending = close
      timer = setTimeout(() => {
        close()
        error.value = '未收到编辑标签页的打开确认。请检查浏览器是否拦截新标签页' + (fromDialog ? '，或在新标签页加载完成后手动关闭此弹窗；当前输入已保留。' : '，或切换至已打开的编辑标签页。')
      }, TIMEOUT)
    } catch {
      close()
      fragment.delete('editSession')
      error.value = fromDialog ? '浏览器无法确认编辑标签页是否打开。请在新标签页加载完成后手动关闭此弹窗；当前输入已保留。' : '浏览器无法确认编辑标签页是否打开，请切换至新标签页查看事项。'
    }
    try {
      // Keep the user gesture; noopener returns null even when opening succeeds.
      window.open(`/?${query}#${fragment}`, '_blank', 'noopener')
    } catch {
      close()
      error.value = fromDialog ? '编辑标签页打开失败，当前输入已保留，请检查浏览器设置后重试。' : '编辑标签页打开失败，请检查浏览器设置后重试。'
    }
  }

  function receiveContext(token: string, entryId: string): Promise<string | undefined> {
    if (!TOKEN_PATTERN.test(token)) return Promise.resolve(undefined)
    return new Promise(resolve => {
      let channel: BroadcastChannel
      try { channel = new BroadcastChannel(PREFIX + token) } catch { resolve(undefined); return }
      const timer = setTimeout(() => close(), TIMEOUT)
      let closed = false
      function close(account?: string) {
        if (closed) return
        closed = true
        clearTimeout(timer)
        channel.close()
        receivers.delete(close)
        resolve(account)
      }
      receivers.add(close)
      channel.onmessageerror = () => close()
      channel.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (!data || typeof data !== 'object') return
        const message = data as Record<string, unknown>
        if (message.type === 'context' && message.entryId === entryId && typeof message.email === 'string' && message.email) close(message.email)
      }
      try { channel.postMessage({ type: 'request-context', entryId }) } catch { close() }
    })
  }

  function announceReady(token: string, entryId: string) {
    if (!TOKEN_PATTERN.test(token) || !email.value) return
    try {
      const channel = new BroadcastChannel(PREFIX + token)
      channel.postMessage({ type: 'ready', email: email.value, entryId })
      channel.close()
    } catch { /* The page works independently without a source acknowledgement. */ }
  }
  return { opening, error, open, cancel, receiveContext, announceReady }
}
