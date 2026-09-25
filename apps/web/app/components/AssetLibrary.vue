<script setup lang="ts">
import type { Asset } from '../../../../shared/types'
const props = defineProps<{
  assets: Asset[]; email: string; loading: boolean; busy: boolean
  upload: (file: File) => Promise<Asset>; remove: (id: string) => Promise<void>
}>()
const query = ref('')
const kind = ref<'all' | 'image' | 'file'>('all')
const error = ref('')
const pending = ref(false)
const downloading = ref('')
const deleting = ref('')
const selected = ref<Asset | null>(null)
const shown = computed(() => props.assets.filter(asset =>
  (kind.value === 'all' || asset.image === (kind.value === 'image')) &&
  asset.name.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
async function uploadFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  pending.value = true
  error.value = ''
  try { for (const file of files) await props.upload(file) }
  catch (cause) { error.value = (cause as Error).message }
  finally { pending.value = false }
}
async function remove(asset: Asset) {
  error.value = ''
  try { await props.remove(asset.id); deleting.value = '' }
  catch (cause) { error.value = (cause as Error).message }
}
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
  <section class="asset-library" aria-label="素材库" :aria-busy="loading || pending">
    <header class="overview-toolbar"><div class="month-heading"><h2>素材库</h2><span class="muted">{{ assets.length }} 个素材</span></div><label class="button primary asset-upload-button"><AppIcon name="plus" :size="16" />上传素材<input type="file" multiple :disabled="busy || pending" aria-label="上传素材" @change="uploadFiles"></label></header>
    <div class="asset-library-filters"><input v-model="query" type="search" aria-label="搜索素材" placeholder="搜索文件名"><div class="view-switch" role="group" aria-label="素材类型"><button v-for="option in [{ value: 'all', text: '全部' }, { value: 'image', text: '图片' }, { value: 'file', text: '文件' }]" :key="option.value" :aria-pressed="kind === option.value" @click="kind = option.value as typeof kind">{{ option.text }}</button></div></div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-if="shown.length" class="asset-library-grid">
      <article v-for="asset in shown" :key="asset.id" class="asset-library-card">
        <button v-if="asset.image" type="button" class="asset-library-thumb" :aria-label="`预览图片 ${asset.name}`" @click="selected = asset"><AssetImage :asset="asset" :email="email" /></button>
        <div v-else class="asset-library-thumb asset-file-thumb"><AppIcon name="file" :size="32" /></div>
        <div class="asset-library-info"><strong :title="asset.name">{{ asset.name }}</strong><small>{{ asset.contentType }} · {{ (asset.size / 1024).toFixed(1) }} KiB · {{ asset.usageCount }} 个事项引用</small><button class="text-button asset-library-download" :disabled="!!downloading" :aria-label="`下载素材 ${asset.name}`" @click="download(asset)">下载</button></div>
        <div v-if="deleting === asset.id" class="asset-delete-confirm"><span>确定删除？</span><button class="text-button danger-text" :disabled="busy" @click="remove(asset)">确认</button><button class="text-button" @click="deleting = ''">取消</button></div>
        <button v-else type="button" class="icon-button asset-library-delete" :aria-label="`删除素材 ${asset.name}`" :disabled="busy || asset.usageCount > 0" :title="asset.usageCount ? '请先从事项中移除关联' : '删除素材'" @click="deleting = asset.id"><AppIcon name="trash" :size="16" /></button>
      </article>
    </div>
    <p v-else class="small-empty">{{ loading ? '正在加载素材…' : query || kind !== 'all' ? '没有找到匹配的素材' : '暂无素材，上传后即可在事项中引用。' }}</p>
  </section>
  <AppDialog v-if="selected" :title="selected.name" wide @close="selected = null"><div class="asset-expanded-image"><AssetImage :asset="selected" :email="email" /></div></AppDialog>
</template>
