<script setup lang="ts">
import type { Entry, Project } from '../../../shared/types'
import { dateKey, formatDate, parseDate } from '~/utils/dates'

const email = ref('')
const hydrated = ref(false)
const today = ref(dateKey(new Date()))
const selected = ref(today.value)
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
const filteredEntries = computed(() => data.value.entries.filter(entry => !activeProject.value || entry.projectId === activeProject.value))
const monthPrefix = computed(() => dateKey(month.value).slice(0, 7))
const monthEntries = computed(() => filteredEntries.value.filter(entry => entry.date.startsWith(monthPrefix.value)))
const completedCount = computed(() => monthEntries.value.filter(entry => entry.completed).length)
const completionRate = computed(() => monthEntries.value.length ? Math.round(completedCount.value / monthEntries.value.length * 100) : 0)
const selectedEntries = computed(() => filteredEntries.value.filter(entry => entry.date === selected.value))
const selectedCompleted = computed(() => selectedEntries.value.filter(entry => entry.completed).length)
const monthLabel = computed(() => month.value.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }))
const englishMonth = computed(() => month.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))
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
  <div v-if="!hydrated" class="boot-screen"><span class="brand-mark"><AppIcon name="spark" :size="26" /></span><p>正在打开日历…</p></div>

  <main v-else-if="!email" class="welcome">
    <div class="welcome-art" aria-hidden="true"><div class="welcome-orbit orbit-one" /><div class="welcome-orbit orbit-two" /><span class="welcome-star star-one">✦</span><span class="welcome-star star-two">✧</span><div class="paper-calendar"><div class="paper-top"><span>EVERY LITTLE STEP</span><AppIcon name="spark" :size="21" /></div><span class="paper-number">{{ new Date().getDate() }}</span><div class="paper-line" /><div class="paper-line short" /><div class="paper-tag"><AppIcon name="check" :size="14" />今天，也有新的进展</div></div><p class="art-caption">Small steps. Meaningful days.</p></div>
    <section class="welcome-content"><a class="brand welcome-brand" href="/"><span class="brand-mark"><AppIcon name="spark" :size="25" /></span><span>日迹<span class="brand-en">HOSHINO’S AGENDA</span></span></a><div class="welcome-copy"><span class="eyebrow">A LITTLE PROGRESS, EVERY DAY</span><h1>让每一天的进展，<br>都有迹可循<span>。</span></h1><p>项目、日常与那些灵光一现的小事，<br>在日历里慢慢连成线。</p></div><EmailForm @submit="enterAccount" /><div class="welcome-footer"><AppIcon name="cloud" :size="17" /><span>云端记录，随时拾起你的进度</span></div></section>
  </main>

  <div v-else class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/" aria-label="日迹首页"><span class="brand-mark"><AppIcon name="spark" :size="24" /></span><span>日迹<span class="brand-en">HOSHINO’S AGENDA</span></span></a>
      <div class="sidebar-intro">把日子，写成进展。</div>
      <nav class="project-nav" aria-label="项目筛选"><button class="nav-item all-projects" :class="{ active: !activeProject }" :aria-pressed="!activeProject" @click="activeProject = ''"><AppIcon name="calendar" :size="19" /><span>全部项目</span><span class="count">{{ data.entries.length }}</span></button><div class="nav-heading"><span>我的项目</span><button class="icon-button" aria-label="新建项目" :disabled="loading || saving" @click="projectEditor = {}"><AppIcon name="plus" :size="17" /></button></div><div class="project-list"><div v-for="project in data.projects" :key="project.id" class="project-nav-row" :class="{ active: activeProject === project.id }"><button class="nav-item" :aria-pressed="activeProject === project.id" @click="activeProject = project.id"><i class="project-dot" :style="{ background: project.color }" /><span class="truncate">{{ project.name }}</span><span class="count">{{ projectCounts.get(project.id) || 0 }}</span></button><button class="project-edit icon-button" :aria-label="`编辑项目 ${project.name}`" :disabled="saving || loading" @click="projectEditor = { project }"><AppIcon name="edit" :size="14" /></button></div><p v-if="!data.projects.length && !loading" class="sidebar-empty">还没有项目<br>从一个小小的计划开始吧</p></div><button class="new-project" :disabled="loading || saving" @click="projectEditor = {}"><AppIcon name="plus" :size="16" />创建新项目</button></nav>
      <div class="sidebar-bottom"><div class="little-note"><AppIcon name="spark" :size="20" /><p>不必一下子走得很远，<br>每天向前一点就好。</p><span>ONE DAY AT A TIME</span></div><button class="account-button" :disabled="saving" @click="showAccount = true"><span class="avatar">{{ email[0]?.toUpperCase() }}</span><span class="account-label"><strong>我的空间</strong><small>{{ email }}</small></span><AppIcon name="chevronDown" :size="15" /></button></div>
    </aside>

    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb"><AppIcon name="grid" :size="16" /><span>我的工作台</span><span class="breadcrumb-slash">/</span><strong>项目日历</strong></div><button class="sync-button" :disabled="loading || saving" :title="syncedAt ? `上次同步：${syncedAt.toLocaleTimeString('zh-CN')}` : '从云端读取数据'" @click="refresh"><span class="status-dot" :class="{ 'status-error': error, 'status-busy': loading || saving }" /><span>{{ saving ? '正在保存' : loading ? '正在同步' : error ? '同步失败 · 重试' : syncedAt ? '已与云端同步' : '同步数据' }}</span><AppIcon name="refresh" :size="14" :class="{ spinning: loading }" /></button></header>
      <main class="workspace">
        <section class="page-heading"><div><span class="eyebrow">YOUR DAYS, CONNECTED</span><h1>项目日历<span class="heading-spark">✳</span></h1><p>每一个小小的行动，都在让想法更近一步。</p></div><button class="button primary add-main" :disabled="loading || saving" @click="addEntry()"><AppIcon name="plus" :size="18" />添加事项</button></section>
        <div v-if="error" class="error-banner" role="alert"><span>{{ error }}</span><button class="text-button" :disabled="loading || saving" @click="refresh">重试</button></div>
        <section class="summary-row" aria-label="本月概览"><div class="summary-card"><span class="summary-icon lavender"><AppIcon name="calendar" :size="20" /></span><div><span class="summary-label">本月事项</span><strong>{{ monthEntries.length }}<small>项</small></strong></div><span class="summary-caption">一点一滴，积累成形</span></div><div class="summary-card"><span class="summary-icon sage"><AppIcon name="check" :size="21" /></span><div><span class="summary-label">已经完成</span><strong>{{ completedCount }}<small>项</small></strong></div><div class="mini-progress"><span>{{ completionRate }}%</span><div><i :style="{ width: `${completionRate}%` }" /></div></div></div><div class="summary-card"><span class="summary-icon peach"><AppIcon name="clock" :size="20" /></span><div><span class="summary-label">待推进</span><strong>{{ monthEntries.length - completedCount }}<small>项</small></strong></div><span class="summary-caption">按自己的节奏来</span></div></section>

        <section class="calendar-card" :aria-busy="loading">
          <header class="calendar-toolbar"><div class="month-heading"><h2>{{ monthLabel }}</h2><span>{{ englishMonth }}</span></div><div class="calendar-controls"><span v-if="currentProject" class="filter-chip"><i class="project-dot" :style="{ background: currentProject.color }" /><span class="truncate">{{ currentProject.name }}</span><button class="icon-button" aria-label="清除项目筛选" @click="activeProject = ''"><AppIcon name="close" :size="13" /></button></span><button class="button today-button" @click="selectDate(today)">今天</button><div class="month-navigation"><button class="icon-button" aria-label="上个月" @click="changeMonth(-1)"><AppIcon name="chevronLeft" :size="18" /></button><button class="icon-button" aria-label="下个月" @click="changeMonth(1)"><AppIcon name="chevronRight" :size="18" /></button></div><span class="view-label">月视图<AppIcon name="calendar" :size="15" /></span></div></header>
          <CalendarGrid :month="month" :selected="selected" :today="today" :entries="filteredEntries" :projects="data.projects" @select="selectDate" @edit="editEntry" @add="addEntry" />
          <footer class="calendar-footer"><span><i class="legend-dot" />点击日期查看详情，点击事项进行编辑</span><span>{{ currentProject ? currentProject.name : '全部项目' }}<span class="footer-divider">·</span>周一为一周的开始</span></footer>
        </section>

        <section class="day-panel" aria-labelledby="day-title"><header class="day-panel-heading"><div class="day-title-group"><span class="day-icon"><AppIcon name="calendar" :size="20" /></span><div><h2 id="day-title">{{ formatDate(selected) }}<span v-if="selected === today" class="today-badge">今天</span></h2><p>{{ selectedEntries.length ? `${selectedEntries.length} 个事项，已完成 ${selectedCompleted} 个` : currentProject ? `「${currentProject.name}」在这一天还没有事项` : '留一点空间，记录这一天' }}</p></div></div><button class="button secondary" :disabled="loading || saving" @click="addEntry()"><AppIcon name="plus" :size="16" />添加事项</button></header>
          <div v-if="loading && !syncedAt" class="day-empty"><AppIcon name="refresh" class="spinning" :size="25" /><p>正在从云端取回你的记录…</p></div>
          <div v-else-if="!selectedEntries.length" class="day-empty"><span class="empty-illustration"><AppIcon name="edit" :size="25" /><i>✧</i></span><h3>{{ data.projects.length ? '这一天，等你写下第一笔' : '每个项目，都从一个想法开始' }}</h3><p>{{ data.projects.length ? '一个待办、一点进展，或一件已经完成的小事。' : '先创建一个项目，再把具体事项安排到日历里。' }}</p><button class="text-button" :disabled="loading || saving" @click="data.projects.length ? addEntry() : projectEditor = {}">{{ data.projects.length ? '记录新事项' : '创建第一个项目' }}<AppIcon name="arrow" :size="15" /></button></div>
          <div v-else class="entry-list"><article v-for="entry in selectedEntries" :id="`entry-${entry.id}`" :key="entry.id" class="entry-card" :class="{ 'entry-completed': entry.completed }"><button class="completion-toggle" :class="{ checked: entry.completed }" :aria-label="`${entry.completed ? '标为未完成' : '标为完成'}：${entry.title}`" :aria-pressed="entry.completed" :disabled="saving || loading" @click="toggleEntry(entry)"><AppIcon v-if="entry.completed" name="check" :size="14" /></button><div class="entry-content"><button class="entry-title" @click="editEntry(entry)">{{ entry.title }}</button><div class="entry-meta"><span class="project-tag" :style="{ '--project-color': projectMap.get(entry.projectId)?.color }"><i class="project-dot" />{{ projectMap.get(entry.projectId)?.name }}</span><span class="entry-state">{{ entry.completed ? '已完成' : '进行中' }}</span></div><div v-if="entry.references.length || backlinks.get(entry.id)?.length" class="entry-links"><div v-if="entry.references.length" class="reference-group"><span><AppIcon name="link" :size="12" />引用</span><button v-for="id in entry.references" :key="id" class="reference-chip" :title="entryMap.get(id)?.date" @click="followReference(entryMap.get(id))">{{ entryMap.get(id)?.title || '事项已删除' }}<AppIcon name="arrow" :size="12" /></button></div><div v-if="backlinks.get(entry.id)?.length" class="reference-group"><span><AppIcon name="link" :size="12" />被引用</span><button v-for="source in backlinks.get(entry.id)" :key="source.id" class="reference-chip backlink" :title="source.date" @click="followReference(source)">{{ source.title }}<AppIcon name="arrow" :size="12" /></button></div></div></div><button class="icon-button entry-edit" :aria-label="`编辑事项 ${entry.title}`" :disabled="saving || loading" @click="editEntry(entry)"><AppIcon name="edit" :size="17" /></button></article></div>
        </section>
        <footer class="page-footer"><span>让进展被看见，让日子有回响。</span><span>MADE FOR YOUR EVERYDAY <AppIcon name="spark" :size="12" /></span></footer>
      </main>
    </div>

    <AppDialog v-if="showAccount" title="回到你的数据空间" @close="showAccount = false"><p class="account-description">输入邮箱，提取对应的项目和日历记录。</p><EmailForm :initial="email" @submit="enterAccount" /></AppDialog>
    <ProjectEditor v-if="projectEditor" :project="projectEditor.project" :entry-count="projectEditor.project ? projectCounts.get(projectEditor.project.id) || 0 : 0" :submit="saveProject" :remove="deleteProject" @close="projectEditor = null" />
    <EntryEditor v-if="entryEditor" :key="entryEditor.entry?.id || 'new'" :entry="entryEditor.entry" :date="entryEditor.date" :project-id="activeProject" :projects="data.projects" :entries="data.entries" :submit="saveEntry" :remove="deleteEntry" @close="entryEditor = null" />
  </div>
</template>
