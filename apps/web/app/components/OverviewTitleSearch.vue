<script setup lang="ts">
const model = defineModel<string>({ required: true })
const input = useTemplateRef('input')

function clear() {
  model.value = ''
  input.value?.inputRef?.focus()
}
</script>

<template>
  <UInput
    ref="input" v-model="model" type="search" class="overview-title-search"
    aria-label="搜索事项标题" placeholder="搜索事项标题" autocomplete="off"
    :ui="{ base: 'min-h-[38px] rounded-lg bg-white pe-9', trailing: 'pe-1' }"
  >
    <template #leading><AppIcon name="search" :size="16" /></template>
    <template #trailing>
      <UButton v-if="model" type="button" color="neutral" variant="ghost" size="xs" aria-label="清除标题搜索" @click="clear"><AppIcon name="close" :size="15" /></UButton>
    </template>
  </UInput>
</template>
