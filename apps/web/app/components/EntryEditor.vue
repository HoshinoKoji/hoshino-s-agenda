<script setup lang="ts">
import type { Asset, Entry, EntryInput, EntrySaveResult, Project } from '../../../../shared/types'
import { entryRevision } from '~/utils/entryEditing'

const props = defineProps<{
  entry?: Entry
  date: string | null
  projectId: string
  projects: Project[]
  entries: Entry[]
  assets: Asset[]
  email: string
  upload: (file: File) => Promise<Asset>
  submit: (data: EntryInput, id?: string, onSaved?: (result: EntrySaveResult) => void) => Promise<void>
  remove: (id: string) => Promise<void>
  opening?: boolean
  windowError?: string
}>()
const emit = defineEmits<{ close: []; export: [entry: Entry]; window: [entry: Entry | undefined] }>()
const editing = shallowRef(props.entry)
const revision = ref(0)
const busy = ref(false)
const dirty = ref(false)
const latest = computed(() => props.entries.find(entry => entry.id === editing.value?.id))
const stale = computed(() => !!editing.value && entryRevision(latest.value) !== entryRevision(editing.value))

function openWindow() {
  if (busy.value || props.opening) return
  if (dirty.value && !window.confirm('当前有未保存的修改。新标签页将读取云端已保存内容，这些修改不会带入；成功打开后将关闭此弹窗。是否继续？')) return
  emit('window', editing.value)
}
function reload() {
  if (busy.value || !latest.value) return
  if (dirty.value && !window.confirm('重新加载会放弃当前未保存的修改，是否继续？')) return
  editing.value = latest.value
  revision.value++
}
</script>

<template>
  <AppDialog :title="editing ? '编辑事项' : '添加事项'" :busy="busy" wide @close="emit('close')">
    <template #actions><button type="button" class="icon-button" aria-label="在新标签页编辑" :title="opening ? '正在打开编辑标签页…' : '在新标签页编辑'" :disabled="busy || opening" @click="openWindow"><AppIcon :name="opening ? 'refresh' : 'external'" :class="{ spinning: opening }" /></button></template>
    <p v-if="windowError" class="form-error" role="alert">{{ windowError }}</p>
    <div v-if="stale && !busy" class="form-error" role="alert"><p>{{ latest ? '云端事项已变更，当前未保存输入已保留。请重新加载后再保存。' : '此事项已被删除，当前输入无法保存。' }}</p><button v-if="latest" type="button" class="text-button" @click="reload">重新加载事项</button></div>
    <EntryEditorForm :key="revision" :entry="editing" :date="date" :project-id="projectId" :projects="projects" :entries="entries" :assets="assets" :email="email" :upload="upload" :submit="submit" :remove="remove" :save-disabled="stale" :disabled="opening" @update:busy="busy = $event" @update:dirty="dirty = $event" @export="emit('export', $event)" @close="emit('close')" @saved="emit('close')" @removed="emit('close')" />
  </AppDialog>
</template>
