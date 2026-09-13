<script setup lang="ts">
const props = defineProps<{ title: string; busy?: boolean; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
onMounted(() => dialog.value?.showModal())
function close() { if (!props.busy) emit('close') }
</script>

<template>
  <dialog ref="dialog" class="dialog" :class="{ 'dialog-wide': wide }" aria-labelledby="dialog-title" @cancel.prevent="close" @click="($event.target === dialog) && close()">
    <div class="dialog-inner">
      <header class="dialog-header">
        <div><span class="eyebrow">MAKE ROOM FOR PROGRESS</span><h2 id="dialog-title">{{ title }}</h2></div>
        <button type="button" class="icon-button" aria-label="关闭弹窗" :disabled="busy" @click="close"><AppIcon name="close" /></button>
      </header>
      <slot />
    </div>
  </dialog>
</template>
