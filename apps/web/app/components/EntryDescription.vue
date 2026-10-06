<script setup lang="ts">
import type { Entry, Project } from '../../../../shared/types'

const props = withDefaults(defineProps<{ entry: Entry; entries: Entry[]; projects: Project[]; interactive?: boolean; collapsible?: boolean; unlockable?: boolean }>(), { interactive: true, collapsible: false, unlockable: undefined })
const emit = defineEmits<{ follow: [entry: Entry] }>()
const encryption = useEntryEncryption()
const description = computed(() => encryption.description(props.entry))
const displayEntry = computed(() => ({ ...props.entry, description: description.value ?? '' }))
const canUnlock = computed(() => props.unlockable ?? props.interactive)
const descriptionElement = ref<HTMLElement | null>(null)
const descriptionId = useId()
const expanded = ref(false)
const overflowing = ref(false)
watch(() => [props.entry.id, description.value], () => { expanded.value = false })
watch([descriptionElement, description, () => props.collapsible], ([element], _, onCleanup) => {
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
  <template v-if="entry.encryptedDescription">
    <EntryUnlock v-if="description === undefined && canUnlock" :entry="entry" />
    <p v-else-if="description === undefined" class="description-lock-label"><AppIcon name="lock" :size="14" />描述已加密</p>
    <div v-else class="description-lock-label"><AppIcon name="lock" :size="14" /><span>{{ entry.encryptedDescription.version === 2 ? '项目描述已解锁' : '描述已解锁' }}</span><button v-if="canUnlock" type="button" class="text-button" @click="encryption.lock(entry.id)">{{ entry.encryptedDescription.version === 2 ? '重新锁定项目' : '重新锁定描述' }}</button></div>
  </template>
  <div v-if="description" :id="descriptionId" ref="descriptionElement" class="entry-description" :class="{ 'is-collapsed': collapsible && !expanded }" @focusin="expanded = collapsible || expanded"><EntryMarkdown :entry="displayEntry" :entries="entries" :projects="projects" :interactive="interactive" @follow="emit('follow', $event)" /></div>
  <button v-if="collapsible && overflowing" type="button" class="description-toggle" :aria-expanded="expanded" :aria-controls="descriptionId" @click="expanded = !expanded">{{ expanded ? '收起' : '显示全部' }}</button>
</template>
