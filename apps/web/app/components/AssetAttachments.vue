<script setup lang="ts">
import type { Asset } from '../../../../shared/types'
const props = defineProps<{ assets: Asset[]; email: string; printable?: boolean }>()
const expanded = ref<Asset | null>(null)
const downloading = ref('')
const error = ref('')
async function download(asset: Asset) {
  downloading.value = asset.id
  error.value = ''
  try {
    const response = await fetch(`/api/assets/${asset.id}/content`, { headers: { 'X-User-Email': props.email } })
    if (!response.ok) throw new Error('下载失败，请重试')
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = asset.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (cause) { error.value = (cause as Error).message }
  finally { downloading.value = '' }
}
</script>

<template>
  <section v-if="assets.length" class="asset-attachments" aria-label="事项附件">
    <span class="asset-section-label">附件 · {{ assets.length }}</span>
    <div class="asset-attachment-list">
      <div v-for="asset in assets" :key="asset.id" class="asset-attachment">
        <button v-if="asset.image && !printable" type="button" class="asset-preview-button" :aria-label="`预览图片 ${asset.name}`" @click="expanded = asset"><AssetImage :asset="asset" :email="email" /></button>
        <AssetImage v-else-if="asset.image" class="asset-print-image" :asset="asset" :email="email" eager />
        <span v-else class="asset-file-symbol"><AppIcon name="file" :size="20" /></span>
        <button v-if="!printable" type="button" class="asset-download" :disabled="!!downloading" @click="download(asset)">{{ asset.name }}</button>
        <span v-else class="asset-download">{{ asset.name }}</span>
      </div>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
  <AppDialog v-if="expanded" :title="expanded.name" wide @close="expanded = null"><div class="asset-expanded-image"><AssetImage :asset="expanded" :email="email" /></div><button class="button secondary" @click="download(expanded)">下载原图</button></AppDialog>
</template>
