<script setup lang="ts">
import type { Entry, Project } from '../../../../shared/types'

const props = defineProps<{ entry: Entry; projects: Project[]; x: number; y: number }>()
const color = computed(() => props.projects.find(project => project.id === props.entry.projectId)?.color || '#8574D8')
const position = computed(() => ({
  left: `${Math.max(8, Math.min(props.x + 12, window.innerWidth - 248))}px`,
  top: `${Math.max(8, Math.min(props.y + 12, window.innerHeight - 48))}px`,
  '--project-color': color.value,
}))
</script>

<template>
  <Teleport to="body">
    <div class="calendar-drag-preview" :style="position" aria-hidden="true">{{ entry.title }}</div>
  </Teleport>
</template>
