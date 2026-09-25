<script setup lang="ts">
import type { Asset } from '../../../../shared/types'

const props = defineProps<{ asset: Asset; email: string; eager?: boolean; original?: boolean }>()
const url = ref('')
const failed = ref(false)
watch(() => [props.asset.id, props.email, props.original], async (_value, _old, onCleanup) => {
  let cancelled = false
  let objectUrl = ''
  onCleanup(() => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) })
  url.value = ''
  failed.value = false
  if (!props.email) return
  try {
    const response = await fetch(`/api/assets/${props.asset.id}/${props.original ? 'content' : 'thumbnail'}`, { headers: { 'X-User-Email': props.email } })
    if (!response.ok) throw new Error('图片加载失败')
    const blob = await response.blob()
    if (cancelled) return
    objectUrl = URL.createObjectURL(blob)
    url.value = objectUrl
  } catch { if (!cancelled) failed.value = true }
}, { immediate: true })
</script>

<template>
  <img v-if="url" :src="url" :alt="asset.name" :loading="eager ? 'eager' : 'lazy'" decoding="async">
  <span v-else class="asset-image-placeholder" :class="{ failed }" role="status">{{ failed ? '图片加载失败' : '图片加载中…' }}</span>
</template>
