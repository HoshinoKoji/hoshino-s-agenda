import type { Ref } from 'vue'
import type { Entry } from '../../../../shared/types'

export function useCalendarEntryDrag(root: Ref<HTMLElement | undefined>, busy: Ref<boolean>, move: (entry: Entry, date: string) => void) {
  const drag = ref<{ entry: Entry; pointer: number; startX: number; startY: number; x: number; y: number; moved: boolean; target: string | null } | null>(null)
  const draggingId = computed(() => drag.value?.moved ? drag.value.entry.id : null)
  const targetDate = computed(() => drag.value?.moved ? drag.value.target : null)
  const preview = computed(() => drag.value?.moved ? { entry: drag.value.entry, x: drag.value.x, y: drag.value.y } : null)
  let frame = 0
  let suppressClickId: string | null = null

  function targetAt(x: number, y: number) {
    const container = root.value
    if (!container) return null
    const viewport = container.getBoundingClientRect()
    if (x < viewport.left || x > viewport.right || y < viewport.top || y > viewport.bottom) return null
    for (const day of container.querySelectorAll<HTMLElement>('[data-date]')) {
      const box = day.getBoundingClientRect()
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return day.dataset.date ?? null
    }
    return null
  }

  function updateTarget() {
    if (drag.value?.moved) drag.value.target = targetAt(drag.value.x, drag.value.y)
  }

  function scrollEdge() {
    const container = root.value
    if (!drag.value?.moved || !container) return
    const bounds = container.getBoundingClientRect()
    if (container.scrollWidth > container.clientWidth && drag.value.y >= bounds.top && drag.value.y <= bounds.bottom) {
      const direction = drag.value.x < bounds.left + 32 ? -1 : drag.value.x > bounds.right - 32 ? 1 : 0
      if (direction) container.scrollLeft += direction * 12
    }
    updateTarget()
    frame = requestAnimationFrame(scrollEdge)
  }

  function stop() {
    cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', update)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', cancel)
    const state = drag.value
    drag.value = null
    return state
  }

  function suppressClick(id: string) {
    suppressClickId = id
    setTimeout(() => { suppressClickId = null }, 0)
  }

  function start(event: PointerEvent, entry: Entry) {
    if (busy.value || drag.value || !event.isPrimary || event.button !== 0) return
    drag.value = { entry, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false, target: null }
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  function update(event: PointerEvent) {
    const state = drag.value
    if (!state || state.pointer !== event.pointerId) return
    state.x = event.clientX
    state.y = event.clientY
    if (!state.moved && Math.hypot(state.x - state.startX, state.y - state.startY) >= 7) {
      state.moved = true
      frame = requestAnimationFrame(scrollEdge)
    }
    updateTarget()
  }

  function finish(event: PointerEvent) {
    if (drag.value?.pointer !== event.pointerId) return
    update(event)
    const state = stop()
    if (!state?.moved) return
    suppressClick(state.entry.id)
    if (state.target && state.target !== state.entry.date && !busy.value) move(state.entry, state.target)
  }

  function cancel(event?: PointerEvent) {
    if (!event || drag.value?.pointer === event.pointerId) {
      const state = stop()
      if (state?.moved) suppressClick(state.entry.id)
    }
  }

  function escape(event: KeyboardEvent) {
    if (!drag.value) return
    event.preventDefault()
    event.stopPropagation()
    const state = stop()
    if (state?.moved) suppressClick(state.entry.id)
  }

  function consumeClick(event: MouseEvent, id: string) {
    if (suppressClickId !== id) return false
    suppressClickId = null
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  onUnmounted(() => stop())
  return { draggingId, targetDate, preview, start, escape, consumeClick }
}
