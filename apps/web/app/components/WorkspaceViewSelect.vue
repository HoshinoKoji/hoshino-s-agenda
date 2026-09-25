<script setup lang="ts">
const model = defineModel<'calendar' | 'overview' | 'assets'>({ required: true })
const items = [
  { label: '项目日历', value: 'calendar' },
  { label: '项目总览', value: 'overview' },
  { label: '素材库', value: 'assets' },
]
</script>

<template>
  <USelect
    v-model="model" :items="items" aria-label="工作台视图" variant="none" size="sm"
    :content="{ align: 'start', sideOffset: 6, collisionPadding: 12 }"
    :ui="{
      base: 'min-h-8 cursor-pointer rounded-md ps-2 pe-7 text-xs font-medium text-[#6a6575] hover:bg-[#fcebf3] hover:text-primary data-[state=open]:bg-[#fcebf3] data-[state=open]:text-primary focus-visible:outline-2 focus-visible:outline-primary',
      trailing: 'pe-2',
      trailingIcon: 'size-3.5 text-[#98919f] transition-transform group-data-[state=open]:rotate-180 group-data-[state=open]:text-primary',
      content: 'w-max max-w-[calc(100vw-24px)] rounded-lg bg-white ring-[#eeedf3] shadow-[0_8px_28px_#30273f14]',
      group: 'p-1',
      item: 'min-h-9 cursor-pointer items-center gap-2 px-2.5 py-2 text-xs text-[#6a6575] data-highlighted:not-data-disabled:text-primary data-highlighted:not-data-disabled:before:bg-[#fff4f8] data-[state=checked]:text-primary data-[state=checked]:before:bg-[#fcebf3]',
      itemTrailingIcon: 'size-3.5 text-primary',
    }"
  >
    <template #item-leading="{ item }">
      <AppIcon :name="item.value === 'calendar' ? 'calendar' : item.value === 'overview' ? 'grid' : 'file'" :size="16" class="text-[#98919f] group-data-highlighted:text-primary group-data-[state=checked]:text-primary" />
    </template>
  </USelect>
</template>
