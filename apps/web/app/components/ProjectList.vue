<script setup lang="ts">
import type { Project } from '../../../../shared/types'

const props = defineProps<{ projects: Project[]; activeProject: string; counts: Map<string, number>; busy: boolean }>()
const emit = defineEmits<{ select: [id: string]; overview: [id: string]; edit: [project: Project]; reorder: [ids: string[]] }>()
function move(index: number, delta: number) {
  if (props.busy || index + delta < 0 || index + delta >= props.projects.length) return
  const ids = props.projects.map(project => project.id)
  ;[ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]
  emit('reorder', ids)
}
</script>

<template>
  <div class="project-list">
    <div v-for="(project, index) in projects" :key="project.id" class="project-nav-row" :class="{ active: activeProject === project.id }">
      <button class="nav-item" :aria-pressed="activeProject === project.id" @click="emit('select', project.id)"><i class="project-dot" :style="{ background: project.color }" /><span class="truncate">{{ project.name }}</span><span class="count">{{ counts.get(project.id) || 0 }}</span></button>
      <ProjectActions :name="project.name" :disabled="busy" :first="index === 0" :last="index === projects.length - 1" @overview="emit('overview', project.id)" @edit="emit('edit', project)" @up="move(index, -1)" @down="move(index, 1)" />
    </div>
    <p v-if="!projects.length && !busy" class="sidebar-empty">(空)</p>
  </div>
</template>
