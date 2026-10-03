<script setup lang="ts">
import type { Asset } from '../../../../shared/types'

defineProps<{ asset: Asset; email: string; disabled?: boolean }>()
const emit = defineEmits<{ select: [] }>()
const button = ref<HTMLButtonElement>()
const dialog = shallowRef<HTMLDialogElement>()
const open = ref(false)
// Stay in the native dialog's top layer, outside the scrolling options and form.
onMounted(() => { dialog.value = button.value?.closest('dialog') ?? undefined })
function closeOnEscape(event: KeyboardEvent) {
  // Close the preview without also cancelling the enclosing native dialog.
  event.preventDefault()
  open.value = false
}
</script>

<template>
  <UTooltip
    v-model:open="open" :disabled="!asset.image || disabled" :portal="dialog ?? true" :delay-duration="300"
    :content="{ side: 'top', align: 'start', ariaLabel: `图片缩略图 ${asset.name}`, collisionBoundary: dialog, collisionPadding: 12, onEscapeKeyDown: closeOnEscape }"
    :ui="{ content: 'asset-picker-preview h-auto flex-col items-stretch p-2' }"
  >
    <button ref="button" type="button" :disabled="disabled" @click="emit('select')"><AppIcon :name="asset.image ? 'grid' : 'file'" :size="16" /><span>{{ asset.name }}</span></button>
    <template #content>
      <div class="asset-picker-preview-image"><AssetImage :asset="asset" :email="email" eager /></div>
      <p class="asset-picker-preview-name">{{ asset.name }}</p>
    </template>
  </UTooltip>
</template>
