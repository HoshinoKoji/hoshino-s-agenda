<script setup lang="ts">
import type { Entry, Project } from '../../../../shared/types'
import { dateKey } from '~/utils/dates'

const props = defineProps<{ start: Date; selected: string; today: string; entries: Entry[]; allEntries: Entry[]; projects: Project[]; busy: boolean }>()
const emit = defineEmits<{ select: [date: string]; edit: [entry: Entry]; add: [date: string]; move: [entry: Entry, date: string] }>()
const calendar = ref<HTMLElement>()
const { draggingId, targetDate, preview, start, escape, consumeClick } = useCalendarEntryDrag(calendar, computed(() => props.busy), (entry, date) => emit('move', entry, date))
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const touch = ref(false)
onMounted(() => { touch.value = window.matchMedia('(hover: none)').matches })
const projectMap = computed(() => new Map(props.projects.map(project => [project.id, project])))
const entriesByDate = computed(() => {
  const map = new Map<string, Entry[]>()
  for (const entry of props.entries) {
    if (entry.date !== null) map.set(entry.date, [...(map.get(entry.date) || []), entry])
  }
  return map
})
const days = computed(() => weekdays.map((weekday, index) => {
  const date = new Date(props.start)
  date.setDate(date.getDate() + index)
  const key = dateKey(date)
  return { key, weekday, label: `${date.getMonth() + 1}.${date.getDate()}`, weekend: index > 4, entries: entriesByDate.value.get(key) || [] }
}))
</script>

<template>
  <div ref="calendar" class="calendar-week" :class="{ 'calendar-is-dragging': draggingId }" role="group" aria-label="周日历" @keydown.esc="escape">
    <div v-for="day in days" :key="day.key" class="week-row" :class="{ 'is-selected': day.key === selected, 'is-today': day.key === today, 'calendar-drop-target': day.key === targetDate, weekend: day.weekend }" :data-date="day.key">
      <button class="week-date" :aria-label="`选择 ${day.key}${day.key === today ? '，今天' : ''}`" :aria-pressed="day.key === selected" @click="emit('select', day.key)"><span class="week-weekday">{{ day.weekday }}</span><span class="day-number">{{ day.label }}</span><span v-if="day.key === today" class="week-today">今天</span></button>
      <div class="week-entries">
        <template v-if="day.entries.length">
          <EntryTooltip v-for="entry in day.entries" :key="entry.id" :entry="entry" :entries="allEntries" :projects="projects" :tap="touch">
            <button class="week-entry" :class="{ completed: entry.completed, 'calendar-entry-dragging': draggingId === entry.id }" :style="{ '--project-color': projectMap.get(entry.projectId)?.color || '#8574D8' }" :aria-label="`${entry.title}${touch ? '，查看详情' : '，编辑事项'}`" aria-description="拖动可更改日期" :disabled="busy" @pointerdown="start($event, entry)" @click="consumeClick($event, entry.id) || (touch ? undefined : emit('edit', entry))"><AppIcon v-if="entry.completed" name="check" :size="13" /><i v-else class="entry-tick" /><span>{{ entry.title }}</span></button>
          </EntryTooltip>
        </template>
        <span v-else class="week-empty">暂无事项</span>
      </div>
      <button class="week-add icon-button" :aria-label="`在 ${day.key} 添加事项`" @click="emit('add', day.key)"><AppIcon name="plus" :size="15" /></button>
    </div>
    <CalendarDragPreview v-if="preview" :entry="preview.entry" :projects="projects" :x="preview.x" :y="preview.y" />
  </div>
</template>
