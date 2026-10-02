<script setup lang="ts">
import { CalendarDate, getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date'
import type { OverviewDateFilter } from '~/utils/overviewDates'

const model = defineModel<OverviewDateFilter>({ required: true })
const open = ref(false)
const draft = shallowRef<{ start: DateValue | undefined; end: DateValue | undefined }>({ start: undefined, end: undefined })
const placeholder = shallowRef<DateValue>(today(getLocalTimeZone()))
const minValue = new CalendarDate(1, 1, 1)
const maxValue = new CalendarDate(9999, 12, 31)
const canApply = computed(() => !!draft.value.start && !!draft.value.end && draft.value.start.compare(draft.value.end) <= 0)

watch(open, value => {
  if (!value) return
  if (model.value.type === 'range') {
    draft.value = { start: parseDate(model.value.start), end: parseDate(model.value.end) }
    placeholder.value = draft.value.start!
  } else {
    draft.value = { start: undefined, end: undefined }
    placeholder.value = today(getLocalTimeZone())
  }
})
watch(model, () => { open.value = false })

function updateRange(value: { start: DateValue | undefined; end: DateValue | undefined } | null) {
  draft.value = value || { start: undefined, end: undefined }
}

function apply() {
  const { start, end } = draft.value
  if (!start || !end || start.compare(end) > 0) return
  model.value = { type: 'range', start: start.toString(), end: end.toString() }
  open.value = false
}

function select(type: 'all' | 'undated') {
  model.value = { type }
  open.value = false
}
</script>

<template>
  <div class="overview-date-filter">
    <div class="view-switch" role="group" aria-label="总览日期筛选">
      <button type="button" :aria-pressed="model.type === 'all'" @click="select('all')">全部日期</button>
      <UPopover v-model:open="open" :content="{ align: 'start', collisionPadding: 12 }">
        <button type="button" :aria-pressed="model.type === 'range'">时间段</button>
        <template #content>
          <div class="overview-date-popover" role="group" aria-label="选择筛选时间段">
            <h3>筛选时间段</h3>
            <p>选择开始和结束日期，包含起止当天。</p>
            <UCalendar
              :model-value="draft" v-model:placeholder="placeholder" :range="true" :multiple="false"
              :min-value="minValue" :max-value="maxValue" :week-starts-on="1" prevent-deselect initial-focus
              @update:model-value="updateRange"
            >
              <template #heading="{ value: heading, view, date, setView }">
                <UButton color="neutral" variant="ghost" block :label="view === 'day' ? `${date.year}.${date.month}` : heading" @click="setView(view === 'day' ? 'month' : view === 'month' ? 'year' : 'day')" />
              </template>
            </UCalendar>
            <p class="overview-date-draft" aria-live="polite">{{ draft.start?.toString() || '开始日期' }} — {{ draft.end?.toString() || '结束日期' }}</p>
            <div class="overview-date-popover-actions">
              <button type="button" class="text-button" @click="select('all')">清除筛选</button>
              <button type="button" class="button primary" :disabled="!canApply" @click="apply">应用</button>
            </div>
          </div>
        </template>
      </UPopover>
      <button type="button" :aria-pressed="model.type === 'undated'" @click="select('undated')">无日期</button>
    </div>
    <span v-if="model.type === 'range'" class="overview-date-range">{{ model.start }} — {{ model.end }}</span>
    <button v-if="model.type !== 'all'" type="button" class="text-button overview-date-reset" @click="select('all')">清除筛选</button>
  </div>
</template>
