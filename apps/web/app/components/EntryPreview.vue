<script setup lang="ts">
import type { Entry, Project } from '../../../../shared/types'

const props = defineProps<{ entry: Entry; entries: Entry[]; projects: Project[] }>()
const project = computed(() => props.projects.find(project => project.id === props.entry.projectId))
</script>

<template>
  <strong class="calendar-tooltip-title">{{ entry.title }}</strong>
  <div class="calendar-tooltip-meta"><span v-if="project"><i class="project-dot" :style="{ background: project.color }" />{{ project.name }}</span><span>{{ entry.date ?? '未设日期' }}</span><span>{{ entry.completed ? '已完成' : '进行中' }}</span></div>
  <EntryDescription :entry="entry" :entries="entries" :projects="projects" :interactive="false" />
</template>
