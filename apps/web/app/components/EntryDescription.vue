<script setup lang="ts">
import type { Entry, Project } from '../../../../shared/types'
import { parseDescription } from '../../../../shared/mentions'

const props = withDefaults(defineProps<{ entry: Entry; entries: Entry[]; projects: Project[]; interactive?: boolean }>(), { interactive: true })
const emit = defineEmits<{ follow: [entry: Entry] }>()
const parts = computed(() => {
  const entries = new Map(props.entries.map(entry => [entry.id, entry]))
  const references = new Set(props.entry.references)
  return parseDescription(props.entry.description).map(part => {
    if (part.type === 'text') return part
    return { ...part, target: entries.get(part.id), linked: references.has(part.id) && part.id !== props.entry.id }
  })
})
</script>

<template>
  <div v-if="entry.description" class="entry-description"><template v-for="part in parts" :key="part.start"><template v-if="part.type === 'text'">{{ part.text }}</template><span v-else-if="!part.target" class="entry-mention missing">@{{ part.label }}（已删除）</span><EntryTooltip v-else-if="part.linked && interactive" :entry="part.target" :entries="entries" :projects="projects"><button type="button" class="entry-mention" @click="emit('follow', part.target)">@{{ part.target.title }}</button></EntryTooltip><span v-else-if="part.linked" class="entry-mention">@{{ part.target.title }}</span><template v-else>{{ part.text }}</template></template></div>
</template>
