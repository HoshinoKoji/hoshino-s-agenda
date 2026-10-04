<script setup lang="ts" generic="T extends string | null">
import { CalendarDate, getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date'

const props = withDefaults(defineProps<{
  label: string
  min?: string
  disabled?: boolean
  clearable?: boolean
  required?: boolean
  placeholder?: string
  defaultDate?: string
}>(), { min: '0001-01-01', placeholder: '未设日期' })
const model = defineModel<T>({ required: true })
const { root, dialog, portal } = useDialogPortal()
const open = ref(false)
const value = computed(() => model.value ? parseDate(model.value) : undefined)
const minValue = computed(() => parseDate(props.min))
const maxValue = new CalendarDate(9999, 12, 31)
const calendarDate = shallowRef<DateValue>(value.value ?? today(getLocalTimeZone()))
watch(open, opened => {
  if (!opened) return
  const date = value.value ?? (props.defaultDate ? parseDate(props.defaultDate) : today(getLocalTimeZone()))
  calendarDate.value = date.compare(minValue.value) < 0 ? minValue.value : date.compare(maxValue) > 0 ? maxValue : date
})
watch(() => props.disabled, disabled => { if (disabled) open.value = false })

function select(value: DateValue | null | undefined) {
  if (!value || props.disabled) return
  model.value = value.toString() as T
  open.value = false
}

async function clear() {
  if (props.disabled || !props.clearable) return
  open.value = false
  model.value = null as T
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>('.date-picker-trigger')?.focus({ preventScroll: true })
}

function closeOnEscape(event: KeyboardEvent) {
  // Prevent Escape from also cancelling the enclosing native dialog.
  event.preventDefault()
  open.value = false
}
</script>

<template>
  <div ref="root" class="date-picker-field" :class="{ 'date-picker-clearable': clearable && model }">
    <UPopover v-model:open="open" :portal="portal" :content="{ align: 'start', positionStrategy: 'fixed', sideOffset: 4, collisionBoundary: dialog, collisionPadding: 8, onEscapeKeyDown: closeOnEscape }" :ui="{ content: 'agenda-date-menu' }">
      <UButton type="button" color="neutral" variant="outline" class="button date-picker-trigger" :aria-label="label" :aria-required="required || undefined" :data-empty="!model" :disabled="disabled">
        <template #leading><AppIcon name="calendar" :size="16" /></template>
        {{ model || placeholder }}
      </UButton>
      <template #content>
        <UCalendar
          :model-value="value" v-model:placeholder="calendarDate" :min-value="minValue" :max-value="maxValue" :range="false" :multiple="false"
          :disabled="disabled" :week-starts-on="1" prevent-deselect initial-focus
          class="p-2" @update:model-value="select"
        >
          <template #heading="{ value: heading, view, date, setView }">
            <UButton color="neutral" variant="ghost" block :label="view === 'day' ? `${date.year}.${date.month}` : heading" @click="setView(view === 'day' ? 'month' : view === 'month' ? 'year' : 'day')" />
          </template>
        </UCalendar>
      </template>
    </UPopover>
    <UButton v-if="clearable && model" type="button" color="neutral" variant="ghost" class="date-picker-clear" :aria-label="`清除${label}`" title="清除日期" :disabled="disabled" @click.stop="clear"><AppIcon name="close" :size="15" /></UButton>
  </div>
</template>
