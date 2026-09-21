<script setup lang="ts">
import type { Entry, Project } from '../../../../shared/types'

const props = defineProps<{ projects: Project[]; entries: Entry[]; activeProject: string; busy: boolean; loading: boolean }>()
const showCompleted = defineModel<boolean>('showCompleted', { default: false })
const emit = defineEmits<{
  add: [projectId: string]
  createProject: []
  editProject: [project: Project]
  edit: [entry: Entry]
  toggle: [entry: Entry]
  follow: [entry: Entry | undefined]
}>()
const groups = computed(() => {
  const byProject = new Map<string, Entry[]>()
  for (const entry of props.entries) {
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
const visibleGroups = computed(() => groups.value.filter(group => showCompleted.value || !group.entries.length || group.remaining > 0))
</script>

<template>
  <section class="project-overview" aria-label="项目总览" :aria-busy="loading">
    <header class="overview-toolbar">
      <div class="month-heading">
        <h2>项目总览</h2>
        <div class="summary-counts" aria-label="全部日期概览">
          <span>未完成 <strong>{{ remaining }}</strong></span>
          <span class="summary-divider" aria-hidden="true">/</span>
          <button class="completed-count-toggle" :aria-pressed="showCompleted" :title="showCompleted ? '隐藏已完成事项' : '显示已完成事项'" @click="showCompleted = !showCompleted">已完成 <strong>{{ total - remaining }}</strong></button>
        </div>
      </div>
      <div class="overview-actions">
        <button class="button secondary" :disabled="busy" @click="emit('createProject')"><AppIcon name="plus" :size="16" />项目</button>
      </div>
    </header>
    <div v-if="!groups.length" class="day-empty"><p v-if="loading">正在从云端取回你的记录…</p><template v-else><h3>(空)</h3><button class="text-button" :disabled="busy" @click="emit('createProject')">创建项目<AppIcon name="arrow" :size="15" /></button></template></div>
    <p v-if="groups.length && !visibleGroups.length" class="small-empty">已完成项目已隐藏</p>
    <section v-for="group in visibleGroups" :key="group.project.id" class="overview-project" :aria-labelledby="`project-title-${group.project.id}`">
      <header class="overview-project-heading">
        <div class="overview-project-title"><h3 :id="`project-title-${group.project.id}`"><i class="project-dot" :style="{ background: group.project.color }" />{{ group.project.name }}</h3><p>{{ group.entries.length }} 个事项，未完成 {{ group.remaining }} 个</p></div>
        <div class="overview-actions"><button class="icon-button" :aria-label="`编辑项目 ${group.project.name}`" :disabled="busy" @click="emit('editProject', group.project)"><AppIcon name="edit" :size="16" /></button><button class="button secondary" :aria-label="`为 ${group.project.name} 添加事项`" :disabled="busy" @click="emit('add', group.project.id)"><AppIcon name="plus" :size="16" />事项</button></div>
      </header>
      <EntryList v-if="group.visibleEntries.length" :entries="group.visibleEntries" :all-entries="entries" :projects="projects" :busy="busy" show-date @edit="emit('edit', $event)" @toggle="emit('toggle', $event)" @follow="emit('follow', $event)" />
      <p v-else class="small-empty">暂无事项</p>
    </section>
  </section>
</template>
