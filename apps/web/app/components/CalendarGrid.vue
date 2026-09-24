<script setup lang="ts">
import type { Entry, Project } from '../../../../shared/types'
import { dateKey } from '~/utils/dates'
const props = defineProps<{ month: Date; selected: string; today: string; entries: Entry[]; allEntries: Entry[]; projects: Project[]; busy: boolean }>()
const emit = defineEmits<{ select: [date: string]; edit: [entry: Entry]; add: [date: string]; move: [entry: Entry, date: string] }>()
const scroll = ref<HTMLElement>()
const { draggingId, targetDate, preview, start, escape, consumeClick } = useCalendarEntryDrag(scroll, computed(() => props.busy), (entry, date) => emit('move', entry, date))
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const projectMap = computed(() => new Map(props.projects.map(project => [project.id, project])))
const entriesByDate = computed(() => {
  const map = new Map<string, Entry[]>()
  for (const entry of props.entries) {
    if (entry.date !== null) map.set(entry.date, [...(map.get(entry.date) || []), entry])
  }
  return map
})
const days = computed(() => {
  const start = new Date(props.month.getFullYear(), props.month.getMonth(), 1, 12)
  start.setDate(1 - (start.getDay() + 6) % 7)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const key = dateKey(date)
    return { key, number: date.getDate(), current: date.getMonth() === props.month.getMonth(), weekend: index % 7 > 4, entries: entriesByDate.value.get(key) || [] }
  })
})
function revealSelected() {
  const container = scroll.value
  if (!container || container.scrollWidth <= container.clientWidth) return
  const day = [...container.querySelectorAll<HTMLElement>('[data-date]')].find(element => element.dataset.date === props.selected)
  if (!day) return
  const bounds = container.getBoundingClientRect()
  const target = day.getBoundingClientRect()
  container.scrollLeft += (target.left + target.right - bounds.left - bounds.right) / 2
}
onMounted(revealSelected)
watch(() => [props.month, props.selected], () => nextTick(revealSelected))
</script>

<template>
  <div ref="scroll" class="calendar-scroll" :class="{ 'calendar-is-dragging': draggingId }" @keydown.esc="escape">
    <div class="calendar-grid" role="group" aria-label="月日历">
      <div v-for="(day, index) in weekdays" :key="day" class="weekday" :class="{ weekend: index > 4 }">{{ day }}</div>
      <div v-for="day in days" :key="day.key" class="calendar-day" :class="{ 'other-month': !day.current, 'is-selected': day.key === selected, 'is-today': day.key === today, 'calendar-drop-target': day.key === targetDate, weekend: day.weekend }" :data-date="day.key">
        <button class="day-select" :aria-label="`选择 ${day.key}${day.key === today ? '，今天' : ''}`" :aria-pressed="day.key === selected" @click="emit('select', day.key)"><span class="day-number">{{ day.number }}</span><span v-if="day.key === today" class="today-label">今天</span><span v-if="day.entries.length" class="mobile-count">{{ day.entries.length }} 项</span></button>
        <button class="day-add" :aria-label="`在 ${day.key} 添加事项`" @click="emit('add', day.key)"><AppIcon name="plus" :size="14" /></button>
        <div class="day-entries">
          <EntryTooltip v-for="entry in day.entries.slice(0, 3)" :key="entry.id" :entry="entry" :entries="allEntries" :projects="projects">
            <button class="calendar-entry" :class="{ completed: entry.completed, 'calendar-entry-dragging': draggingId === entry.id }" :style="{ '--project-color': projectMap.get(entry.projectId)?.color || '#8574D8' }" :disabled="busy" aria-description="拖动可更改日期" @pointerdown="start($event, entry)" @click="consumeClick($event, entry.id) || emit('edit', entry)"><AppIcon v-if="entry.completed" name="check" :size="12" /><i v-else class="entry-tick" /><span>{{ entry.title }}</span><AppIcon v-if="entry.references.length" name="link" :size="11" /></button>
          </EntryTooltip>
          <button v-if="day.entries.length > 3" class="more-entries" @click="emit('select', day.key)">还有 {{ day.entries.length - 3 }} 项</button>
        </div>
      </div>
    </div>
    <CalendarDragPreview v-if="preview" :entry="preview.entry" :projects="projects" :x="preview.x" :y="preview.y" />
  </div>
</template>
