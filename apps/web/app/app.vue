<script setup lang="ts">
import { zh_cn } from '@nuxt/ui/locale'
import type { Entry, Project } from '../../../shared/types'
import { legacyReferenceIds } from '../../../shared/mentions'
import { dateKey, formatDate, parseDate } from '~/utils/dates'

const email = ref('')
const hydrated = ref(false)
const today = ref(dateKey(new Date()))
const selected = ref(today.value)
const view = ref<'month' | 'day'>('month')
const month = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12))
const activeProject = ref('')
const showAccount = ref(false)
const projectEditor = ref<{ project?: Project } | null>(null)
const entryEditor = ref<{ entry?: Entry; date: string } | null>(null)
const { data, loading, saving, error, syncedAt, refresh, saveProject, saveEntry, deleteProject, deleteEntry, toggleEntry } = useAgenda(email)
let clock: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  try { email.value = localStorage.getItem('agenda:email') || '' } catch { /* Storage is optional. */ }
  hydrated.value = true
  clock = setInterval(() => { today.value = dateKey(new Date()) }, 60_000)
})
onUnmounted(() => clearInterval(clock))

function enterAccount(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized === email.value) void refresh()
  email.value = normalized
  activeProject.value = ''
  showAccount.value = false
  try { localStorage.setItem('agenda:email', normalized) } catch { /* Continue without remembering the email. */ }
}

const projectMap = computed(() => new Map(data.value.projects.map(project => [project.id, project])))
const entryMap = computed(() => new Map(data.value.entries.map(entry => [entry.id, entry])))
const legacyReferences = computed(() => new Map(data.value.entries.map(entry => [entry.id, legacyReferenceIds(entry)])))
const filteredEntries = computed(() => data.value.entries.filter(entry => !activeProject.value || entry.projectId === activeProject.value))
const monthPrefix = computed(() => dateKey(month.value).slice(0, 7))
const monthEntries = computed(() => filteredEntries.value.filter(entry => entry.date.startsWith(monthPrefix.value)))
const completedCount = computed(() => monthEntries.value.filter(entry => entry.completed).length)
const selectedEntries = computed(() => filteredEntries.value.filter(entry => entry.date === selected.value))
const selectedCompleted = computed(() => selectedEntries.value.filter(entry => entry.completed).length)
const monthLabel = computed(() => month.value.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }))
const currentProject = computed(() => projectMap.value.get(activeProject.value))
const projectCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of data.value.entries) counts.set(entry.projectId, (counts.get(entry.projectId) || 0) + 1)
  return counts
})
const backlinks = computed(() => {
  const map = new Map<string, Entry[]>()
  for (const entry of data.value.entries) {
    for (const id of entry.references) map.set(id, [...(map.get(id) || []), entry])
  }
  return map
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
function addEntry(date = selected.value) {
  selectDate(date)
  if (!data.value.projects.length) { projectEditor.value = {}; return }
  entryEditor.value = { date }
}
function editEntry(entry: Entry) {
  selectDate(entry.date)
  entryEditor.value = { entry, date: entry.date }
}
function followReference(entry: Entry | undefined) {
  if (!entry) return
  if (activeProject.value && activeProject.value !== entry.projectId) activeProject.value = ''
  selectDate(entry.date)
  nextTick(() => document.getElementById(`entry-${entry.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}
</script>

<template>
  <UApp :locale="zh_cn">
  <div v-if="!hydrated" class="boot-screen"><span class="brand-mark"><AppIcon name="spark" :size="26" /></span><p>正在打开日历…</p></div>

  <main v-else-if="!email" class="welcome">
    <section class="welcome-content"><a class="brand welcome-brand" href="/"><span class="brand-mark"><AppIcon name="spark" :size="25" /></span><span>日迹<span class="brand-en">HOSHINO’S AGENDA</span></span></a><div class="welcome-copy"><h1>项目日历</h1><p>输入邮箱，打开对应的项目和事项。</p></div><EmailForm @submit="enterAccount" /></section>
  </main>

  <div v-else class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/" aria-label="日迹首页"><span class="brand-mark"><AppIcon name="spark" :size="24" /></span><span>日迹<span class="brand-en">HOSHINO’S AGENDA</span></span></a>
      <nav class="project-nav" aria-label="项目筛选"><button class="nav-item all-projects" :class="{ active: !activeProject }" :aria-pressed="!activeProject" @click="activeProject = ''"><AppIcon name="calendar" :size="19" /><span>全部项目</span><span class="count">{{ data.entries.length }}</span></button><div class="nav-heading"><span>我的项目</span><button class="icon-button" aria-label="新建项目" :disabled="loading || saving" @click="projectEditor = {}"><AppIcon name="plus" :size="17" /></button></div><div class="project-list"><div v-for="project in data.projects" :key="project.id" class="project-nav-row" :class="{ active: activeProject === project.id }"><button class="nav-item" :aria-pressed="activeProject === project.id" @click="activeProject = project.id"><i class="project-dot" :style="{ background: project.color }" /><span class="truncate">{{ project.name }}</span><span class="count">{{ projectCounts.get(project.id) || 0 }}</span></button><button class="project-edit icon-button" :aria-label="`编辑项目 ${project.name}`" :disabled="saving || loading" @click="projectEditor = { project }"><AppIcon name="edit" :size="14" /></button></div><p v-if="!data.projects.length && !loading" class="sidebar-empty">(空)</p></div></nav>
      <div class="sidebar-bottom"><button class="account-button" :disabled="saving" @click="showAccount = true"><span class="avatar">{{ email[0]?.toUpperCase() }}</span><span class="account-label"><strong>我的空间</strong><small>{{ email }}</small></span><AppIcon name="chevronDown" :size="15" /></button></div>
    </aside>

    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb"><AppIcon name="grid" :size="16" /><span>我的工作台</span><span class="breadcrumb-slash">/</span><strong>项目日历</strong></div><button class="sync-button" :disabled="loading || saving" :title="syncedAt ? `上次同步：${syncedAt.toLocaleTimeString('zh-CN')}` : '从云端读取数据'" @click="refresh"><span class="status-dot" :class="{ 'status-error': error, 'status-busy': loading || saving }" /><span>{{ saving ? '正在保存' : loading ? '正在同步' : error ? '同步失败 · 重试' : syncedAt ? '已与云端同步' : '同步数据' }}</span><AppIcon name="refresh" :size="14" :class="{ spinning: loading }" /></button></header>
      <main class="workspace" :class="{ 'day-view': view === 'day' }">
        <div v-if="error" class="error-banner" role="alert"><span>{{ error }}</span><button class="text-button" :disabled="loading || saving" @click="refresh">重试</button></div>

        <section class="calendar-card" :aria-busy="loading">
          <header class="calendar-toolbar">
            <div class="month-heading"><h2>{{ monthLabel }}</h2><div class="summary-counts" aria-label="本月概览"><span>总数 <strong>{{ monthEntries.length }}</strong></span><span class="summary-divider" aria-hidden="true">/</span><span>未完成 <strong>{{ monthEntries.length - completedCount }}</strong></span></div></div>
            <div class="calendar-controls">
              <span v-if="currentProject" class="filter-chip"><i class="project-dot" :style="{ background: currentProject.color }" /><span class="truncate">{{ currentProject.name }}</span><button class="icon-button" aria-label="清除项目筛选" @click="activeProject = ''"><AppIcon name="close" :size="13" /></button></span>
              <DatePicker v-if="view === 'day'" class="day-date-input" label="日视图日期" min="0100-01-01" :model-value="selected" @update:model-value="selectDate" />
              <button class="button today-button" @click="selectDate(today)">今天</button>
              <div class="month-navigation">
                <button class="icon-button" :aria-label="view === 'day' ? '前一天' : '上个月'" @click="view === 'day' ? changeDay(-1) : changeMonth(-1)"><AppIcon name="chevronLeft" :size="18" /></button>
                <button class="icon-button" :aria-label="view === 'day' ? '后一天' : '下个月'" @click="view === 'day' ? changeDay(1) : changeMonth(1)"><AppIcon name="chevronRight" :size="18" /></button>
              </div>
              <div class="view-switch" role="group" aria-label="日历视图">
                <button :aria-pressed="view === 'month'" @click="view = 'month'">月</button>
                <button :aria-pressed="view === 'day'" @click="view = 'day'">日</button>
              </div>
              <button class="button primary add-main" :disabled="loading || saving" @click="addEntry()"><AppIcon name="plus" :size="18" />事项</button>
            </div>
          </header>
          <CalendarGrid v-if="view === 'month'" :month="month" :selected="selected" :today="today" :entries="filteredEntries" :all-entries="data.entries" :projects="data.projects" @select="selectDate" @edit="editEntry" @add="addEntry" />
          <footer v-if="view === 'month'" class="calendar-footer"><span><i class="legend-dot" />点击日期查看详情，点击事项进行编辑</span><span>{{ currentProject ? currentProject.name : '全部项目' }}<span class="footer-divider">·</span>周一为一周的开始</span></footer>
        </section>

        <section class="day-panel" aria-labelledby="day-title"><header class="day-panel-heading"><div class="day-title-group"><span class="day-icon"><AppIcon name="calendar" :size="20" /></span><div><h2 id="day-title">{{ formatDate(selected) }}<span v-if="selected === today" class="today-badge">今天</span></h2><p>{{ selectedEntries.length }} 个事项，已完成 {{ selectedCompleted }} 个</p></div></div><button class="button secondary" :disabled="loading || saving" @click="addEntry()"><AppIcon name="plus" :size="16" />事项</button></header>
          <div v-if="loading && !syncedAt" class="day-empty"><AppIcon name="refresh" class="spinning" :size="25" /><p>正在从云端取回你的记录…</p></div>
          <div v-else-if="!selectedEntries.length" class="day-empty"><h3>{{ data.projects.length ? '当天暂无事项' : '(空)' }}</h3><p v-if="!data.projects.length">创建项目后即可添加事项。</p><button class="text-button" :disabled="loading || saving" @click="data.projects.length ? addEntry() : projectEditor = {}">{{ data.projects.length ? '添加事项' : '创建项目' }}<AppIcon name="arrow" :size="15" /></button></div>
          <div v-else class="entry-list">
            <article v-for="entry in selectedEntries" :id="`entry-${entry.id}`" :key="entry.id" class="entry-card" :class="{ 'entry-completed': entry.completed }">
              <button class="completion-toggle" :class="{ checked: entry.completed }" :aria-label="`${entry.completed ? '标为未完成' : '标为完成'}：${entry.title}`" :aria-pressed="entry.completed" :disabled="saving || loading" @click="toggleEntry(entry)"><AppIcon v-if="entry.completed" name="check" :size="14" /></button>
              <div class="entry-content">
                <button class="entry-title" @click="editEntry(entry)">{{ entry.title }}</button>
                <div class="entry-meta"><span class="project-tag" :style="{ '--project-color': projectMap.get(entry.projectId)?.color }"><i class="project-dot" />{{ projectMap.get(entry.projectId)?.name }}</span><span class="entry-state">{{ entry.completed ? '已完成' : '进行中' }}</span></div>
                <EntryDescription :entry="entry" :entries="data.entries" :projects="data.projects" @follow="followReference" />
                <div v-if="legacyReferences.get(entry.id)?.length || backlinks.get(entry.id)?.length" class="entry-links">
                  <div v-if="legacyReferences.get(entry.id)?.length" class="reference-group"><span><AppIcon name="link" :size="12" />引用</span><template v-for="id in legacyReferences.get(entry.id)" :key="id"><EntryTooltip v-if="entryMap.has(id)" :entry="entryMap.get(id)!" :entries="data.entries" :projects="data.projects"><button class="reference-chip" @click="followReference(entryMap.get(id))">@{{ entryMap.get(id)?.title }}<AppIcon name="arrow" :size="12" /></button></EntryTooltip><span v-else class="reference-chip">@事项已删除</span></template></div>
                  <div v-if="backlinks.get(entry.id)?.length" class="reference-group"><span><AppIcon name="link" :size="12" />被引用</span><EntryTooltip v-for="source in backlinks.get(entry.id)" :key="source.id" :entry="source" :entries="data.entries" :projects="data.projects"><button class="reference-chip backlink" @click="followReference(source)">@{{ source.title }}<AppIcon name="arrow" :size="12" /></button></EntryTooltip></div>
                </div>
              </div>
              <button class="icon-button entry-edit" :aria-label="`编辑事项 ${entry.title}`" :disabled="saving || loading" @click="editEntry(entry)"><AppIcon name="edit" :size="17" /></button>
            </article>
          </div>
        </section>
      </main>
    </div>

    <AppDialog v-if="showAccount" title="回到你的数据空间" @close="showAccount = false"><p class="account-description">输入邮箱，提取对应的项目和日历记录。</p><EmailForm :initial="email" @submit="enterAccount" /></AppDialog>
    <ProjectEditor v-if="projectEditor" :project="projectEditor.project" :entry-count="projectEditor.project ? projectCounts.get(projectEditor.project.id) || 0 : 0" :submit="saveProject" :remove="deleteProject" @close="projectEditor = null" />
    <EntryEditor v-if="entryEditor" :key="entryEditor.entry?.id || 'new'" :entry="entryEditor.entry" :date="entryEditor.date" :project-id="activeProject" :projects="data.projects" :entries="data.entries" :submit="saveEntry" :remove="deleteEntry" @close="entryEditor = null" />
  </div>
  </UApp>
</template>
