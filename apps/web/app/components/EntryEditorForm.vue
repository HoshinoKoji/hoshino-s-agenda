<script setup lang="ts">
import { DESCRIPTION_MAX_LENGTH, type Asset, type Entry, type EntryInput, type EntryRemoveOptions, type EntrySaveResult, type Project, type RecurrenceFrequency, type RecurrenceRule, type RecurrenceScope } from '../../../../shared/types'
import { expandRecurrence, RECURRENCE_LABELS, type RecurrenceAdjustment } from '../../../../shared/recurrence'
import { descriptionReferences, legacyReferenceIds, MAX_ENTRY_REFERENCES, mentionIds } from '../../../../shared/mentions'
import { dateKey } from '~/utils/dates'
import { encryptDescription, encryptDescriptionWithKey, encryptProjectDescription, validateEncryptionPassword } from '../../../../shared/encryption'
const props = defineProps<{
  entry?: Entry
  copySource?: Entry
  date: string | null
  projectId: string
  projects: Project[]
  entries: Entry[]
  assets: Asset[]
  email: string
  upload: (file: File) => Promise<Asset>
  submit: (data: EntryInput, id?: string, onSaved?: (result: EntrySaveResult) => void) => Promise<void>
  remove: (id: string, options?: EntryRemoveOptions) => Promise<void>
  saveDisabled?: boolean
  disabled?: boolean
  cancelLabel?: string
}>()
const emit = defineEmits<{ close: []; saved: []; removed: []; export: [entry: Entry]; copy: [entry: Entry]; 'update:dirty': [value: boolean]; 'update:busy': [value: boolean] }>()
const encryption = useEntryEncryption()
let disposed = false
const seed = props.entry ?? props.copySource
const initialEncrypted = seed?.encryptedDescription
const initialDescription = seed ? encryption.description(seed) : ''
const descriptionReady = ref(initialDescription !== undefined)
const locked = computed(() => !!initialEncrypted && !descriptionReady.value)
const encrypted = ref(!!initialEncrypted)
const changingPassword = ref(false)
const password = ref('')
const confirmPassword = ref('')
const initialDate = seed ? seed.date : props.date
const undated = ref(initialDate === null)
const form = reactive<Omit<EntryInput, 'references' | 'date'> & { description: string; date: string }>({
  title: seed?.title || '',
  description: initialDescription ?? '',
  date: initialDate ?? dateKey(new Date()),
  projectId: seed?.projectId || props.projectId || props.projects[0]?.id || '',
  completed: props.entry?.completed || false,
})
const targetProject = computed(() => props.projects.find(project => project.id === form.projectId))
const targetLocked = computed(() => !!targetProject.value?.encryption && !encryption.getProject(targetProject.value))
const effectiveEncrypted = computed(() => !!targetProject.value?.encryption || encrypted.value)
const requiresIndependentPassword = computed(() => !initialEncrypted || initialEncrypted.version === 2 || changingPassword.value)
const selectedDate = computed<string | null>({
  get: () => undated.value ? null : form.date,
  set: value => { undated.value = value === null; if (value !== null) form.date = value },
})
const legacy = ref(seed && descriptionReady.value ? legacyReferenceIds({ ...seed, description: form.description }) : [])
const busy = ref(false)
const uploading = ref(false)
const assetIds = ref<string[]>([...(seed?.assetIds || [])])
const requestId = crypto.randomUUID()
let creationSeal: { fingerprint: string; encryptedDescription: EntryInput['encryptedDescription']; key?: CryptoKey } | undefined
const scope = ref<RecurrenceScope>('single')
const frequency = ref<RecurrenceFrequency | ''>(props.entry?.recurrence?.rule.frequency ?? '')
const until = ref(props.entry?.recurrence?.rule.until ?? '')
const singleInstance = computed(() => !!props.entry?.recurrence && scope.value === 'single')
const recurrence = computed<RecurrenceRule | null>(() => {
  if (!frequency.value) return null
  if (singleInstance.value) return props.entry!.recurrence!.rule
  const rule: RecurrenceRule = { frequency: frequency.value, startDate: form.date, until: until.value }
  const original = props.entry?.recurrence
  if (original && frequency.value === original.rule.frequency && ['monthly', 'yearly'].includes(frequency.value) &&
    form.date === (scope.value === 'all' ? original.rule.startDate : original.scheduledDate)) {
    rule.anchorDate = original.rule.anchorDate ?? original.rule.startDate
  }
  return rule
})
const preview = computed(() => {
  if (!recurrence.value || undated.value && !singleInstance.value) return undefined
  try { return { ...expandRecurrence(recurrence.value), error: '' } }
  catch (cause) { return { dates: [], adjustments: [], error: (cause as Error).message } }
})
const dateConfirmation = shallowRef<{ adjustments: RecurrenceAdjustment[]; count: number; resolve: (confirmed: boolean) => void }>()
const fieldsDisabled = computed(() => busy.value || uploading.value || props.disabled || !!dateConfirmation.value)
function closeDateConfirmation(confirmed: boolean) {
  const pending = dateConfirmation.value
  dateConfirmation.value = undefined
  pending?.resolve(confirmed)
}
watch(scope, value => {
  const repeat = props.entry?.recurrence
  if (!repeat) return
  form.date = value === 'all' ? repeat.rule.startDate : value === 'following' ? repeat.scheduledDate : props.entry!.date ?? repeat.scheduledDate
  undated.value = value === 'single' && props.entry!.date === null
})
watch(frequency, value => { if (value && !singleInstance.value) undated.value = false })
const assetQuery = ref('')
const assetPicker = ref(false)
const selectedAssets = computed(() => assetIds.value.map(id => props.assets.find(asset => asset.id === id)).filter((asset): asset is Asset => !!asset))
const availableAssets = computed(() => props.assets.filter(asset => !assetIds.value.includes(asset.id) && asset.name.toLocaleLowerCase().includes(assetQuery.value.toLocaleLowerCase())))
const error = ref('')
const confirming = ref(false)
const entryMap = computed(() => new Map(props.entries.map(entry => [entry.id, entry])))
const references = computed(() => locked.value
  ? (seed?.references || []).filter(id => props.entries.some(entry => entry.id === id))
  : descriptionReferences(form.description, props.entries, props.entry?.id, legacy.value))
const incoming = computed(() => props.entries.filter(entry => props.entry && entry.id !== props.entry.id && entry.references.includes(props.entry.id)))
const projectItems = computed(() => props.projects.map(project => ({ label: project.name, value: project.id })))
const frequencyItems: { label: string; value: RecurrenceFrequency | '' }[] = [
  { label: '不重复', value: '' },
  ...Object.entries(RECURRENCE_LABELS).map(([value, label]) => ({ label, value: value as RecurrenceFrequency })),
]
const scopeItems: { label: string; value: RecurrenceScope }[] = [
  { label: '仅本次', value: 'single' }, { label: '本次及以后', value: 'following' }, { label: '整个系列', value: 'all' },
]
const rangeMembers = computed(() => props.entry?.recurrence && scope.value !== 'single'
  ? props.entries.filter(entry => entry.recurrence?.seriesId === props.entry!.recurrence!.seriesId &&
    (scope.value === 'all' || entry.recurrence.scheduledDate >= props.entry!.recurrence!.scheduledDate) && (!entry.recurrence.exception || entry.id === props.entry!.id)) : [])
const rangeProjects = computed(() => form.projectId !== seed?.projectId ? [] : props.projects.filter(project => project.id !== form.projectId && rangeMembers.value.some(entry => entry.projectId === project.id)))
const rangePasswordEntries = computed(() => targetProject.value?.encryption ? rangeProjects.value.filter(project => !project.encryption)
  .map(project => rangeMembers.value.find(entry => entry.projectId === project.id && entry.encryptedDescription?.version === 1))
  .filter((entry): entry is Entry => !!entry) : [])
function snapshot() {
  return {
    title: form.title, description: locked.value ? '' : form.description, projectId: form.projectId,
    date: undated.value ? null : form.date, completed: form.completed,
    references: [...references.value].sort(), assetIds: [...assetIds.value].sort(),
    encrypted: encrypted.value, changingPassword: changingPassword.value,
    password: password.value, confirmPassword: confirmPassword.value,
    frequency: frequency.value, until: until.value, scope: scope.value,
    projectEncryption: targetProject.value?.encryption,
  }
}
const baseline = ref(snapshot())
watch(() => JSON.stringify(snapshot()) !== JSON.stringify(baseline.value), value => emit('update:dirty', value), { immediate: true })
watch(() => busy.value || uploading.value || !!dateConfirmation.value, value => emit('update:busy', value), { immediate: true, flush: 'sync' })
function updateDescription(value: string) {
  form.description = value
  // Once explicitly inserted into the description, deletion of that marker removes the relation too.
  const inline = new Set(mentionIds(value))
  legacy.value = legacy.value.filter(id => !inline.has(id))
}
function unlocked() {
  if (!seed) return
  const description = encryption.description(seed)
  if (description === undefined) return
  form.description = description
  legacy.value = legacyReferenceIds({ ...seed, description })
  descriptionReady.value = true
  // Unlocking reveals the saved body; it is not an edit, even after metadata edits.
  baseline.value.description = description
  baseline.value.references = [...references.value].sort()
}
watch(() => seed && encryption.description(seed), () => { if (locked.value) unlocked() })
watch(() => seed?.encryptedDescription?.version === 2 ? encryption.description(seed) : undefined, value => {
  if (seed?.encryptedDescription?.version === 2 && value === undefined && descriptionReady.value) {
    form.description = ''; descriptionReady.value = false
  }
})
watch([encrypted, changingPassword], () => {
  if (!encrypted.value || (initialEncrypted && !changingPassword.value)) {
    password.value = ''
    confirmPassword.value = ''
  }
})
onUnmounted(() => { disposed = true; closeDateConfirmation(false); creationSeal = undefined; form.description = ''; password.value = ''; confirmPassword.value = '' })
async function save() {
  if (busy.value || uploading.value || dateConfirmation.value || props.saveDisabled || props.disabled) return
  if (form.description.length > DESCRIPTION_MAX_LENGTH) { error.value = `描述不能超过 ${DESCRIPTION_MAX_LENGTH} 字符。`; return }
  if (references.value.length > MAX_ENTRY_REFERENCES) { error.value = '最多引用 50 个不同事项，请移除多余引用后保存。'; return }
  let acknowledgeAdjustments = false
  if (recurrence.value && !singleInstance.value) {
    if (undated.value) { error.value = '重复事项必须设置开始日期。'; return }
    if (preview.value?.error) { error.value = preview.value.error; return }
    if (preview.value?.adjustments.length) {
      acknowledgeAdjustments = await new Promise<boolean>(resolve => {
        dateConfirmation.value = { adjustments: preview.value!.adjustments, count: preview.value!.dates.length, resolve }
      })
      if (!acknowledgeAdjustments || disposed || props.saveDisabled || props.disabled) return
    }
  }
  busy.value = true
  error.value = ''
  const retention = encryption.prepareSave(props.entry)
  const description = form.description
  const fingerprint = JSON.stringify(snapshot())
  try {
    let encryptedDescription = locked.value ? initialEncrypted : null
    let key: CryptoKey | undefined
    const target = targetProject.value
    const savedDescription = seed ? encryption.description(seed) : ''
    if (!target) throw new Error('所属项目不存在，请同步后重新打开')
    if (locked.value && (initialEncrypted?.version === 2 ? target.id !== initialEncrypted.projectId : !!target.encryption)) {
      throw new Error('跨项目转换前请先解锁原描述')
    }
    if (!props.entry && effectiveEncrypted.value && creationSeal?.fingerprint === fingerprint) {
      encryptedDescription = creationSeal.encryptedDescription
      key = creationSeal.key
    } else if (target.encryption && !locked.value) {
      const secret = encryption.getProject(target)
      if (!secret) throw new Error('请先解锁目标项目，再保存描述')
      key = secret.key
      encryptedDescription = initialEncrypted?.version === 2 && initialEncrypted.projectId === target.id && initialEncrypted.keyId === target.encryption.keyId &&
        description === savedDescription && !props.copySource ? initialEncrypted
        : await encryptProjectDescription(description, key, target.id, target.encryption.keyId)
    } else if (encrypted.value && !locked.value) {
      if (requiresIndependentPassword.value) {
        validateEncryptionPassword(password.value)
        if (password.value !== confirmPassword.value) throw new Error('两次输入的加密密码不一致')
        const sealed = await encryptDescription(description, password.value)
        encryptedDescription = sealed.encryptedDescription
        key = sealed.key
      } else {
        const secret = seed && encryption.get(seed)
        if (!secret) throw new Error('描述已重新锁定，请关闭编辑器后重新解锁')
        key = secret.key
        if (initialEncrypted?.version !== 1) throw new Error('请设置独立加密密码')
        encryptedDescription = description === secret.description && !props.copySource ? initialEncrypted
          : await encryptDescriptionWithKey(description, key, initialEncrypted.salt)
      }
    }
    const projectDescriptions: EntryInput['projectDescriptions'] = {}
    const changingBody = JSON.stringify(encryptedDescription ?? null) !== JSON.stringify(initialEncrypted ?? null) || (!encryptedDescription && description !== savedDescription)
    if (!locked.value && (changingBody || form.projectId !== seed?.projectId) && rangeMembers.value.length) {
      const ids = new Set(rangeMembers.value.map(entry => form.projectId !== seed?.projectId ? form.projectId : entry.projectId))
      for (const id of ids) {
        const project = props.projects.find(item => item.id === id)!
        if (id === target.id) { projectDescriptions[id] = { description: encryptedDescription ? '' : description, encryptedDescription: encryptedDescription ?? null }; continue }
        if (project.encryption) {
          const secret = encryption.getProject(project)
          if (!secret) throw new Error(`请先解锁项目「${project.name}」，再批量修改描述`)
          projectDescriptions[id] = { description: '', encryptedDescription: await encryptProjectDescription(description, secret.key, id, project.encryption.keyId) }
        } else if (target.encryption) {
          const source = rangePasswordEntries.value.find(entry => entry.projectId === id)
          const secret = source && encryption.get(source)
          if (source?.encryptedDescription?.version === 1) {
            if (!secret) throw new Error(`请先解锁「${source.title}」的独立描述，再批量修改`)
            projectDescriptions[id] = { description: '', encryptedDescription: await encryptDescriptionWithKey(description, secret.key, source.encryptedDescription.salt) }
          } else projectDescriptions[id] = { description, encryptedDescription: null }
        } else projectDescriptions[id] = { description: encryptedDescription ? '' : description, encryptedDescription: encryptedDescription ?? null }
      }
    }
    // Preserve the exact ciphertext across an ambiguous creation retry (new IVs
    // would make the server's stable request ID appear to contain different data).
    if (!props.entry && effectiveEncrypted.value) creationSeal = { fingerprint, encryptedDescription, key }
    if (key && target.encryption && encryption.getProject(target)?.key !== key) throw new Error('项目已重新锁定，请重新解锁后保存')
    if (disposed || !retention.isCurrent()) throw new Error('事项或空间已变化，请重新打开后保存')
    const snapshot = encryptedDescription && key ? { encryptedDescription, description, key } : undefined
    await props.submit({ ...form, description: encryptedDescription ? '' : description,
      encryptedDescription: encryptedDescription ?? null, date: undated.value ? null : form.date,
      references: [...references.value], assetIds: [...assetIds.value],
      ...(Object.keys(projectDescriptions).length ? { projectDescriptions } : {}),
      ...(!props.entry ? { requestId } : {}),
      ...(!singleInstance.value ? { recurrence: recurrence.value, acknowledgeAdjustments } : {}),
      ...(props.entry?.recurrence ? { scope: scope.value, seriesVersion: props.entry.recurrence.version } : {}) }, props.entry?.id,
      snapshot ? result => retention.confirm(result, snapshot) : undefined)
    if (!disposed) emit('saved')
  }
  catch (cause) { if (!disposed) error.value = (cause as Error).message }
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
  if (!props.entry || busy.value || uploading.value || props.saveDisabled) return
  busy.value = true
  error.value = ''
  try { await props.remove(props.entry.id, props.entry.recurrence ? { scope: scope.value, seriesVersion: props.entry.recurrence.version } : undefined); if (!disposed) emit('removed') }
  catch (cause) { if (!disposed) error.value = (cause as Error).message }
  finally { busy.value = false }
}
</script>

<template>
    <form @submit.prevent="save">
      <fieldset :disabled="fieldsDisabled" class="form-fields">
        <p v-if="copySource" class="field-help copy-source-note">正在复制已保存事项，保存后创建独立的新事项。</p>
        <div class="entry-fields-row">
          <label class="field">事项标题<input v-model="form.title" required maxlength="200" placeholder="今天，想推进哪件小事？" autofocus></label>
          <FormSelect v-model="form.projectId" label="所属项目" :items="projectItems" :disabled="fieldsDisabled" required />
        </div>
        <FormSelect v-if="entry?.recurrence" v-model="scope" label="修改／删除范围" :items="scopeItems" :disabled="fieldsDisabled" />
        <section class="recurrence-settings" aria-label="重复设置">
          <div class="entry-fields-row">
            <div class="field"><span>{{ entry?.recurrence && scope !== 'single' ? '开始日期' : '记录日期' }}</span><DatePicker v-model="selectedDate" label="记录日期" :disabled="fieldsDisabled" :clearable="!frequency || singleInstance" :default-date="form.date" /></div>
            <FormSelect v-model="frequency" label="重复" :items="frequencyItems" :disabled="fieldsDisabled || singleInstance" />
            <div v-if="frequency" class="field"><span>截止日期</span><DatePicker v-model="until" label="截止日期" placeholder="选择截止日期" :min="singleInstance ? entry?.recurrence?.rule.startDate : form.date" :default-date="form.date" :required="!singleInstance" :disabled="fieldsDisabled || singleInstance" /></div>
          </div>
          <p v-if="singleInstance" class="field-help">本次原始排期：{{ entry?.recurrence?.scheduledDate }}。单次修改不会改变重复规则。</p>
          <template v-else-if="preview"><p v-if="preview.error" class="field-help danger-text">{{ preview.error }}</p><p v-else class="field-help">预计安排 {{ preview.dates.length }} 次：{{ preview.dates.slice(0, 3).join('、') }}{{ preview.dates.length > 3 ? '…' : '' }}<span v-if="preview.adjustments.length">；{{ preview.adjustments.length }} 次使用当月最后一天，保存时需确认。</span></p></template>
          <p v-if="entry?.recurrence && scope !== 'single'" class="field-help">批量编辑保留各次完成状态与其他单次例外；更改规则时，不再符合排期的已完成或单次调整记录会保留为独立事项。</p>
        </section>
        <section class="description-security" aria-label="描述加密设置">
          <template v-if="targetProject?.encryption"><p class="field-help">此项目的描述统一使用项目口令加密。</p><ProjectUnlock v-if="!locked || initialEncrypted?.version !== 2 || initialEncrypted.projectId !== targetProject.id" :project="targetProject" /></template>
          <label v-else class="checkbox-label"><input v-model="encrypted" type="checkbox" :disabled="locked">加密描述</label>
          <p class="field-help">仅加密描述正文；标题、项目、日期、状态、引用关系和附件仍可见。密码和解密内容仅留在当前页面内存中。</p>
          <template v-if="!locked && encrypted && !targetProject?.encryption">
            <button v-if="initialEncrypted?.version === 1" type="button" class="text-button" :aria-expanded="changingPassword" @click="changingPassword = !changingPassword">{{ changingPassword ? '取消更改密码' : '更改加密密码' }}</button>
            <div v-if="requiresIndependentPassword" class="field-row encryption-passwords">
              <label class="field">加密密码<input v-model="password" type="password" autocomplete="new-password" maxlength="256" placeholder="8–256 个字符"></label>
              <label class="field">确认加密密码<input v-model="confirmPassword" type="password" autocomplete="new-password" maxlength="256"></label>
            </div>
            <p v-if="requiresIndependentPassword" class="field-help">请记住此事项的独立密码，忘记后无法恢复描述。成功保存并同步后保持解锁；刷新、切换邮箱或主动锁定后需重新输入口令。</p>
          </template>
          <EntryUnlock v-if="locked && seed" :entry="seed" @unlocked="unlocked" />
          <p v-if="locked" class="field-help">可直接修改其他字段，原密文和引用会保留；修改描述、更改密码或取消加密前请先解锁。</p>
        </section>
        <section v-if="rangeProjects.some(project => project.encryption) || rangePasswordEntries.length" class="description-security" aria-label="批量修改涉及的项目">
          <p class="field-help">批量修改正文时，请解锁以下项目或独立描述；仅修改其他字段时可保留原密文。</p>
          <ProjectUnlock v-for="project in rangeProjects.filter(item => item.encryption)" :key="project.id" :project="project" />
          <EntryUnlock v-for="entry in rangePasswordEntries" :key="entry.id" :entry="entry" />
        </section>
        <EntryDescriptionEditor v-if="!locked && !targetLocked" :model-value="form.description" :entries="entries" :projects="projects" :references="references" :self-id="entry?.id" :disabled="busy" @update:model-value="updateDescription" />
        <section class="entry-assets-section" aria-label="事项附件">
          <div class="section-label"><span><AppIcon name="file" :size="16" />附件 · {{ assetIds.length }} / 50</span></div>
          <div v-if="selectedAssets.length" class="entry-asset-chips"><div v-for="asset in selectedAssets" :key="asset.id" class="entry-asset-chip"><AssetImage v-if="asset.image" :asset="asset" :email="email" /><AppIcon v-else name="file" :size="18" /><span>{{ asset.name }}</span><button type="button" class="icon-button" :aria-label="`移除附件 ${asset.name}`" @click="assetIds = assetIds.filter(id => id !== asset.id)"><AppIcon name="close" :size="14" /></button></div></div>
          <div class="entry-asset-actions"><label class="button secondary asset-upload-button"><AppIcon name="plus" :size="15" />上传并添加<input type="file" multiple aria-label="上传事项附件" :disabled="assetIds.length >= 50" @change="uploadFiles"></label><button type="button" class="button secondary" :aria-expanded="assetPicker" @click="assetPicker = !assetPicker">{{ assetPicker ? '收起素材库' : '从素材库选择' }}</button></div>
          <div v-if="assetPicker" class="entry-asset-picker"><input v-model="assetQuery" type="search" aria-label="搜索可引用素材" placeholder="搜索素材名称"><div class="entry-asset-options"><AssetPickerOption v-for="asset in availableAssets" :key="asset.id" :asset="asset" :email="email" :disabled="assetIds.length >= 50" @select="assetIds.push(asset.id)" /><p v-if="!availableAssets.length" class="small-empty">暂无可选素材</p></div></div>
          <p class="field-help">上传后的文件保存在素材库；取消编辑不会删除已上传的素材。</p>
        </section>
        <section v-if="!locked && legacy.length" class="legacy-references">
          <div class="section-label"><span><AppIcon name="link" :size="16" />已有引用</span></div>
          <p class="field-help">这些引用尚未写入描述，可单独移除。</p>
          <div class="reference-group"><button v-for="id in legacy" :key="id" type="button" class="reference-chip" :aria-label="`移除引用 @${entryMap.get(id)?.title || '事项已删除'}`" @click="legacy = legacy.filter(value => value !== id)">@{{ entryMap.get(id)?.title || '事项已删除' }}<AppIcon name="close" :size="12" /></button></div>
        </section>
        <div v-if="incoming.length" class="backlinks-note"><AppIcon name="link" :size="15" /><span>被 {{ incoming.length }} 个事项引用：{{ incoming.map(item => `@${item.title}`).join('、') }}</span></div>
        <div v-if="confirming" class="delete-confirm"><p>确定删除{{ entry?.recurrence && scope === 'all' ? '整个重复系列' : entry?.recurrence && scope === 'following' ? '本次及以后的事项' : '这个事项' }}？其他事项中指向它们的引用也会移除。</p><button type="button" class="button danger" :disabled="saveDisabled" @click="remove">确认删除事项</button><button type="button" class="button ghost" @click="confirming = false">取消</button></div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <footer class="form-footer entry-form-footer">
          <div class="entry-footer-settings" role="group" aria-label="事项操作">
            <button type="button" class="icon-button completion-field" :aria-label="form.completed ? '标为未完成' : '标为完成'" :title="form.completed ? '已完成 · 点击标为未完成' : '未完成 · 点击标为完成'" :aria-pressed="form.completed" @click="form.completed = !form.completed"><AppIcon :name="form.completed ? 'circleCheck' : 'circle'" :size="20" /></button>
            <button v-if="entry && !confirming" type="button" class="icon-button" aria-label="导出已保存事项" title="导出已保存事项" @click="emit('export', entry)"><AppIcon name="print" :size="18" /></button>
            <button v-if="entry && !confirming" type="button" class="icon-button" aria-label="复制已保存事项" title="复制已保存事项" @click="emit('copy', entry)"><AppIcon name="copy" :size="18" /></button>
            <button v-if="entry && !confirming" type="button" class="icon-button danger-text" aria-label="删除事项" title="删除事项" @click="confirming = true"><AppIcon name="trash" /></button>
          </div>
          <div class="entry-footer-actions">
            <button type="button" class="button ghost" @click="emit('close')">{{ cancelLabel || '取消' }}</button>
            <button class="button primary" type="submit" :disabled="saveDisabled">{{ busy ? '保存中…' : uploading ? '上传中…' : entry ? '保存' : '添加事项' }}</button>
          </div>
        </footer>
      </fieldset>
    </form>
    <RecurrenceDateConfirm v-if="dateConfirmation" :adjustments="dateConfirmation.adjustments" :count="dateConfirmation.count" @confirm="closeDateConfirmation(true)" @cancel="closeDateConfirmation(false)" />
</template>
