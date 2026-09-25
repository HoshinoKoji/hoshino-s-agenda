<script setup lang="ts">
import type { Asset, Entry, Project } from '../../../../shared/types'
const props = defineProps<{
  assets: Asset[]; entries: Entry[]; projects: Project[]; email: string; loading: boolean; busy: boolean
  upload: (file: File) => Promise<Asset>; remove: (id: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
}>()
const emit = defineEmits<{ follow: [entry: Entry] }>()
const query = ref('')
const kind = ref<'all' | 'image' | 'file'>('all')
const layout = ref<'grid' | 'list'>('grid')
const error = ref('')
const pending = ref(false)
const downloading = ref('')
const deleting = ref('')
const renaming = ref('')
const renameName = ref('')
const selectedId = ref('')
const openReferences = ref('')
let followingReference = false
const selected = computed(() => props.assets.find(asset => asset.id === selectedId.value))
const projectNames = computed(() => new Map(props.projects.map(project => [project.id, project.name])))
const references = computed(() => {
  const map = new Map<string, Entry[]>()
  for (const entry of props.entries) {
    for (const id of entry.assetIds) map.set(id, [...(map.get(id) || []), entry])
  }
  return map
})
const shown = computed(() => props.assets.filter(asset =>
  (kind.value === 'all' || asset.image === (kind.value === 'image')) &&
  asset.name.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
function followReference(entry: Entry) {
  followingReference = true
  openReferences.value = ''
  emit('follow', entry)
}
function referenceCloseAutoFocus(event: Event) {
  if (followingReference) event.preventDefault()
  followingReference = false
}
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
function startRename(asset: Asset) {
  deleting.value = ''
  renaming.value = asset.id
  renameName.value = asset.name
  error.value = ''
}
async function saveName(asset: Asset) {
  if (pending.value || props.busy) return
  pending.value = true
  error.value = ''
  try { await props.rename(asset.id, renameName.value); renaming.value = '' }
  catch (cause) { error.value = (cause as Error).message }
  finally { pending.value = false }
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
    <div class="asset-library-filters"><input v-model="query" type="search" aria-label="搜索素材" placeholder="搜索文件名"><div class="view-switch" role="group" aria-label="素材类型"><button v-for="option in [{ value: 'all', text: '全部' }, { value: 'image', text: '图片' }, { value: 'file', text: '文件' }]" :key="option.value" :aria-pressed="kind === option.value" @click="kind = option.value as typeof kind">{{ option.text }}</button></div><div class="view-switch asset-layout-switch" role="group" aria-label="素材布局"><button type="button" :aria-pressed="layout === 'grid'" aria-label="网格视图" title="网格视图" @click="layout = 'grid'"><AppIcon name="grid" :size="16" /></button><button type="button" :aria-pressed="layout === 'list'" aria-label="列表视图" title="列表视图" @click="layout = 'list'"><AppIcon name="list" :size="16" /></button></div></div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-if="shown.length" class="asset-library-grid" :class="{ 'asset-library-list': layout === 'list' }">
      <article v-for="asset in shown" :key="asset.id" class="asset-library-card">
        <button v-if="asset.image" type="button" class="asset-library-thumb" :aria-label="`预览图片 ${asset.name}`" @click="selectedId = asset.id"><AssetImage :asset="asset" :email="email" /></button>
        <div v-else class="asset-library-thumb asset-file-thumb"><AppIcon name="file" :size="32" /></div>
        <div class="asset-library-info">
          <form v-if="renaming === asset.id" class="asset-rename-form" @submit.prevent="saveName(asset)"><input v-model="renameName" :aria-label="`新素材名称 ${asset.name}`" maxlength="255" required><button type="submit" class="text-button" :disabled="busy || pending">保存</button><button type="button" class="text-button" :disabled="pending" @click="renaming = ''">取消</button></form>
          <strong v-else :title="asset.name">{{ asset.name }}</strong>
          <div class="asset-library-meta"><small>{{ (asset.size / 1024).toFixed(1) }} KiB</small><span aria-hidden="true">·</span><UPopover :open="openReferences === asset.id" :disabled="!asset.usageCount" :portal="true" :content="{ align: 'start', sideOffset: 6, collisionPadding: 12, onCloseAutoFocus: referenceCloseAutoFocus }" :ui="{ content: 'asset-reference-popover rounded-lg bg-white ring-[#eeedf3] shadow-[0_8px_28px_#30273f14]' }" @update:open="openReferences = $event ? asset.id : ''"><button type="button" class="asset-reference-trigger" :disabled="!asset.usageCount" :aria-label="`${asset.name} · ${asset.usageCount} 个事项引用`">{{ asset.usageCount }} 个事项引用</button><template #content><div class="asset-reference-heading">{{ asset.name }} · 引用事项</div><div class="asset-library-ref-list"><button v-for="entry in references.get(asset.id) || []" :key="entry.id" type="button" class="asset-library-ref" :aria-label="`转到事项 ${entry.title}`" @click="followReference(entry)"><span>{{ entry.title }}</span><small>{{ projectNames.get(entry.projectId) }} · {{ entry.date ?? '未设日期' }}</small></button></div></template></UPopover></div>
          <div v-if="deleting === asset.id" class="asset-delete-confirm"><span>确定删除？</span><button type="button" class="text-button danger-text" :disabled="busy || pending" @click="remove(asset)">确认</button><button type="button" class="text-button" @click="deleting = ''">取消</button></div>
          <div class="asset-library-actions"><button type="button" class="text-button asset-library-download" :disabled="!!downloading" :aria-label="`下载素材 ${asset.name}`" @click="download(asset)">下载</button><button v-if="renaming !== asset.id" type="button" class="icon-button" :aria-label="`重命名素材 ${asset.name}`" :disabled="busy || pending" @click="startRename(asset)"><AppIcon name="edit" :size="16" /></button><button v-if="deleting !== asset.id" type="button" class="icon-button asset-library-delete" :aria-label="`删除素材 ${asset.name}`" :disabled="busy || pending || asset.usageCount > 0" :title="asset.usageCount ? '请先从事项中移除关联' : '删除素材'" @click="deleting = asset.id"><AppIcon name="trash" :size="16" /></button></div>
        </div>
      </article>
    </div>
    <p v-else class="small-empty">{{ loading ? '正在加载素材…' : query || kind !== 'all' ? '没有找到匹配的素材' : '暂无素材，上传后即可在事项中引用。' }}</p>
  </section>
  <AppDialog v-if="selected" :title="selected.name" wide @close="selectedId = ''"><div class="asset-expanded-image"><AssetImage :asset="selected" :email="email" original /></div></AppDialog>
</template>
