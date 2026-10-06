<script setup lang="ts">
import { PROJECT_COLORS, type Entry, type Project, type ProjectDescriptionChange, type ProjectEncryptionChange, type ProjectInput } from '../../../../shared/types'
import { createProjectEncryption, rewrapProjectEncryption, unlockProjectEncryption } from '../../../../shared/projectEncryption'
import { encryptProjectDescription, validateEncryptionPassword } from '../../../../shared/encryption'
const props = defineProps<{
  project?: Project
  submit: (data: ProjectInput, id?: string, onSaved?: (project: Project) => void) => Promise<void>
  remove: (id: string) => Promise<void>
  entryCount: number
  projects: Project[]
  entries: Entry[]
  changeEncryption: (id: string, change: ProjectEncryptionChange, rows: ProjectDescriptionChange[], onSaved?: () => void) => Promise<void>
  cancelConversion: (id: string, jobId: string) => Promise<unknown>
}>()
const emit = defineEmits<{ close: [] }>()
const name = ref(props.project?.name || '')
const channels = ['R', 'G', 'B'] as const
const rgb = ref<(number | string)[]>([])
const color = computed({
  get: () => `#${rgb.value.map(value => Math.max(0, Math.min(255, Number(value) || 0)).toString(16).padStart(2, '0')).join('')}`.toUpperCase(),
  set: (value: string) => { rgb.value = [1, 3, 5].map(start => Number.parseInt(value.slice(start, start + 2), 16)) },
})
color.value = props.project?.color || PROJECT_COLORS[0]
const busy = ref(false)
const error = ref('')
const confirming = ref(false)
const encryption = useEntryEncryption()
const currentProject = computed(() => props.projects.find(project => project.id === props.project?.id) ?? props.project)
const enabled = ref(!!props.project?.encryption)
const changingPassword = ref(false)
const password = ref('')
const confirmPassword = ref('')
const oldPassword = ref('')
const status = ref('')
const requestId = crypto.randomUUID()
const initialConfig = JSON.stringify(props.project?.encryption)
const projectEntries = computed(() => props.entries.filter(entry => entry.projectId === props.project?.id))
const pendingLocked = computed(() => projectEntries.value.filter(entry => encryption.description(entry) === undefined))
let disposed = false
let acknowledged = false
let prepared: { fingerprint: string; change: ProjectEncryptionChange; rows: ProjectDescriptionChange[]; key?: CryptoKey } | undefined
let newSeal: Awaited<ReturnType<typeof createProjectEncryption>> | undefined
let newSealPassword = ''
async function resetConversion() {
  const pending = prepared
  prepared = undefined
  error.value = ''
  if (pending && props.project) await props.cancelConversion(props.project.id, pending.change.requestId).catch(() => {})
}
onUnmounted(() => {
  disposed = true
  if (prepared && props.project) void props.cancelConversion(props.project.id, prepared.change.requestId).catch(() => {})
  prepared = undefined; newSeal = undefined; newSealPassword = ''
  password.value = ''; confirmPassword.value = ''; oldPassword.value = ''
})
async function save() {
  if (busy.value) return
  if (rgb.value.some(value => value === '' || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 255)) {
    error.value = 'RGB 色值须为 0–255 的整数。'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const project = currentProject.value
    const changing = enabled.value !== !!props.project?.encryption || (enabled.value && changingPassword.value)
    if (changing && enabled.value) {
      validateEncryptionPassword(password.value)
      if (password.value !== confirmPassword.value) throw new Error('两次输入的项目口令不一致')
    }
    if (!props.project) {
      if (enabled.value && (!newSeal || newSealPassword !== password.value)) {
        newSeal = await createProjectEncryption(requestId, password.value)
        newSealPassword = password.value
      }
      if (disposed) return
      await props.submit({ name: name.value, color: color.value, requestId, ...(enabled.value ? { encryption: newSeal!.encryption } : {}) }, undefined,
        saved => { if (!disposed && enabled.value && newSeal && saved.id === requestId) encryption.retainProject(saved.id, newSeal.encryption, newSeal.key) })
    } else {
      if (changing) {
        if (!project || (!acknowledged && JSON.stringify(project.encryption) !== initialConfig)) throw new Error('项目加密设置已变化，请重新打开项目')
        const fingerprint = JSON.stringify([enabled.value, changingPassword.value, password.value, confirmPassword.value, oldPassword.value])
        if (prepared && prepared.fingerprint !== fingerprint) await resetConversion()
        if (!prepared) {
          const rewrap = !!project.encryption && enabled.value && changingPassword.value
          if (!rewrap && pendingLocked.value.length) throw new Error('请先解锁下方所有已加密描述，再统一转换')
          const change: ProjectEncryptionChange = { requestId: crypto.randomUUID(), expectedRevision: project.encryptionRevision ?? 0, encryption: null, rewrap }
          let key: CryptoKey | undefined
          if (rewrap) {
            change.encryption = await rewrapProjectEncryption(project.id, project.encryption!, oldPassword.value, password.value)
            key = await unlockProjectEncryption(project.id, change.encryption, password.value)
          } else if (enabled.value) {
            const sealed = await createProjectEncryption(project.id, password.value)
            change.encryption = sealed.encryption; key = sealed.key
          }
          const rows: ProjectDescriptionChange[] = []
          if (!rewrap) {
            const snapshot = [...projectEntries.value]
            for (const [index, entry] of snapshot.entries()) {
              status.value = `正在准备描述 ${index + 1} / ${snapshot.length}…`
              const description = encryption.description(entry)
              if (description === undefined) throw new Error('描述已重新锁定，请重新解锁')
              rows.push({ id: entry.id, description: enabled.value ? '' : description,
                encryptedDescription: enabled.value ? await encryptProjectDescription(description, key!, project.id, change.encryption!.keyId) : null })
              if (disposed) return
            }
          }
          prepared = { fingerprint, change, rows, key }
        }
        if (disposed) return
        status.value = '正在上传并确认项目描述转换…'
        const pending = prepared
        await props.changeEncryption(project.id, pending.change, pending.rows, () => {
          acknowledged = true
          if (!disposed && pending.change.encryption && pending.key) encryption.retainProject(project.id, pending.change.encryption, pending.key)
        })
      }
      if (disposed) return
      await props.submit({ name: name.value, color: color.value }, props.project.id)
    }
    if (!disposed) emit('close')
  }
  catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false; status.value = '' }
}
async function remove() {
  if (!props.project) return
  busy.value = true
  error.value = ''
  try { await props.remove(props.project.id); emit('close') }
  catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false }
}
</script>

<template>
  <AppDialog :title="project ? '编辑项目' : '创建项目'" :busy="busy" @close="emit('close')">
    <form @submit.prevent="save">
      <fieldset :disabled="busy" class="form-fields">
        <label class="field">项目名称<input v-model="name" required maxlength="64" placeholder="例如：个人网站、阅读计划…" autofocus></label>
        <div class="field"><span id="color-label">项目颜色</span><div class="color-options" role="group" aria-labelledby="color-label">
          <button v-for="(option, index) in PROJECT_COLORS" :key="option" type="button" :style="{ background: option }" :aria-label="`颜色 ${index + 1}`" :aria-pressed="color === option.toUpperCase()" @click="color = option"><AppIcon v-if="color === option.toUpperCase()" name="check" /></button>
        </div></div>
        <div class="rgb-fields" role="group" aria-label="自定义 RGB 颜色">
          <div class="color-preview" :style="{ background: color }" :title="color" aria-label="颜色预览" />
          <label v-for="(channel, index) in channels" :key="channel" class="field">{{ channel }}<input v-model.number="rgb[index]" type="number" min="0" max="255" step="1" required :aria-label="`RGB ${channel}`"></label>
        </div>
        <section class="description-security" aria-label="项目描述加密设置">
          <label class="checkbox-label"><input v-model="enabled" type="checkbox">项目描述加密</label>
          <p class="field-help">一个项目口令解锁全部事项描述。标题、日期、状态、引用关系和附件仍可见。</p>
          <template v-if="currentProject?.encryption">
            <ProjectUnlock :project="currentProject" />
            <button v-if="enabled" type="button" class="text-button" @click="changingPassword = !changingPassword">{{ changingPassword ? '取消修改项目口令' : '修改项目口令' }}</button>
            <label v-if="enabled && changingPassword" class="field">当前项目口令<input v-model="oldPassword" type="password" autocomplete="off" maxlength="256"></label>
          </template>
          <div v-if="enabled && (!project?.encryption || changingPassword)" class="field-row encryption-passwords">
            <label class="field">项目加密口令<input v-model="password" type="password" autocomplete="new-password" maxlength="256" placeholder="8–256 个字符"></label>
            <label class="field">确认项目口令<input v-model="confirmPassword" type="password" autocomplete="new-password" maxlength="256"></label>
          </div>
          <p v-if="enabled && !project?.encryption" class="field-help">保存时将现有描述全部统一为项目加密；请记住口令，忘记后无法恢复正文。</p>
          <p v-if="project?.encryption && !enabled" class="field-help">保存时将此项目的全部描述还原为明文，请先解锁项目。</p>
          <div v-if="enabled && !project?.encryption && pendingLocked.length" class="project-encryption-pending">
            <p class="field-help">以下 {{ pendingLocked.length }} 个描述需先用原独立密码解锁：</p>
            <section v-for="entry in pendingLocked" :key="entry.id"><h4>{{ entry.title }}</h4><EntryUnlock :entry="entry" /></section>
          </div>
          <button v-if="prepared && error" type="button" class="text-button" @click="resetConversion">重新准备转换</button>
        </section>
        <p v-if="status" class="field-help" role="status">{{ status }}</p>
        <div v-if="confirming" class="delete-confirm"><p>确定删除「{{ project?.name }}」及其 {{ entryCount }} 个事项？相关引用也会移除，此操作无法撤销。</p><button type="button" class="button danger" @click="remove">确认删除项目</button><button type="button" class="button ghost" @click="confirming = false">取消</button></div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <footer class="form-footer"><button v-if="project && !confirming" type="button" class="icon-button danger-text" aria-label="删除项目" @click="confirming = true"><AppIcon name="trash" /></button><span class="spacer" /><button type="button" class="button secondary" @click="emit('close')">取消</button><button class="button primary" type="submit">{{ busy ? '保存中…' : project ? '保存项目' : '创建项目' }}<AppIcon v-if="!busy" name="arrow" :size="16" /></button></footer>
      </fieldset>
    </form>
  </AppDialog>
</template>
