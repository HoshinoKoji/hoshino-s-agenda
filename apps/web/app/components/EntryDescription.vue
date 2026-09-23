<script setup lang="ts">
import type { Entry, Project } from '../../../../shared/types'
import { parseDescription } from '../../../../shared/mentions'

const props = withDefaults(defineProps<{ entry: Entry; entries: Entry[]; projects: Project[]; interactive?: boolean; collapsible?: boolean }>(), { interactive: true, collapsible: false })
const emit = defineEmits<{ follow: [entry: Entry] }>()
const descriptionElement = ref<HTMLElement | null>(null)
const descriptionId = useId()
const expanded = ref(false)
const overflowing = ref(false)
const parts = computed(() => {
  const entries = new Map(props.entries.map(entry => [entry.id, entry]))
  const references = new Set(props.entry.references)
  return parseDescription(props.entry.description).map(part => {
    if (part.type === 'text') return part
    return { ...part, target: entries.get(part.id), linked: references.has(part.id) && part.id !== props.entry.id }
  })
})
watch(() => [props.entry.id, props.entry.description], () => { expanded.value = false })
watch([descriptionElement, parts, () => props.collapsible], ([element], _, onCleanup) => {
  overflowing.value = false
  if (!element || !props.collapsible) return
  const measure = () => {
    overflowing.value = element.scrollHeight > parseFloat(getComputedStyle(element).lineHeight) * 4 + 1
  }
  const observer = new ResizeObserver(measure)
  observer.observe(element)
  measure()
  onCleanup(() => observer.disconnect())
}, { flush: 'post' })
</script>

<template>
  <div v-if="entry.description" :id="descriptionId" ref="descriptionElement" class="entry-description" :class="{ 'is-collapsed': collapsible && !expanded }"><template v-for="part in parts" :key="part.start"><template v-if="part.type === 'text'">{{ part.text }}</template><span v-else-if="!part.target" class="entry-mention missing">@{{ part.label }}（已删除）</span><EntryTooltip v-else-if="part.linked && interactive" :entry="part.target" :entries="entries" :projects="projects"><button type="button" class="entry-mention" @focus="expanded = collapsible || expanded" @click="emit('follow', part.target)">@{{ part.target.title }}</button></EntryTooltip><span v-else-if="part.linked" class="entry-mention">@{{ part.target.title }}</span><template v-else>{{ part.text }}</template></template></div>
  <button v-if="collapsible && overflowing" type="button" class="description-toggle" :aria-expanded="expanded" :aria-controls="descriptionId" @click="expanded = !expanded">{{ expanded ? '收起' : '显示全部' }}</button>
</template>
