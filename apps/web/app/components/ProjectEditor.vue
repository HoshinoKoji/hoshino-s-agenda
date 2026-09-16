<script setup lang="ts">
import { PROJECT_COLORS, type Project, type ProjectInput } from '../../../../shared/types'
const props = defineProps<{
  project?: Project
  submit: (data: ProjectInput, id?: string) => Promise<void>
  remove: (id: string) => Promise<void>
  entryCount: number
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
async function save() {
  if (busy.value) return
  if (rgb.value.some(value => value === '' || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 255)) {
    error.value = 'RGB 色值须为 0–255 的整数。'
    return
  }
  busy.value = true
  error.value = ''
  try { await props.submit({ name: name.value, color: color.value }, props.project?.id); emit('close') }
  catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false }
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
        <div v-if="confirming" class="delete-confirm"><p>确定删除「{{ project?.name }}」及其 {{ entryCount }} 个事项？相关引用也会移除，此操作无法撤销。</p><button type="button" class="button danger" @click="remove">确认删除项目</button><button type="button" class="button ghost" @click="confirming = false">取消</button></div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <footer class="form-footer"><button v-if="project && !confirming" type="button" class="icon-button danger-text" aria-label="删除项目" @click="confirming = true"><AppIcon name="trash" /></button><span class="spacer" /><button type="button" class="button secondary" @click="emit('close')">取消</button><button class="button primary" type="submit">{{ busy ? '保存中…' : project ? '保存项目' : '创建项目' }}<AppIcon v-if="!busy" name="arrow" :size="16" /></button></footer>
      </fieldset>
    </form>
  </AppDialog>
</template>
