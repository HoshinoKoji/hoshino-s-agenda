<script setup lang="ts">
import type { Entry, Project } from '../../../../shared/types'

defineProps<{ entry: Entry; entries: Entry[]; projects: Project[]; tap?: boolean }>()
</script>

<template>
  <UPopover v-if="tap" :portal="true" :content="{ side: 'top', collisionPadding: 12 }" :ui="{ content: 'calendar-tooltip h-auto block p-3' }">
    <slot />
    <template #content>
      <EntryPreview :entry="entry" :entries="entries" :projects="projects" />
    </template>
  </UPopover>
  <UTooltip v-else :portal="true" :delay-duration="300" :content="{ side: 'top', collisionPadding: 12 }" :ui="{ content: 'calendar-tooltip h-auto block p-3' }">
    <slot />
    <template #content>
      <EntryPreview :entry="entry" :entries="entries" :projects="projects" />
    </template>
  </UTooltip>
</template>
