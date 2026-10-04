<script setup lang="ts">
import type { Asset, Entry, EntryInput, EntryRemoveOptions, EntrySaveResult, Project } from '../../../../shared/types'
import { entryRevision, matchesSavedInput } from '~/utils/entryEditing'

const props = defineProps<{
  entryId: string
  creating: boolean
  copying?: boolean
  date: string | null
  projectId: string
  email: string
  projects: Project[]
  entries: Entry[]
  assets: Asset[]
  loading: boolean
  error: string
  synced: boolean
  upload: (file: File) => Promise<Asset>
  submit: (input: EntryInput, id?: string, onSaved?: (result: EntrySaveResult) => void) => Promise<EntrySaveResult | undefined>
  remove: (id: string, options?: EntryRemoveOptions) => Promise<void>
}>()
const emit = defineEmits<{ retry: []; enter: [email: string]; ready: []; 'change-id': [id: string]; export: [entry: Entry]; copy: [entry: Entry] }>()
const editing = shallowRef<Entry>()
const copySource = shallowRef<Entry>()
const initialized = ref(false)
const revision = ref(0)
const busy = ref(false)
const dirty = ref(false)
const deleted = ref(false)
const status = ref('')
const displayedStatus = computed(() => dirty.value ? '有未保存的修改。' : status.value)
const pending = shallowRef<{ id: string; input: EntryInput; saved?: Entry }>()
const latest = computed(() => props.entries.find(entry => entry.id === props.entryId))
const projectId = computed(() => props.projects.some(project => project.id === props.projectId) ? props.projectId : '')
const stale = computed(() => !!editing.value && entryRevision(editing.value) !== entryRevision(latest.value))
let generation = 0
let disposed = false

function reset(entry: Entry | undefined) {
  editing.value = entry
  initialized.value = true
  revision.value++
  dirty.value = false
}
function reconcile() {
  if (!props.email || props.loading || props.error || !props.synced || busy.value || deleted.value) return
  if (!initialized.value) {
    if (latest.value || (props.creating && props.projects.length)) reset(latest.value)
    if (props.copying && latest.value) { copySource.value = latest.value; reset(undefined) }
    emit('ready')
  }
  if (pending.value && latest.value?.id === pending.value.id && (pending.value.saved
    ? entryRevision(latest.value) === entryRevision(pending.value.saved) : matchesSavedInput(latest.value, pending.value.input))) {
    copySource.value = undefined
    reset(latest.value)
    pending.value = undefined
    status.value = '已保存并与云端同步，可继续编辑。'
  }
}
watch([() => props.entries, () => props.loading, () => props.error, () => props.synced, busy], reconcile, { immediate: true })
watch(() => props.email, () => {
  generation++
  initialized.value = false
  editing.value = undefined
  copySource.value = undefined
  pending.value = undefined
  deleted.value = false
  dirty.value = false
  status.value = ''
  revision.value++
}, { flush: 'sync' })

async function save(input: EntryInput, id?: string, onSaved?: (result: EntrySaveResult) => void) {
  const current = generation
  const result = await props.submit(input, id, saved => {
    if (disposed || generation !== current) return
    onSaved?.(saved)
    // Capture the ID at write acknowledgement, even if the following GET fails.
    pending.value = { id: saved.id, input, saved: saved.savedEntry }
    dirty.value = false
    status.value = '已保存到云端，正在确认同步…'
    emit('change-id', saved.id)
  })
  if (!result && !disposed && generation === current) throw new Error('空间已变化，请重新打开事项')
}
function reload() {
  if (busy.value || props.loading || !latest.value) return
  if (dirty.value && !window.confirm('重新加载会放弃当前未保存的修改，是否继续？')) return
  reset(latest.value)
  pending.value = undefined
  status.value = '已加载云端最新内容。'
}
function removed() {
  deleted.value = true
  dirty.value = false
  status.value = ''
}
function copy(entry: Entry) {
  if (busy.value) return
  if (dirty.value && !window.confirm('复制将使用云端已保存内容，当前未保存修改不会带入。是否继续？')) return
  copySource.value = props.entries.find(item => item.id === entry.id) ?? entry
  reset(undefined)
  pending.value = undefined
  status.value = ''
  emit('copy', copySource.value)
}
function leave() {
  if (busy.value) return
  if (dirty.value && !window.confirm('当前有未保存的修改，返回工作台会放弃这些修改。是否继续？')) return
  dirty.value = false
  window.location.assign('/')
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value && !busy.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => { disposed = true; generation++; window.removeEventListener('beforeunload', beforeUnload) })
useHead({ title: computed(() => editing.value ? `${editing.value.title} · 编辑事项 · 日迹` : '事项独立编辑 · 日迹') })
</script>

<template>
  <main class="entry-edit-page">
    <header class="entry-edit-toolbar"><a href="/" class="button secondary" :aria-disabled="busy" @click.prevent="leave">返回工作台</a><button v-if="email" class="button secondary" :disabled="busy || loading" @click="emit('retry')"><AppIcon name="refresh" :size="16" :class="{ spinning: loading }" />{{ loading ? '正在同步' : '同步' }}</button></header>
    <section v-if="!email" class="entry-edit-message"><h1>输入邮箱后编辑事项</h1><p>编辑标签页需要读取事项所属的数据空间。</p><EmailForm @submit="emit('enter', $event)" /></section>
    <section v-else-if="deleted" class="entry-edit-message" role="status"><h1>事项已删除</h1><p>可以返回工作台继续管理其他事项。</p></section>
    <section v-else-if="!initialized && error" class="entry-edit-message" role="alert"><h1>事项加载失败</h1><p>{{ error }}</p><button class="button secondary" :disabled="loading" @click="emit('retry')">重试</button></section>
    <section v-else-if="!initialized && (loading || !synced)" class="entry-edit-message" role="status">正在加载云端事项…</section>
    <section v-else-if="!initialized" class="entry-edit-message" role="status"><h1>{{ creating && !projects.length ? '请先创建项目' : '找不到这个事项' }}</h1><p>{{ creating && !projects.length ? '返回工作台创建项目后即可添加事项。' : '事项可能已删除，或不属于当前邮箱。' }}</p></section>
    <section v-else class="entry-edit-sheet" aria-labelledby="entry-edit-title">
      <header class="entry-edit-heading"><h1 id="entry-edit-title">{{ editing ? '编辑事项' : copySource ? '复制事项' : '添加事项' }}</h1><p>独立编辑 · {{ email }}</p></header>
      <p v-if="displayedStatus" class="entry-edit-status" :class="{ 'entry-edit-unsaved': dirty }" role="status" aria-live="polite">{{ displayedStatus }}</p>
      <div v-if="error" class="form-error" role="alert"><p>{{ pending ? '事项已写入云端，但同步确认失败。当前内容已保留，请重试同步后继续编辑。' : '同步失败，当前输入已保留。' }} {{ error }}</p><button class="text-button" :disabled="busy || loading" @click="emit('retry')">重试同步</button></div>
      <div v-else-if="!busy && !loading && (stale || pending)" class="form-error" role="alert"><p>{{ latest ? '云端事项已变更，当前输入已保留。请重新加载最新内容后继续编辑。' : '此事项已被删除，当前输入无法保存。' }}</p><button v-if="latest" class="text-button" @click="reload">重新加载事项</button></div>
      <EntryEditorForm :key="revision" :entry="editing" :copy-source="copySource" :date="date" :project-id="projectId" :projects="projects" :entries="entries" :assets="assets" :email="email" :upload="upload" :submit="save" :remove="remove" :disabled="!!pending" :save-disabled="stale || loading || !!pending" cancel-label="返回" @update:dirty="dirty = $event" @update:busy="busy = $event" @close="leave" @saved="reconcile" @removed="removed" @export="emit('export', $event)" @copy="copy" />
    </section>
  </main>
</template>
