<script setup lang="ts" generic="T extends string">
const props = defineProps<{ label: string; items: { label: string; value: T }[]; disabled?: boolean; required?: boolean }>()
const model = defineModel<T>({ required: true })
const { root, dialog, portal } = useDialogPortal()
const id = useId()
const open = ref(false)
// Reka reserves an empty string for clearing its value; our "不重复" is a real option.
const emptyValue = 'agenda:empty-option'
const items = computed<{ label: string; value: string }[]>(() => props.items.map(item => ({ label: item.label, value: item.value || emptyValue })))
const selection = computed<string>({ get: () => model.value || emptyValue, set: value => { model.value = (value === emptyValue ? '' : value) as T } })
watch(() => props.disabled, disabled => { if (disabled) open.value = false })
function closeOnEscape(event: KeyboardEvent) {
  event.preventDefault()
  open.value = false
}
</script>

<template>
  <div ref="root" class="field">
    <label :for="id">{{ label }}</label>
    <USelect
      :id="id" v-model="selection" v-model:open="open" :items="items" :aria-label="label"
      :disabled="disabled" :required="required" :portal="portal" variant="none"
      :content="{ position: 'popper', positionStrategy: 'fixed', align: 'start', sideOffset: 4, collisionBoundary: dialog, collisionPadding: 8, onEscapeKeyDown: closeOnEscape }"
      :ui="{
        base: 'agenda-form-select',
        content: 'agenda-select-menu rounded-lg bg-white ring-[#eeedf3] shadow-[0_8px_28px_#30273f14]',
        item: 'cursor-pointer data-highlighted:not-data-disabled:text-primary data-highlighted:not-data-disabled:before:bg-[#fff4f8] data-[state=checked]:text-primary',
        itemTrailingIcon: 'text-primary',
      }"
    />
  </div>
</template>
