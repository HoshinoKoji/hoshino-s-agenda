<script setup lang="ts">
import type { Asset, Entry, Project } from '../../../../shared/types'
import { matchesOverviewDateFilter, type OverviewDateFilter } from '~/utils/overviewDates'
import { matchesOverviewTitleSearch } from '~/utils/overviewSearch'

const props = defineProps<{ projects: Project[]; entries: Entry[]; assets: Asset[]; email: string; activeProject: string; busy: boolean; loading: boolean; tabOpening?: boolean }>()
const showCompleted = defineModel<boolean>('showCompleted', { default: false })
const dateFilter = defineModel<OverviewDateFilter>('dateFilter', { required: true })
const titleSearch = defineModel<string>('titleSearch', { required: true })
const hasSearch = computed(() => !!titleSearch.value.trim())
const isFiltered = computed(() => dateFilter.value.type !== 'all' || hasSearch.value)
const encryption = useEntryEncryption()
const emit = defineEmits<{
  add: [projectId: string]
  createProject: []
  editProject: [project: Project]
  unlockProject: [project: Project]
  edit: [entry: Entry]
  window: [entry: Entry]
  export: [entry: Entry]
  copy: [entry: Entry]
  toggle: [entry: Entry]
  follow: [entry: Entry | undefined]
}>()
const groups = computed(() => {
  const byProject = new Map<string, Entry[]>()
  for (const entry of props.entries) {
    if (!matchesOverviewDateFilter(entry.date, dateFilter.value)) continue
    if (!matchesOverviewTitleSearch(entry.title, titleSearch.value)) continue
    const list = byProject.get(entry.projectId) || []
    list.push(entry)
    byProject.set(entry.projectId, list)
  }
  return props.projects.filter(project => !props.activeProject || project.id === props.activeProject).map(project => {
    const entries = (byProject.get(project.id) || []).sort((a, b) =>
      (a.date ?? '').localeCompare(b.date ?? '') ||
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    return { project, entries, visibleEntries: entries.filter(entry => showCompleted.value || !entry.completed), remaining: entries.filter(entry => !entry.completed).length }
  })
})
const total = computed(() => groups.value.reduce((sum, group) => sum + group.entries.length, 0))
const remaining = computed(() => groups.value.reduce((sum, group) => sum + group.remaining, 0))
const visibleGroups = computed(() => groups.value.filter(group =>
  (!isFiltered.value || group.entries.length > 0) &&
  (showCompleted.value || !group.entries.length || group.remaining > 0)))
const summaryLabel = computed(() => hasSearch.value ? '标题搜索结果概览' : dateFilter.value.type === 'range' ? '所选时间段概览' : dateFilter.value.type === 'undated' ? '无日期事项概览' : '全部日期概览')
const emptyMessage = computed(() => {
  if (total.value > 0) return isFiltered.value ? '匹配的已完成事项已隐藏' : '已完成项目已隐藏'
  if (hasSearch.value) return '当前筛选下没有匹配标题的事项'
  return dateFilter.value.type === 'undated' ? '暂无无日期事项' : '该时间段暂无事项'
})
</script>

<template>
  <section class="project-overview" aria-label="项目总览" :aria-busy="loading">
    <header class="overview-toolbar">
      <div class="month-heading">
        <h2>项目总览</h2>
        <div class="summary-counts" :aria-label="summaryLabel">
          <span>未完成 <strong>{{ remaining }}</strong></span>
          <span class="summary-divider" aria-hidden="true">/</span>
          <button class="completed-count-toggle" :aria-pressed="showCompleted" :title="showCompleted ? '隐藏已完成事项' : '显示已完成事项'" @click="showCompleted = !showCompleted">已完成 <strong>{{ total - remaining }}</strong></button>
        </div>
      </div>
      <div class="overview-actions">
        <button class="button secondary" :disabled="busy" @click="emit('createProject')"><AppIcon name="plus" :size="16" />项目</button>
      </div>
    </header>
    <div class="overview-filters"><OverviewDateFilter v-model="dateFilter" /><OverviewTitleSearch v-model="titleSearch" /></div>
    <div v-if="!groups.length" class="day-empty"><p v-if="loading">正在从云端取回你的记录…</p><template v-else><h3>(空)</h3><button class="text-button" :disabled="busy" @click="emit('createProject')">创建项目<AppIcon name="arrow" :size="15" /></button></template></div>
    <p v-if="groups.length && !visibleGroups.length" class="small-empty">{{ emptyMessage }}</p>
    <section v-for="group in visibleGroups" :key="group.project.id" class="overview-project" :aria-labelledby="`project-title-${group.project.id}`">
      <header class="overview-project-heading">
        <div class="overview-project-title"><h3 :id="`project-title-${group.project.id}`"><i class="project-dot" :style="{ background: group.project.color }" />{{ group.project.name }}</h3><p>{{ group.entries.length }} 个事项，未完成 {{ group.remaining }} 个</p></div>
        <div class="overview-actions"><button v-if="group.project.encryption" class="icon-button" :aria-label="`${encryption.getProject(group.project) ? '重新锁定项目' : '解锁项目描述'} ${group.project.name}`" :title="encryption.getProject(group.project) ? '重新锁定项目' : '解锁项目描述'" :disabled="busy" @click="encryption.getProject(group.project) ? encryption.lockProject(group.project.id) : emit('unlockProject', group.project)"><AppIcon name="lock" :size="16" /></button><button class="icon-button" :aria-label="`编辑项目 ${group.project.name}`" :disabled="busy" @click="emit('editProject', group.project)"><AppIcon name="edit" :size="16" /></button><button class="button secondary" :aria-label="`为 ${group.project.name} 添加事项`" :disabled="busy" @click="emit('add', group.project.id)"><AppIcon name="plus" :size="16" />事项</button></div>
      </header>
      <EntryList v-if="group.visibleEntries.length" :entries="group.visibleEntries" :all-entries="entries" :projects="projects" :assets="assets" :email="email" :busy="busy" :tab-opening="tabOpening" show-date @edit="emit('edit', $event)" @window="emit('window', $event)" @export="emit('export', $event)" @copy="emit('copy', $event)" @toggle="emit('toggle', $event)" @follow="emit('follow', $event)" />
      <p v-else class="small-empty">暂无事项</p>
    </section>
  </section>
</template>
