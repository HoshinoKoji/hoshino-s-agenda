<script setup lang="ts">
import { DESCRIPTION_MAX_LENGTH, type Entry, type Project } from '../../../../shared/types'
import { MAX_ENTRY_REFERENCES, mentionQueryAt, serializeMention, type MentionQuery } from '../../../../shared/mentions'

const props = defineProps<{
  modelValue: string
  entries: Entry[]
  projects: Project[]
  references: string[]
  selfId?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId()
const textarea = ref<HTMLTextAreaElement>()
const list = ref<HTMLElement>()
const query = ref<MentionQuery | null>(null)
const active = ref(0)
const composing = ref(false)
const feedback = ref('')
let compositionTimer: ReturnType<typeof setTimeout> | undefined
const projectMap = computed(() => new Map(props.projects.map(project => [project.id, project])))
const candidates = computed(() => {
  if (!query.value) return []
  const terms = query.value.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return props.entries.filter(entry => {
    const search = `${entry.title} ${projectMap.value.get(entry.projectId)?.name || ''} ${entry.date ?? '未设日期'}`.toLocaleLowerCase()
    return entry.id !== props.selfId && terms.every(term => search.includes(term))
  }).slice().reverse()
})
const activeId = computed(() => query.value && candidates.value[active.value] ? `${id}-option-${active.value}` : undefined)

function close() { query.value = null }
function updateQuery() {
  const input = textarea.value
  if (!input || props.disabled || composing.value || document.activeElement !== input) return
  const next = mentionQueryAt(input.value, input.selectionStart, input.selectionEnd)
  if (next?.start !== query.value?.start || next?.query !== query.value?.query) active.value = 0
  query.value = next
}
function input(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  feedback.value = ''
  updateQuery()
}
function compositionEnd() {
  // Some IMEs deliver the confirming Enter immediately after compositionend.
  clearTimeout(compositionTimer)
  compositionTimer = setTimeout(() => { composing.value = false; updateQuery() }, 0)
}
onBeforeUnmount(() => clearTimeout(compositionTimer))
watch(() => props.disabled, disabled => { if (disabled) close() })
watch(candidates, items => { active.value = Math.min(active.value, Math.max(0, items.length - 1)) })

async function choose(entry: Entry) {
  const range = query.value
  const input = textarea.value
  if (!range || !input || composing.value || props.disabled) return
  if (!props.references.includes(entry.id) && props.references.length >= MAX_ENTRY_REFERENCES) {
    feedback.value = '最多引用 50 个不同事项，请先移除一个引用。'
    return
  }
  const marker = serializeMention(entry)
  // Keep the suffix (including its whitespace) intact when editing in the middle.
  const value = props.modelValue.slice(0, range.start) + marker + props.modelValue.slice(range.end)
  if (value.length > DESCRIPTION_MAX_LENGTH) {
    feedback.value = `插入后描述会超过 ${DESCRIPTION_MAX_LENGTH} 字符，请先缩短描述。`
    return
  }
  emit('update:modelValue', value)
  feedback.value = ''
  close()
  await nextTick()
  input.focus()
  input.setSelectionRange(range.start + marker.length, range.start + marker.length)
}
function keydown(event: KeyboardEvent) {
  if (composing.value || event.isComposing || event.keyCode === 229) return
  if (!query.value) return
  if (event.key === 'Escape') {
    // Cancelling the picker must not cancel the enclosing native dialog.
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const count = candidates.value.length
    if (count) {
      active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
      nextTick(() => list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
    }
  } else if (event.key === 'Enter' && !event.shiftKey && candidates.value[active.value]) {
    event.preventDefault()
    void choose(candidates.value[active.value]!)
  } else if (event.key === 'Tab') {
    close()
  }
}
function keyup(event: KeyboardEvent) {
  // These keys act on the popup rather than moving the textarea caret.
  if (['Escape', 'Enter', 'ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) return
  updateQuery()
}
</script>

<template>
  <div class="description-editor field">
    <label :for="`${id}-input`">描述 <span class="muted">（可选）</span></label>
    <textarea
      :id="`${id}-input`" ref="textarea" :value="modelValue" :maxlength="DESCRIPTION_MAX_LENGTH" rows="5"
      :disabled="disabled" placeholder="补充事项描述，输入 @ 引用事项" aria-autocomplete="list"
      :aria-describedby="`${id}-help ${id}-status`" :aria-controls="query ? `${id}-list` : undefined"
      :aria-activedescendant="activeId" aria-haspopup="listbox"
      @input="input" @click="updateQuery" @select="updateQuery" @focus="updateQuery" @keyup="keyup" @keydown="keydown" @blur="close"
      @compositionstart="composing = true; close()" @compositionend="compositionEnd"
    />
    <div class="description-help"><p :id="`${id}-help`" class="field-help">支持 Markdown，编辑时显示源码。输入 @ 搜索事项；↑↓ 选择，Enter 插入，Esc 收起。</p><span class="muted">{{ modelValue.length }} / {{ DESCRIPTION_MAX_LENGTH }}</span></div>
    <div v-if="query" class="mention-picker">
      <div ref="list" :id="`${id}-list`" class="reference-options" role="listbox" aria-label="引用事项候选">
        <button
          v-for="(candidate, index) in candidates" :id="`${id}-option-${index}`" :key="candidate.id"
          type="button" role="option" tabindex="-1" :aria-selected="index === active" class="reference-option"
          :aria-disabled="references.length >= MAX_ENTRY_REFERENCES && !references.includes(candidate.id)"
          @pointerdown.prevent @click="choose(candidate)"
        ><span class="reference-option-text"><strong>@{{ candidate.title }}</strong><small><i class="project-dot" :style="{ background: projectMap.get(candidate.projectId)?.color }" />{{ projectMap.get(candidate.projectId)?.name }}<span>·</span>{{ candidate.date ?? '未设日期' }}</small></span></button>
      </div>
      <p v-if="!candidates.length" class="small-empty" role="status">没有找到相关事项，可继续作为纯文本输入。</p>
    </div>
    <p :id="`${id}-status`" class="description-status" :class="{ 'danger-text': feedback || references.length > MAX_ENTRY_REFERENCES }" role="status" aria-live="polite">{{ feedback || (references.length >= MAX_ENTRY_REFERENCES ? `已引用 ${references.length} / 50 个事项；新增引用前请先移除一个。` : `已引用 ${references.length} / 50 个事项`) }}</p>
  </div>
</template>
