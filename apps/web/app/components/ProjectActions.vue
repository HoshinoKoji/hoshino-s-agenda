<script setup lang="ts">
const props = defineProps<{ name: string; disabled: boolean; first?: boolean; last?: boolean }>()
const emit = defineEmits<{ overview: []; edit: []; up: []; down: [] }>()
const editing = ref(false)
const items = computed(() => [
  { label: '转到总览', action: 'overview', onSelect: () => emit('overview') },
  { label: '编辑', action: 'edit', onSelect: () => { editing.value = true; emit('edit') } },
  { label: '上移', action: 'up', disabled: props.first || props.disabled, onSelect: () => emit('up') },
  { label: '下移', action: 'down', disabled: props.last || props.disabled, onSelect: () => emit('down') },
])
function closeAutoFocus(event: Event) {
  // The editor owns focus after selecting Edit, rather than the menu trigger.
  if (editing.value) event.preventDefault()
}
</script>

<template>
  <UDropdownMenu
    :items="items" :disabled="disabled" size="sm"
    :content="{ align: 'end', sideOffset: 6, collisionPadding: 12, onCloseAutoFocus: closeAutoFocus }"
    :ui="{
      content: 'w-max max-w-[calc(100vw-24px)] rounded-lg bg-white ring-[#eeedf3] shadow-[0_8px_28px_#30273f14]',
      item: 'min-h-9 cursor-pointer items-center gap-2 px-2.5 py-2 text-xs text-[#6a6575] data-highlighted:text-primary data-highlighted:before:bg-[#fcebf3]',
    }"
    @update:open="open => { if (open) editing = false }"
  >
    <button class="project-menu-trigger icon-button" :aria-label="`项目操作 ${name}`" :disabled="disabled">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
    </button>
    <template #item-leading="{ item }"><span v-if="item.action === 'up' || item.action === 'down'" class="project-move-icon" aria-hidden="true">{{ item.action === 'up' ? '↑' : '↓' }}</span><AppIcon v-else :name="item.action === 'overview' ? 'grid' : 'edit'" :size="16" class="text-[#98919f] group-data-highlighted:text-primary" /></template>
  </UDropdownMenu>
</template>
