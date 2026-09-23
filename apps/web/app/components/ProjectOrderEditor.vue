<script setup lang="ts">
import type { Project } from '../../../../shared/types'

const props = defineProps<{ projects: Project[]; submit: (ids: string[]) => Promise<boolean>; error: string }>()
const emit = defineEmits<{ close: [] }>()
const ids = ref(props.projects.map(project => project.id))
const projectMap = computed(() => new Map(props.projects.map(project => [project.id, project])))
const list = ref<HTMLElement>()
const busy = ref(false)
const failed = ref(false)
const announcement = ref('')
const drag = ref<{ id: string; pointer: number; startX: number; startY: number; moved: boolean; before: string | null } | null>(null)
const changed = computed(() => ids.value.some((id, index) => id !== props.projects[index]?.id))

function move(id: string, before: string | null) {
  const next = ids.value.filter(value => value !== id)
  next.splice(before === null ? next.length : next.indexOf(before), 0, id)
  if (next.some((value, index) => value !== ids.value[index])) {
    ids.value = next
    announcement.value = `已将${projectMap.value.get(id)?.name}移至第 ${next.indexOf(id) + 1} 位`
  }
}
function moveByKey(id: string, delta: number) {
  if (busy.value) return
  const index = ids.value.indexOf(id)
  const target = index + delta
  if (target < 0 || target >= ids.value.length) return
  const next = [...ids.value]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  ids.value = next
  announcement.value = `已将${projectMap.value.get(id)?.name}移至第 ${target + 1} 位`
}
function start(event: PointerEvent, id: string) {
  if (busy.value || !event.isPrimary || event.button !== 0) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag.value = { id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, before: null }
}
function update(event: PointerEvent) {
  const state = drag.value
  if (!state || state.pointer !== event.pointerId || busy.value) return
  if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 5 && !state.moved) return
  state.moved = true
  const rows = [...(list.value?.querySelectorAll<HTMLElement>('[data-project-id]') || [])]
  state.before = rows.find(row => row.dataset.projectId !== state.id && event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2)?.dataset.projectId ?? null
  const bounds = list.value?.getBoundingClientRect()
  if (bounds && list.value) {
    if (event.clientY < bounds.top + 24) list.value.scrollTop -= 12
    if (event.clientY > bounds.bottom - 24) list.value.scrollTop += 12
  }
}
function finish(event: PointerEvent) {
  const state = drag.value
  drag.value = null
  if (!state || state.pointer !== event.pointerId || !state.moved || busy.value) return
  const bounds = list.value?.getBoundingClientRect()
  if (bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) move(state.id, state.before)
}
function cancelDrag(event: KeyboardEvent) {
  if (!drag.value) return
  event.preventDefault()
  event.stopPropagation()
  drag.value = null
}
async function save() {
  if (busy.value) return
  if (!changed.value) { emit('close'); return }
  busy.value = true
  failed.value = false
  try {
    if (await props.submit(ids.value)) emit('close')
    else failed.value = true
  } finally { busy.value = false }
}
</script>

<template>
  <AppDialog title="调整项目顺序" :busy="busy" @close="emit('close')">
    <p class="project-order-help">拖动项目调整顺序，也可聚焦手柄后按上下方向键。</p>
    <div ref="list" class="project-order-list" role="list" aria-label="项目排序列表" :class="{ 'project-order-drop-end': drag?.moved && drag.before === null }" @keydown.esc="cancelDrag">
      <div v-for="(id, index) in ids" :key="id" class="project-order-row" role="listitem" :data-project-id="id" :class="{ 'project-order-dragging': drag?.moved && drag.id === id, 'project-order-drop-before': drag?.moved && drag.before === id }">
        <button type="button" class="project-order-handle icon-button" :aria-label="`调整 ${projectMap.get(id)?.name} 的顺序，第 ${index + 1} 位`" :disabled="busy" @keydown.up.prevent="moveByKey(id, -1)" @keydown.down.prevent="moveByKey(id, 1)" @pointerdown="start($event, id)" @pointermove="update" @pointerup="finish" @pointercancel="drag = null" @lostpointercapture="drag = null" @click.stop.prevent>
          <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true"><circle v-for="n in 6" :key="n" :cx="n % 2 ? 3 : 9" :cy="Math.ceil(n / 2) * 5 - 1" r="1.2" /></svg>
        </button>
        <i class="project-dot" :style="{ background: projectMap.get(id)?.color }" /><span>{{ projectMap.get(id)?.name }}</span>
      </div>
    </div>
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
    <p v-if="failed" class="form-error" role="alert">{{ error || '排序保存失败，请重试。' }}</p>
    <footer class="form-footer"><span class="spacer" /><button type="button" class="button secondary" :disabled="busy" @click="emit('close')">取消</button><button type="button" class="button primary" :disabled="busy || !changed" @click="save">{{ busy ? '保存中…' : '保存排序' }}</button></footer>
  </AppDialog>
</template>
