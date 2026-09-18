<script setup lang="ts">
import type { Project } from '../../../../shared/types'

const props = defineProps<{ projects: Project[]; activeProject: string; counts: Map<string, number>; busy: boolean }>()
const emit = defineEmits<{ select: [id: string]; overview: [id: string]; edit: [project: Project]; reorder: [ids: string[]] }>()
const list = ref<HTMLElement>()
const drag = ref<{ id: string; pointer: number; startX: number; startY: number; moved: boolean; before: string | null } | null>(null)

function reorder(id: string, before: string | null) {
  const ids = props.projects.map(project => project.id)
  const next = ids.filter(value => value !== id)
  next.splice(before === null ? next.length : next.indexOf(before), 0, id)
  if (next.some((value, index) => value !== ids[index])) {
    emit('reorder', next)
  }
}
function move(index: number, delta: number) {
  if (props.busy || index + delta < 0 || index + delta >= props.projects.length) return
  const ids = props.projects.map(project => project.id)
  ;[ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]
  emit('reorder', ids)
}
function start(event: PointerEvent, id: string) {
  if (props.busy || !event.isPrimary || event.button !== 0) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag.value = { id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, before: null }
}
function update(event: PointerEvent) {
  const state = drag.value
  if (!state || state.pointer !== event.pointerId || props.busy) return
  if (Math.hypot(event.clientY - state.startY, event.clientX - state.startX) < 5 && !state.moved) return
  state.moved = true
  const rows = [...(list.value?.querySelectorAll<HTMLElement>('[data-project-id]') || [])]
  const horizontal = list.value && getComputedStyle(list.value).display === 'flex'
  state.before = rows.find(row => row.dataset.projectId !== state.id && (horizontal
    ? event.clientX < row.getBoundingClientRect().left + row.offsetWidth / 2
    : event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2))?.dataset.projectId ?? null
  const scroller = list.value?.parentElement
  if (horizontal && scroller) {
    const rect = scroller.getBoundingClientRect()
    if (event.clientX < rect.left + 30) scroller.scrollLeft -= 16
    if (event.clientX > rect.right - 30) scroller.scrollLeft += 16
  }
  const bounds = scroller?.getBoundingClientRect()
  if (!horizontal && bounds && scroller) {
    if (event.clientY < bounds.top + 24) scroller.scrollTop -= 12
    if (event.clientY > bounds.bottom - 24) scroller.scrollTop += 12
  }
}
function finish(event: PointerEvent) {
  const state = drag.value
  drag.value = null
  if (!state || state.pointer !== event.pointerId || !state.moved || props.busy) return
  const bounds = list.value?.getBoundingClientRect()
  if (bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) reorder(state.id, state.before)
}
watch(() => props.busy, () => { drag.value = null })
watch(() => props.projects, () => { drag.value = null })
</script>

<template>
  <div ref="list" class="project-list" :class="{ 'project-drop-end': drag?.moved && drag.before === null }" @keydown.esc="drag = null">
    <div v-for="(project, index) in projects" :key="project.id" :data-project-id="project.id" class="project-nav-row" :class="{ active: activeProject === project.id, 'project-dragging': drag?.moved && drag.id === project.id, 'project-drop-before': drag?.moved && drag.before === project.id }">
      <button class="project-drag-handle icon-button" :aria-label="`拖动排序 ${project.name}`" :title="'拖动排序，也可使用右侧菜单上移或下移'" :disabled="busy || projects.length < 2" @pointerdown="start($event, project.id)" @pointermove="update" @pointerup="finish" @pointercancel="drag = null" @lostpointercapture="drag = null" @click.stop.prevent>
        <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true"><circle v-for="n in 6" :key="n" :cx="n % 2 ? 3 : 9" :cy="Math.ceil(n / 2) * 5 - 1" r="1.2" /></svg>
      </button>
      <button class="nav-item" :aria-pressed="activeProject === project.id" @click="emit('select', project.id)"><i class="project-dot" :style="{ background: project.color }" /><span class="truncate">{{ project.name }}</span><span class="count">{{ counts.get(project.id) || 0 }}</span></button>
      <ProjectActions :name="project.name" :disabled="busy" :first="index === 0" :last="index === projects.length - 1" @overview="emit('overview', project.id)" @edit="emit('edit', project)" @up="move(index, -1)" @down="move(index, 1)" />
    </div>
    <p v-if="!projects.length && !busy" class="sidebar-empty">(空)</p>
  </div>
</template>
