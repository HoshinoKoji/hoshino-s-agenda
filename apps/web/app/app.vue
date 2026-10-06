<script setup lang="ts">
import { zh_cn } from '@nuxt/ui/locale'
import type { Entry, EntryInput, EntrySaveResult, Project } from '../../../shared/types'
import { dateKey, formatDate, parseDate, startOfWeek } from '~/utils/dates'
import { matchesOverviewDateFilter, type OverviewDateFilter } from '~/utils/overviewDates'
import { matchesOverviewTitleSearch } from '~/utils/overviewSearch'

const email = ref('')
const hydrated = ref(false)
const printEntryId = ref('')
const editMode = ref(false)
const editEntryId = ref('')
const createInWindow = ref(false)
const copyingInWindow = ref(false)
const editDefaultDate = ref<string | null>(null)
const editDefaultProject = ref('')
let editSessionToken = ''
let editSessionEntryId = ''
const today = ref(dateKey(new Date()))
const selected = ref(today.value)
const view = ref<'month' | 'week' | 'day'>('month')
const workspaceView = ref<'calendar' | 'overview' | 'assets'>('calendar')
const showCompletedProjects = ref(false)
const overviewDateFilter = ref<OverviewDateFilter>({ type: 'all' })
const overviewTitleSearch = ref('')
const month = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12))
const activeProject = ref('')
const showAccount = ref(false)
const showProjectOrder = ref(false)
const projectEditor = ref<{ project?: Project } | null>(null)
const projectUnlock = ref<Project | null>(null)
const unlockProject = computed(() => data.value.projects.find(project => project.id === projectUnlock.value?.id))
const entryEditor = ref<{ entry?: Entry; copySource?: Entry; date: string | null; projectId: string } | null>(null)
const { data, loading, saving, reordering, error, syncedAt, refresh, saveProject, changeProjectEncryption, cancelProjectConversion, saveEntry, deleteProject, deleteEntry, deleteAsset, renameAsset, uploadAsset, toggleEntry, moveEntry, reorderProjects } = useAgenda(email)
const agendaEntries = computed(() => data.value.entries)
const encryption = provideEntryEncryption(email, agendaEntries, computed(() => data.value.projects))
const printUnlock = usePrintUnlockTransfer(email, agendaEntries, encryption)
const editUnlock = useEntryUnlockTransfer(email, agendaEntries, encryption, 'edit')
const editorWindow = useEntryEditorWindow(email)
const { opening: editorOpening, error: editorWindowError } = editorWindow
let dialogTabPending = false
watch(email, () => { entryEditor.value = null; projectEditor.value = null; projectUnlock.value = null }, { flush: 'sync' })
watch(entryEditor, editor => {
  if (!editor && dialogTabPending) { editorWindow.cancel(); dialogTabPending = false }
})
let clock: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  const query = new URLSearchParams(window.location.search)
  printEntryId.value = query.get('printEntry') || ''
  editMode.value = !printEntryId.value && (query.has('editEntry') || query.has('copyEntry') || query.get('newEntry') === '1')
  editEntryId.value = query.get('editEntry') || query.get('copyEntry') || ''
  copyingInWindow.value = !query.has('editEntry') && query.has('copyEntry')
  createInWindow.value = query.get('newEntry') === '1' && !query.has('editEntry')
  editDefaultProject.value = query.get('project') || ''
  const date = query.get('date') || ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && dateKey(parseDate(date)) === date && Number(date.slice(0, 4)) > 0) editDefaultDate.value = date
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const printUnlockToken = fragment.get('printUnlock')
  const editUnlockToken = fragment.get('editUnlock')
  editSessionToken = fragment.get('editSession') || ''
  editSessionEntryId = editEntryId.value
  if (['printUnlock', 'editUnlock', 'editSession'].some(key => fragment.has(key))) {
    for (const key of ['printUnlock', 'editUnlock', 'editSession']) fragment.delete(key)
    const remaining = fragment.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ''}`)
  }
  let rememberedEmail = ''
  try { rememberedEmail = localStorage.getItem('agenda:email') || '' } catch { /* Storage is optional. */ }
  // An already-open workspace can differ from the most recently remembered account.
  email.value = editMode.value && editSessionToken
    ? await editorWindow.receiveContext(editSessionToken, editSessionEntryId) || ''
    : rememberedEmail
  if (printUnlockToken) printUnlock.receiveExport(printEntryId.value, printUnlockToken)
  if (editMode.value && editUnlockToken) editUnlock.receiveExport(editEntryId.value, editUnlockToken)
  if (window.matchMedia('(max-width: 600px)').matches) view.value = 'week'
  hydrated.value = true
  clock = setInterval(() => { today.value = dateKey(new Date()) }, 60_000)
})
onUnmounted(() => clearInterval(clock))

function enterAccount(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized === email.value) void refresh()
  email.value = normalized
  activeProject.value = ''
  showCompletedProjects.value = false
  overviewDateFilter.value = { type: 'all' }
  overviewTitleSearch.value = ''
  showAccount.value = false
  showProjectOrder.value = false
  try { localStorage.setItem('agenda:email', normalized) } catch { /* Continue without remembering the email. */ }
}

const projectMap = computed(() => new Map(data.value.projects.map(project => [project.id, project])))
const filteredEntries = computed(() => data.value.entries.filter(entry => !activeProject.value || entry.projectId === activeProject.value))
const monthPrefix = computed(() => dateKey(month.value).slice(0, 7))
const monthEntries = computed(() => filteredEntries.value.filter(entry => entry.date?.startsWith(monthPrefix.value)))
const completedCount = computed(() => monthEntries.value.filter(entry => entry.completed).length)
const weekStart = computed(() => startOfWeek(selected.value))
const weekEnd = computed(() => { const date = new Date(weekStart.value); date.setDate(date.getDate() + 6); return date })
const weekEntries = computed(() => filteredEntries.value.filter(entry => entry.date !== null && entry.date >= dateKey(weekStart.value) && entry.date <= dateKey(weekEnd.value)))
const weekCompleted = computed(() => weekEntries.value.filter(entry => entry.completed).length)
const periodEntries = computed(() => view.value === 'week' ? weekEntries.value : monthEntries.value)
const periodCompleted = computed(() => view.value === 'week' ? weekCompleted.value : completedCount.value)
const selectedEntries = computed(() => filteredEntries.value.filter(entry => entry.date === selected.value))
const selectedCompleted = computed(() => selectedEntries.value.filter(entry => entry.completed).length)
const monthLabel = computed(() => {
  if (view.value !== 'week') return `${month.value.getFullYear()}.${month.value.getMonth() + 1}`
  const label = (date: Date) => `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`
  return `${label(weekStart.value)}–${label(weekEnd.value)}`
})
const syncedTime = computed(() => syncedAt.value?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
const currentProject = computed(() => projectMap.value.get(activeProject.value))
const projectCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of data.value.entries) counts.set(entry.projectId, (counts.get(entry.projectId) || 0) + 1)
  return counts
})

watch(() => data.value.projects, projects => {
  if (activeProject.value && !projects.some(project => project.id === activeProject.value)) activeProject.value = ''
})

function selectDate(value: string) {
  selected.value = value
  const date = parseDate(value)
  if (date.getFullYear() !== month.value.getFullYear() || date.getMonth() !== month.value.getMonth()) {
    month.value = new Date(date.getFullYear(), date.getMonth(), 1, 12)
  }
}
function changeMonth(delta: number) {
  const date = new Date(month.value.getFullYear(), month.value.getMonth() + delta, 1, 12)
  if (date.getFullYear() < 100 || date.getFullYear() > 9999) return
  month.value = date
  selected.value = dateKey(date)
}
function changeDay(delta: number) {
  const date = parseDate(selected.value)
  date.setDate(date.getDate() + delta)
  if (date.getFullYear() < 100 || date.getFullYear() > 9999) return
  selectDate(dateKey(date))
}
function addEntry(date: string | null = selected.value, projectId = activeProject.value) {
  if (date) selectDate(date)
  if (!data.value.projects.length) { projectEditor.value = {}; return }
  entryEditor.value = { date, projectId }
}
function editEntry(entry: Entry) {
  if (workspaceView.value === 'calendar' && entry.date) selectDate(entry.date)
  entryEditor.value = { entry, date: entry.date, projectId: entry.projectId }
}
function copyEntry(entry: Entry) {
  const source = data.value.entries.find(item => item.id === entry.id)
  if (!source || loading.value || saving.value) return
  entryEditor.value = { copySource: source, date: source.date, projectId: source.projectId }
}
function exportEntry(entry: Entry) {
  const token = printUnlock.prepareExport(entry)
  window.open(`/?printEntry=${encodeURIComponent(entry.id)}${token ? `#printUnlock=${token}` : ''}`, '_blank', 'noopener')
}
function openEntryWindow(editing: Entry | undefined) {
  const source = entryEditor.value
  if (!source) return
  dialogTabPending = true
  const latest = data.value.entries.find(entry => entry.id === (editing?.id ?? source.copySource?.id))
  const token = latest ? editUnlock.prepareExport(latest) : ''
  editorWindow.open(editing?.id || source.copySource?.id || '', source.date, source.projectId, token, () => {
    if (entryEditor.value === source) entryEditor.value = null
  }, true, !!source.copySource)
}
function openEntryTab(entry: Entry) {
  if (editorOpening.value || loading.value || saving.value) return
  const latest = data.value.entries.find(item => item.id === entry.id)
  if (!latest) return
  dialogTabPending = false
  const token = editUnlock.prepareExport(latest)
  editorWindow.open(latest.id, latest.date, latest.projectId, token, () => {}, false)
}
function editWindowReady() {
  if (!editSessionToken) return
  editorWindow.announceReady(editSessionToken, editSessionEntryId)
  editSessionToken = ''
}
function updateEditEntryId(id: string) {
  editEntryId.value = id
  createInWindow.value = false
  copyingInWindow.value = false
  const url = new URL(window.location.href)
  for (const key of ['newEntry', 'project', 'date', 'copyEntry']) url.searchParams.delete(key)
  url.searchParams.set('editEntry', id)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}
function updateCopyEntry(entry: Entry) {
  editEntryId.value = entry.id
  copyingInWindow.value = true
  createInWindow.value = false
  const url = new URL(window.location.href)
  for (const key of ['editEntry', 'newEntry', 'project', 'date']) url.searchParams.delete(key)
  url.searchParams.set('copyEntry', entry.id)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}
async function submitEntry(input: EntryInput, id?: string, onSaved?: (result: EntrySaveResult) => void) {
  const saved = await saveEntry(input, id, onSaved)
  if (saved && input.date === null) {
    if (overviewDateFilter.value.type === 'range') overviewDateFilter.value = { type: 'all' }
    if (!matchesOverviewTitleSearch(input.title, overviewTitleSearch.value)) overviewTitleSearch.value = ''
    workspaceView.value = 'overview'
  }
}
function followReference(entry: Entry | undefined) {
  if (!entry) return
  if (activeProject.value && activeProject.value !== entry.projectId) activeProject.value = ''
  if (entry.date === null || workspaceView.value === 'assets') workspaceView.value = 'overview'
  else if (workspaceView.value === 'calendar') selectDate(entry.date)
  if (workspaceView.value === 'overview') {
    if (!matchesOverviewDateFilter(entry.date, overviewDateFilter.value)) overviewDateFilter.value = { type: 'all' }
    if (!matchesOverviewTitleSearch(entry.title, overviewTitleSearch.value)) overviewTitleSearch.value = ''
    if (entry.completed) showCompletedProjects.value = true
  }
  nextTick(() => {
    const target = document.getElementById(`entry-${entry.id}`)
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}
</script>

<template>
  <UApp :locale="zh_cn">
  <div v-if="!hydrated" class="boot-screen"><span class="brand-mark"><AppIcon name="spark" :size="26" /></span><p>正在打开日历…</p></div>

  <EntryPrintPage v-else-if="printEntryId" :entry-id="printEntryId" :email="email" :projects="data.projects" :entries="data.entries" :assets="data.assets" :loading="loading" :error="error" :synced="!!syncedAt" @retry="refresh" @enter="enterAccount" />

  <EntryEditPage v-else-if="editMode" :entry-id="editEntryId" :creating="createInWindow" :copying="copyingInWindow" :date="editDefaultDate" :project-id="editDefaultProject" :email="email" :projects="data.projects" :entries="data.entries" :assets="data.assets" :loading="loading" :error="error" :synced="!!syncedAt" :upload="uploadAsset" :submit="saveEntry" :remove="deleteEntry" @retry="refresh" @enter="enterAccount" @ready="editWindowReady" @change-id="updateEditEntryId" @export="exportEntry" @copy="updateCopyEntry" />

  <main v-else-if="!email" class="welcome">
    <section class="welcome-content"><a class="brand welcome-brand" href="/"><span class="brand-mark"><AppIcon name="spark" :size="25" /></span><span>日迹<span class="brand-en">HOSHINO’S AGENDA</span></span></a><div class="welcome-copy"><h1>项目日历</h1><p>输入邮箱，打开对应的项目和事项。</p></div><EmailForm @submit="enterAccount" /></section>
  </main>

  <div v-else class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/" aria-label="日迹首页"><span class="brand-mark"><AppIcon name="spark" :size="24" /></span><span>日迹<span class="brand-en">HOSHINO’S AGENDA</span></span></a>
      <nav class="project-nav" aria-label="项目筛选"><button class="nav-item all-projects" :class="{ active: !activeProject }" :aria-pressed="!activeProject" @click="activeProject = ''"><AppIcon name="calendar" :size="19" /><span>全部项目</span><span class="count">{{ data.entries.length }}</span></button><div class="nav-heading"><span>我的项目</span><div class="project-heading-actions"><button class="icon-button" aria-label="编辑项目排序" title="编辑项目排序" :disabled="loading || saving || data.projects.length < 2" @click="showProjectOrder = true"><AppIcon name="sort" :size="17" /></button><button class="icon-button" aria-label="新建项目" :disabled="loading || saving" @click="projectEditor = {}"><AppIcon name="plus" :size="17" /></button></div></div><ProjectList :projects="data.projects" :active-project="activeProject" :counts="projectCounts" :busy="loading || saving" @select="activeProject = $event" @overview="activeProject = $event; workspaceView = 'overview'" @edit="projectEditor = { project: $event }" @unlock="projectUnlock = $event" @reorder="reorderProjects" /></nav>
      <div v-if="reordering" class="project-order-status" role="status" aria-live="polite"><AppIcon name="refresh" :size="16" class="spinning" /><span><strong>正在调整项目顺序…</strong><small>正在保存并同步，请稍候</small></span></div>
      <div class="sidebar-bottom"><button class="account-button" :disabled="saving" @click="showAccount = true"><span class="avatar">{{ email[0]?.toUpperCase() }}</span><span class="account-label"><strong>我的空间</strong><small>{{ email }}</small></span><AppIcon name="chevronDown" :size="15" /></button></div>
    </aside>

    <div class="main-shell">
      <header class="topbar"><nav class="breadcrumb" aria-label="工作台导航"><AppIcon name="grid" :size="16" /><span class="breadcrumb-home">我的工作台</span><span class="breadcrumb-slash">/</span><WorkspaceViewSelect v-model="workspaceView" /></nav><button class="sync-button" :disabled="loading || saving" :title="syncedAt ? `上次同步：${syncedAt.toLocaleDateString('zh-CN')} ${syncedTime}` : '从云端读取数据'" @click="refresh"><span class="status-dot" :class="{ 'status-error': error, 'status-busy': loading || saving }" /><span>{{ saving ? '正在保存' : loading ? '正在同步' : error ? '同步失败 · 重试' : syncedAt ? `已与云端同步 · ${syncedTime}` : '同步数据' }}</span><AppIcon name="refresh" :size="14" :class="{ spinning: loading }" /></button></header>
      <main class="workspace" :class="{ 'day-view': workspaceView === 'calendar' && view === 'day' }">
        <div v-if="error" class="error-banner" role="alert"><span>{{ error }}</span><button class="text-button" :disabled="loading || saving" @click="refresh">重试</button></div>
        <div v-if="editorWindowError && !entryEditor" class="error-banner" role="alert"><span>{{ editorWindowError }}</span><button class="icon-button" aria-label="关闭编辑标签页提示" @click="editorWindow.cancel()"><AppIcon name="close" :size="16" /></button></div>

        <AssetLibrary v-if="workspaceView === 'assets'" :assets="data.assets" :entries="data.entries" :projects="data.projects" :email="email" :loading="loading" :busy="loading || saving" :upload="uploadAsset" :remove="deleteAsset" :rename="renameAsset" @follow="followReference" />
        <ProjectOverview v-else-if="workspaceView === 'overview'" v-model:show-completed="showCompletedProjects" v-model:date-filter="overviewDateFilter" v-model:title-search="overviewTitleSearch" :projects="data.projects" :entries="data.entries" :assets="data.assets" :email="email" :active-project="activeProject" :busy="loading || saving" :loading="loading" :tab-opening="editorOpening" @add="addEntry(null, $event)" @create-project="projectEditor = {}" @edit-project="projectEditor = { project: $event }" @unlock-project="projectUnlock = $event" @edit="editEntry" @window="openEntryTab" @export="exportEntry" @copy="copyEntry" @toggle="toggleEntry" @follow="followReference" />
        <template v-else>
        <section class="calendar-card" :aria-busy="loading">
          <header class="calendar-toolbar">
            <div class="month-heading"><h2>{{ monthLabel }}</h2><div class="summary-counts" :aria-label="view === 'week' ? '本周概览' : '本月概览'"><span>总数 <strong>{{ periodEntries.length }}</strong></span><span class="summary-divider" aria-hidden="true">/</span><span>未完成 <strong>{{ periodEntries.length - periodCompleted }}</strong></span></div></div>
            <div class="calendar-controls">
              <span v-if="currentProject" class="filter-chip"><i class="project-dot" :style="{ background: currentProject.color }" /><span class="truncate">{{ currentProject.name }}</span><button class="icon-button" aria-label="清除项目筛选" @click="activeProject = ''"><AppIcon name="close" :size="13" /></button></span>
              <DatePicker v-if="view !== 'month'" class="day-date-input" :label="view === 'week' ? '周视图日期' : '日视图日期'" min="0100-01-01" :model-value="selected" @update:model-value="selectDate" />
              <button class="button today-button" @click="selectDate(today)">今天</button>
              <div class="month-navigation">
                <button class="icon-button" :aria-label="view === 'day' ? '前一天' : view === 'week' ? '前一周' : '上个月'" @click="view === 'day' ? changeDay(-1) : view === 'week' ? changeDay(-7) : changeMonth(-1)"><AppIcon name="chevronLeft" :size="18" /></button>
                <button class="icon-button" :aria-label="view === 'day' ? '后一天' : view === 'week' ? '后一周' : '下个月'" @click="view === 'day' ? changeDay(1) : view === 'week' ? changeDay(7) : changeMonth(1)"><AppIcon name="chevronRight" :size="18" /></button>
              </div>
              <div class="view-switch" role="group" aria-label="日历视图">
                <button :aria-pressed="view === 'month'" @click="view = 'month'">月</button>
                <button :aria-pressed="view === 'week'" @click="view = 'week'">周</button>
                <button :aria-pressed="view === 'day'" @click="view = 'day'">日</button>
              </div>
              <button class="button primary add-main" :disabled="loading || saving" @click="addEntry()"><AppIcon name="plus" :size="18" />事项</button>
            </div>
          </header>
          <CalendarGrid v-if="view === 'month'" :month="month" :selected="selected" :today="today" :entries="filteredEntries" :all-entries="data.entries" :projects="data.projects" :busy="loading || saving" @select="selectDate" @edit="editEntry" @add="addEntry" @move="moveEntry" />
          <CalendarWeek v-else-if="view === 'week'" :start="weekStart" :selected="selected" :today="today" :entries="filteredEntries" :all-entries="data.entries" :projects="data.projects" :busy="loading || saving" @select="selectDate" @edit="editEntry" @add="addEntry" @move="moveEntry" />
          <footer v-if="view === 'month'" class="calendar-footer"><span><i class="legend-dot" />点击日期查看详情，点击事项进行编辑</span><span>{{ currentProject ? currentProject.name : '全部项目' }}<span class="footer-divider">·</span>周一为一周的开始</span></footer>
        </section>

        <section class="day-panel" aria-labelledby="day-title"><header class="day-panel-heading"><div class="day-title-group"><span class="day-icon"><AppIcon name="calendar" :size="20" /></span><div><h2 id="day-title">{{ formatDate(selected) }}<span v-if="selected === today" class="today-badge">今天</span></h2><p>{{ selectedEntries.length }} 个事项，已完成 {{ selectedCompleted }} 个</p></div></div><button class="button secondary" :disabled="loading || saving" @click="addEntry()"><AppIcon name="plus" :size="16" />事项</button></header>
          <div v-if="loading && !syncedAt" class="day-empty"><AppIcon name="refresh" class="spinning" :size="25" /><p>正在从云端取回你的记录…</p></div>
          <div v-else-if="!selectedEntries.length" class="day-empty"><h3>{{ data.projects.length ? '当天暂无事项' : '(空)' }}</h3><p v-if="!data.projects.length">创建项目后即可添加事项。</p><button class="text-button" :disabled="loading || saving" @click="data.projects.length ? addEntry() : projectEditor = {}">{{ data.projects.length ? '添加事项' : '创建项目' }}<AppIcon name="arrow" :size="15" /></button></div>
          <EntryList v-else :entries="selectedEntries" :all-entries="data.entries" :projects="data.projects" :assets="data.assets" :email="email" :busy="loading || saving" :tab-opening="editorOpening" @edit="editEntry" @window="openEntryTab" @export="exportEntry" @copy="copyEntry" @toggle="toggleEntry" @follow="followReference" />
        </section>
        </template>
      </main>
    </div>

    <AppDialog v-if="showAccount" title="回到你的数据空间" @close="showAccount = false"><p class="account-description">输入邮箱，提取对应的项目和日历记录。</p><EmailForm :initial="email" @submit="enterAccount" /></AppDialog>
    <ProjectOrderEditor v-if="showProjectOrder" :projects="data.projects" :submit="reorderProjects" :error="error" @close="showProjectOrder = false" />
    <AppDialog v-if="projectUnlock && unlockProject" title="解锁项目描述" @close="projectUnlock = null"><ProjectUnlock :project="unlockProject" @unlocked="projectUnlock = null" /></AppDialog>
    <ProjectEditor v-if="projectEditor" :project="projectEditor.project" :entry-count="projectEditor.project ? projectCounts.get(projectEditor.project.id) || 0 : 0" :projects="data.projects" :entries="data.entries" :submit="saveProject" :change-encryption="changeProjectEncryption" :cancel-conversion="cancelProjectConversion" :remove="deleteProject" @close="projectEditor = null" />
    <EntryEditor v-if="entryEditor" :key="entryEditor.entry?.id || (entryEditor.copySource ? `copy-${entryEditor.copySource.id}` : 'new')" :entry="entryEditor.entry" :copy-source="entryEditor.copySource" :date="entryEditor.date" :project-id="entryEditor.projectId" :projects="data.projects" :entries="data.entries" :assets="data.assets" :email="email" :upload="uploadAsset" :submit="submitEntry" :remove="deleteEntry" :opening="editorOpening" :window-error="editorWindowError" @window="openEntryWindow" @export="exportEntry" @copy="copyEntry" @close="entryEditor = null" />
  </div>
  </UApp>
</template>
