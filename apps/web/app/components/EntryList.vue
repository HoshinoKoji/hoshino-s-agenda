<script setup lang="ts">
import type { Asset, Entry, Project } from '../../../../shared/types'
import { legacyReferenceIds } from '../../../../shared/mentions'
import { dateKey } from '~/utils/dates'
import { RECURRENCE_LABELS } from '../../../../shared/recurrence'

const props = defineProps<{ entries: Entry[]; allEntries: Entry[]; projects: Project[]; assets: Asset[]; email: string; busy: boolean; tabOpening?: boolean; showDate?: boolean }>()
const emit = defineEmits<{ edit: [entry: Entry]; window: [entry: Entry]; export: [entry: Entry]; copy: [entry: Entry]; toggle: [entry: Entry]; follow: [entry: Entry | undefined] }>()
const projectMap = computed(() => new Map(props.projects.map(project => [project.id, project])))
const entryMap = computed(() => new Map(props.allEntries.map(entry => [entry.id, entry])))
const assetMap = computed(() => new Map(props.assets.map(asset => [asset.id, asset])))
const encryption = useEntryEncryption()
const legacyReferences = computed(() => new Map(props.entries.map(entry => [entry.id,
  legacyReferenceIds({ ...entry, description: encryption.description(entry) ?? '' })])))
const backlinks = computed(() => {
  const map = new Map<string, Entry[]>()
  for (const entry of props.allEntries) {
    for (const id of entry.references) map.set(id, [...(map.get(id) || []), entry])
  }
  return map
})
</script>

<template>
  <div class="entry-list">
    <article v-for="entry in entries" :id="`entry-${entry.id}`" :key="entry.id" class="entry-card" :class="{ 'entry-completed': entry.completed }" tabindex="-1" :aria-label="entry.title">
      <button class="completion-toggle" :class="{ checked: entry.completed }" :aria-label="`${entry.completed ? '标为未完成' : '标为完成'}：${entry.title}`" :aria-pressed="entry.completed" :disabled="busy" @click="emit('toggle', entry)"><AppIcon v-if="entry.completed" name="check" :size="14" /></button>
      <div class="entry-content">
        <div class="entry-heading">
          <div class="entry-heading-content">
            <button class="entry-title" :disabled="busy" @click="emit('edit', entry)">{{ entry.title }}</button>
            <div class="entry-meta"><span class="project-tag" :style="{ '--project-color': projectMap.get(entry.projectId)?.color }"><i class="project-dot" />{{ projectMap.get(entry.projectId)?.name }}</span><span v-if="showDate" class="entry-state">{{ entry.date ?? '未设日期' }}</span><time class="entry-state entry-created" :datetime="entry.createdAt">添加于 {{ dateKey(new Date(entry.createdAt)) }}</time><span class="entry-state">{{ entry.completed ? '已完成' : '进行中' }}</span><span v-if="entry.recurrence" class="entry-state recurrence-badge" :title="`截止 ${entry.recurrence.rule.until}${entry.recurrence.exception ? ' · 本次已单独调整' : ''}`"><AppIcon name="refresh" :size="12" />{{ RECURRENCE_LABELS[entry.recurrence.rule.frequency] }}重复{{ entry.recurrence.exception ? ' · 单次调整' : '' }}</span></div>
          </div>
          <div class="entry-actions"><button class="icon-button entry-edit" :aria-label="`编辑事项 ${entry.title}`" :disabled="busy" @click="emit('edit', entry)"><AppIcon name="edit" :size="17" /></button><button class="icon-button" :aria-label="`在新标签页编辑 ${entry.title}`" title="在新标签页编辑" :disabled="busy || tabOpening" @click="emit('window', entry)"><AppIcon name="external" :size="17" /></button><button class="icon-button" :aria-label="`导出事项 ${entry.title}`" title="导出事项" :disabled="busy" @click="emit('export', entry)"><AppIcon name="print" :size="17" /></button><button class="icon-button" :aria-label="`复制事项 ${entry.title}`" title="复制事项" :disabled="busy" @click="emit('copy', entry)"><AppIcon name="copy" :size="17" /></button></div>
        </div>
        <EntryDescription :entry="entry" :entries="allEntries" :projects="projects" collapsible @follow="emit('follow', $event)" />
        <AssetAttachments :assets="entry.assetIds.map(id => assetMap.get(id)).filter((asset): asset is Asset => !!asset)" :email="email" />
        <div v-if="legacyReferences.get(entry.id)?.length || backlinks.get(entry.id)?.length" class="entry-links">
          <div v-if="legacyReferences.get(entry.id)?.length" class="reference-group"><span><AppIcon name="link" :size="12" />引用</span><template v-for="id in legacyReferences.get(entry.id)" :key="id"><EntryTooltip v-if="entryMap.has(id)" :entry="entryMap.get(id)!" :entries="allEntries" :projects="projects"><button class="reference-chip" @click="emit('follow', entryMap.get(id))">@{{ entryMap.get(id)?.title }}<AppIcon name="arrow" :size="12" /></button></EntryTooltip><span v-else class="reference-chip">@事项已删除</span></template></div>
          <div v-if="backlinks.get(entry.id)?.length" class="reference-group"><span><AppIcon name="link" :size="12" />被引用</span><EntryTooltip v-for="source in backlinks.get(entry.id)" :key="source.id" :entry="source" :entries="allEntries" :projects="projects"><button class="reference-chip backlink" @click="emit('follow', source)">@{{ source.title }}<AppIcon name="arrow" :size="12" /></button></EntryTooltip></div>
        </div>
      </div>
    </article>
  </div>
</template>
