<script setup lang="ts">
import type { Entry, EntryInput, Project } from '../../../../shared/types'
const props = defineProps<{
  entry?: Entry
  date: string
  projectId: string
  projects: Project[]
  entries: Entry[]
  submit: (data: EntryInput, id?: string) => Promise<void>
  remove: (id: string) => Promise<void>
}>()
const emit = defineEmits<{ close: [] }>()
const form = reactive<EntryInput>({
  title: props.entry?.title || '',
  date: props.entry?.date || props.date,
  projectId: props.entry?.projectId || props.projectId || props.projects[0]?.id || '',
  completed: props.entry?.completed || false,
  references: [...(props.entry?.references || [])],
})
const query = ref('')
const busy = ref(false)
const error = ref('')
const confirming = ref(false)
const projectMap = computed(() => new Map(props.projects.map(project => [project.id, project])))
const candidates = computed(() => props.entries.filter(entry => entry.id !== props.entry?.id &&
  `${entry.title} ${entry.date} ${projectMap.value.get(entry.projectId)?.name}`.toLowerCase().includes(query.value.toLowerCase())).slice().reverse())
const incoming = computed(() => props.entries.filter(entry => props.entry && entry.id !== props.entry.id && entry.references.includes(props.entry.id)))
async function save() {
  busy.value = true
  error.value = ''
  try { await props.submit({ ...form, references: [...form.references] }, props.entry?.id); emit('close') }
  catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false }
}
async function remove() {
  if (!props.entry) return
  busy.value = true
  error.value = ''
  try { await props.remove(props.entry.id); emit('close') }
  catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false }
}
</script>

<template>
  <AppDialog :title="entry ? '编辑事项' : '添加事项'" :busy="busy" wide @close="emit('close')">
    <form @submit.prevent="save">
      <fieldset :disabled="busy" class="form-fields">
        <label class="field">事项标题<input v-model="form.title" required maxlength="200" placeholder="今天，想推进哪件小事？" autofocus></label>
        <div class="field-row"><label class="field">所属项目<select v-model="form.projectId" required><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label><label class="field">记录日期<input v-model="form.date" type="date" required min="0001-01-01" max="9999-12-31"></label></div>
        <label class="checkbox-label completion-field"><input v-model="form.completed" type="checkbox"><span>已完成这件事项</span><AppIcon name="spark" :size="17" /></label>
        <section class="reference-picker"><div class="section-label"><span><AppIcon name="link" :size="16" />引用事项</span><span class="muted">已选 {{ form.references.length }} / 50</span></div><p class="field-help">可引用其他项目或日期的事项。</p>
          <label class="search-field"><AppIcon name="search" :size="17" /><input v-model="query" aria-label="搜索引用事项" placeholder="搜索标题、项目或日期"></label>
          <div class="reference-options">
            <label v-for="candidate in candidates" :key="candidate.id" class="reference-option"><input v-model="form.references" type="checkbox" :value="candidate.id" :disabled="form.references.length >= 50 && !form.references.includes(candidate.id)"><span class="reference-option-text"><strong>{{ candidate.title }}</strong><small><i class="project-dot" :style="{ background: projectMap.get(candidate.projectId)?.color }" />{{ projectMap.get(candidate.projectId)?.name }}<span>·</span>{{ candidate.date }}</small></span></label>
            <p v-if="!candidates.length" class="small-empty">{{ entries.length > (entry ? 1 : 0) ? '没有找到相关事项' : '其他事项创建后，就可以在这里引用了。' }}</p>
          </div>
        </section>
        <div v-if="incoming.length" class="backlinks-note"><AppIcon name="link" :size="15" /><span>被 {{ incoming.length }} 个事项引用：{{ incoming.map(item => item.title).join('、') }}</span></div>
        <div v-if="confirming" class="delete-confirm"><p>确定删除这个事项？其他事项中指向它的引用也会移除。</p><button type="button" class="button danger" @click="remove">确认删除事项</button><button type="button" class="button ghost" @click="confirming = false">取消</button></div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <footer class="form-footer"><button v-if="entry && !confirming" type="button" class="icon-button danger-text" aria-label="删除事项" @click="confirming = true"><AppIcon name="trash" /></button><span class="spacer" /><button type="button" class="button secondary" @click="emit('close')">取消</button><button class="button primary" type="submit">{{ busy ? '保存中…' : entry ? '保存修改' : '添加事项' }}<AppIcon v-if="!busy" name="check" :size="17" /></button></footer>
      </fieldset>
    </form>
  </AppDialog>
</template>
