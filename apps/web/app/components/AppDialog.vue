<script setup lang="ts">
const props = defineProps<{ title: string; busy?: boolean; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const titleId = useId()
onMounted(() => dialog.value?.showModal())
function close() { if (!props.busy) emit('close') }
</script>

<template>
  <dialog ref="dialog" class="dialog" :class="{ 'dialog-wide': wide }" :aria-labelledby="titleId" @cancel.prevent="close" @click="($event.target === dialog) && close()">
    <div class="dialog-inner">
      <header class="dialog-header">
        <div><h2 :id="titleId">{{ title }}</h2></div>
        <div class="dialog-header-actions"><slot name="actions" /><button type="button" class="icon-button" aria-label="关闭弹窗" :disabled="busy" @click="close"><AppIcon name="close" /></button></div>
      </header>
      <slot />
    </div>
  </dialog>
</template>
