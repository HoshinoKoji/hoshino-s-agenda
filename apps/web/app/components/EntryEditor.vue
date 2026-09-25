<script setup lang="ts">
import { DESCRIPTION_MAX_LENGTH, type Asset, type Entry, type EntryInput, type Project } from '../../../../shared/types'
import { descriptionReferences, legacyReferenceIds, MAX_ENTRY_REFERENCES, mentionIds } from '../../../../shared/mentions'
import { dateKey } from '~/utils/dates'
const props = defineProps<{
  entry?: Entry
  date: string | null
  projectId: string
  projects: Project[]
  entries: Entry[]
  assets: Asset[]
  email: string
  upload: (file: File) => Promise<Asset>
  submit: (data: EntryInput, id?: string) => Promise<void>
  remove: (id: string) => Promise<void>
}>()
const emit = defineEmits<{ close: []; export: [entry: Entry] }>()
const initialDate = props.entry ? props.entry.date : props.date
const undated = ref(initialDate === null)
const form = reactive<Omit<EntryInput, 'references' | 'date'> & { description: string; date: string }>({
  title: props.entry?.title || '',
  description: props.entry?.description || '',
  date: initialDate ?? dateKey(new Date()),
  projectId: props.entry?.projectId || props.projectId || props.projects[0]?.id || '',
  completed: props.entry?.completed || false,
})
const legacy = ref(props.entry ? legacyReferenceIds(props.entry) : [])
const busy = ref(false)
const uploading = ref(false)
const assetIds = ref<string[]>([...(props.entry?.assetIds || [])])
const assetQuery = ref('')
const assetPicker = ref(false)
const selectedAssets = computed(() => assetIds.value.map(id => props.assets.find(asset => asset.id === id)).filter((asset): asset is Asset => !!asset))
const availableAssets = computed(() => props.assets.filter(asset => !assetIds.value.includes(asset.id) && asset.name.toLocaleLowerCase().includes(assetQuery.value.toLocaleLowerCase())))
const projectOpen = ref(false)
const error = ref('')
const confirming = ref(false)
const entryMap = computed(() => new Map(props.entries.map(entry => [entry.id, entry])))
const references = computed(() => descriptionReferences(form.description, props.entries, props.entry?.id, legacy.value))
const incoming = computed(() => props.entries.filter(entry => props.entry && entry.id !== props.entry.id && entry.references.includes(props.entry.id)))
const projectItems = computed(() => props.projects.map(project => ({ label: project.name, value: project.id })))
function closeProjectOnEscape(event: KeyboardEvent) {
  event.preventDefault()
  projectOpen.value = false
}
function updateDescription(value: string) {
  form.description = value
  // Once explicitly inserted into the description, deletion of that marker removes the relation too.
  const inline = new Set(mentionIds(value))
  legacy.value = legacy.value.filter(id => !inline.has(id))
}
async function save() {
  if (busy.value || uploading.value) return
  if (form.description.length > DESCRIPTION_MAX_LENGTH) { error.value = `描述不能超过 ${DESCRIPTION_MAX_LENGTH} 字符。`; return }
  if (references.value.length > MAX_ENTRY_REFERENCES) { error.value = '最多引用 50 个不同事项，请移除多余引用后保存。'; return }
  busy.value = true
  error.value = ''
  try { await props.submit({ ...form, date: undated.value ? null : form.date, references: [...references.value], assetIds: [...assetIds.value] }, props.entry?.id); emit('close') }
  catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false }
}
async function uploadFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  uploading.value = true
  error.value = ''
  try {
    for (const file of files) {
      if (assetIds.value.length >= 50) throw new Error('每个事项最多关联 50 个素材')
      const asset = await props.upload(file)
      assetIds.value.push(asset.id)
    }
  } catch (cause) { error.value = (cause as Error).message }
  finally { uploading.value = false }
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
  <AppDialog :title="entry ? '编辑事项' : '添加事项'" :busy="busy || uploading" wide @close="emit('close')">
    <form @submit.prevent="save">
      <fieldset :disabled="busy || uploading" class="form-fields">
        <label class="field">事项标题<input v-model="form.title" required maxlength="200" placeholder="今天，想推进哪件小事？" autofocus></label>
        <div class="field-row">
          <div class="field">
            <label for="entry-project">所属项目</label>
            <USelect
              id="entry-project" v-model="form.projectId" v-model:open="projectOpen" :items="projectItems"
              :portal="false" :disabled="busy" required
              :content="{ align: 'start', sideOffset: 4, collisionPadding: 8, onEscapeKeyDown: closeProjectOnEscape }"
              :ui="{
                base: 'w-full min-w-0 min-h-[43px] cursor-pointer rounded-lg border border-[#e5dfed] bg-[#fdfcfe] px-3 text-left text-[#5c5368] focus-visible:border-primary focus-visible:ring-primary',
                content: 'max-w-[calc(100vw-48px)] rounded-lg bg-white ring-[#eeedf3] shadow-[0_8px_28px_#30273f14]',
                item: 'cursor-pointer data-highlighted:not-data-disabled:text-primary data-highlighted:not-data-disabled:before:bg-[#fff4f8] data-[state=checked]:text-primary',
                itemTrailingIcon: 'text-primary',
              }"
            />
          </div>
          <div class="field"><div class="date-field-heading"><span>记录日期</span><label class="checkbox-label date-option"><input v-model="undated" type="checkbox">不设日期</label></div><span v-if="undated" class="undated-placeholder">未设日期</span><DatePicker v-else v-model="form.date" label="记录日期" :disabled="busy" :portal="false" /></div>
        </div>
        <EntryDescriptionEditor :model-value="form.description" :entries="entries" :projects="projects" :references="references" :self-id="entry?.id" :disabled="busy" @update:model-value="updateDescription" />
        <section class="entry-assets-section" aria-label="事项附件">
          <div class="section-label"><span><AppIcon name="file" :size="16" />附件 · {{ assetIds.length }} / 50</span></div>
          <div v-if="selectedAssets.length" class="entry-asset-chips"><div v-for="asset in selectedAssets" :key="asset.id" class="entry-asset-chip"><AssetImage v-if="asset.image" :asset="asset" :email="email" /><AppIcon v-else name="file" :size="18" /><span>{{ asset.name }}</span><button type="button" class="icon-button" :aria-label="`移除附件 ${asset.name}`" @click="assetIds = assetIds.filter(id => id !== asset.id)"><AppIcon name="close" :size="14" /></button></div></div>
          <div class="entry-asset-actions"><label class="button secondary asset-upload-button"><AppIcon name="plus" :size="15" />上传并添加<input type="file" multiple aria-label="上传事项附件" :disabled="assetIds.length >= 50" @change="uploadFiles"></label><button type="button" class="button secondary" :aria-expanded="assetPicker" @click="assetPicker = !assetPicker">{{ assetPicker ? '收起素材库' : '从素材库选择' }}</button></div>
          <div v-if="assetPicker" class="entry-asset-picker"><input v-model="assetQuery" type="search" aria-label="搜索可引用素材" placeholder="搜索素材名称"><div class="entry-asset-options"><button v-for="asset in availableAssets" :key="asset.id" type="button" :disabled="assetIds.length >= 50" @click="assetIds.push(asset.id)"><AppIcon :name="asset.image ? 'grid' : 'file'" :size="16" /><span>{{ asset.name }}</span></button><p v-if="!availableAssets.length" class="small-empty">暂无可选素材</p></div></div>
          <p class="field-help">上传后的文件保存在素材库；取消编辑不会删除已上传的素材。</p>
        </section>
        <section v-if="legacy.length" class="legacy-references">
          <div class="section-label"><span><AppIcon name="link" :size="16" />已有引用</span></div>
          <p class="field-help">这些引用尚未写入描述，可单独移除。</p>
          <div class="reference-group"><button v-for="id in legacy" :key="id" type="button" class="reference-chip" :aria-label="`移除引用 @${entryMap.get(id)?.title || '事项已删除'}`" @click="legacy = legacy.filter(value => value !== id)">@{{ entryMap.get(id)?.title || '事项已删除' }}<AppIcon name="close" :size="12" /></button></div>
        </section>
        <div v-if="incoming.length" class="backlinks-note"><AppIcon name="link" :size="15" /><span>被 {{ incoming.length }} 个事项引用：{{ incoming.map(item => `@${item.title}`).join('、') }}</span></div>
        <div v-if="confirming" class="delete-confirm"><p>确定删除这个事项？其他事项中指向它的引用也会移除。</p><button type="button" class="button danger" @click="remove">确认删除事项</button><button type="button" class="button ghost" @click="confirming = false">取消</button></div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <footer class="form-footer entry-form-footer">
          <div class="entry-footer-settings" role="group" aria-label="事项操作">
            <button type="button" class="icon-button completion-field" :aria-label="form.completed ? '标为未完成' : '标为完成'" :title="form.completed ? '已完成 · 点击标为未完成' : '未完成 · 点击标为完成'" :aria-pressed="form.completed" @click="form.completed = !form.completed"><AppIcon :name="form.completed ? 'circleCheck' : 'circle'" :size="20" /></button>
            <button v-if="entry && !confirming" type="button" class="icon-button" aria-label="导出已保存事项" title="导出已保存事项" @click="emit('export', entry)"><AppIcon name="print" :size="18" /></button>
            <button v-if="entry && !confirming" type="button" class="icon-button danger-text" aria-label="删除事项" title="删除事项" @click="confirming = true"><AppIcon name="trash" /></button>
          </div>
          <div class="entry-footer-actions">
            <button type="button" class="button ghost" @click="emit('close')">取消</button>
            <button class="button primary" type="submit">{{ busy ? '保存中…' : uploading ? '上传中…' : entry ? '保存' : '添加事项' }}</button>
          </div>
        </footer>
      </fieldset>
    </form>
  </AppDialog>
</template>
