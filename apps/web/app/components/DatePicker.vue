<script setup lang="ts">
import { CalendarDate, parseDate, type DateValue } from '@internationalized/date'

const props = withDefaults(defineProps<{
  label: string
  min?: string
  disabled?: boolean
  portal?: boolean
}>(), { min: '0001-01-01', portal: true })
const model = defineModel<string>({ required: true })
const open = ref(false)
const value = computed(() => parseDate(model.value))
const minValue = computed(() => parseDate(props.min))
const maxValue = new CalendarDate(9999, 12, 31)

function select(value: DateValue | null | undefined) {
  if (!value || props.disabled) return
  model.value = value.toString()
  open.value = false
}

function closeOnEscape(event: KeyboardEvent) {
  // Prevent Escape from also cancelling the enclosing native dialog.
  event.preventDefault()
  open.value = false
}
</script>

<template>
  <UPopover v-model:open="open" :portal="portal" :content="{ align: 'start', onEscapeKeyDown: closeOnEscape }">
    <button type="button" class="button date-picker-trigger" :aria-label="label" :disabled="disabled">
      <AppIcon name="calendar" :size="16" />{{ model }}
    </button>
    <template #content>
      <UCalendar
        :model-value="value" :min-value="minValue" :max-value="maxValue" :range="false" :multiple="false"
        :disabled="disabled" :week-starts-on="1" prevent-deselect initial-focus
        class="p-2" @update:model-value="select"
      >
        <template #heading="{ value: heading, view, date, setView }">
          <UButton color="neutral" variant="ghost" block :label="view === 'day' ? `${date.year}.${date.month}` : heading" @click="setView(view === 'day' ? 'month' : view === 'month' ? 'year' : 'day')" />
        </template>
      </UCalendar>
    </template>
  </UPopover>
</template>
