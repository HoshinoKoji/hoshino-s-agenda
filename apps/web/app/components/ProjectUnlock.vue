<script setup lang="ts">
import type { Project } from '../../../../shared/types'
const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ unlocked: [] }>()
const encryption = useEntryEncryption()
const password = ref('')
const busy = ref(false)
const error = ref('')
let disposed = false
onUnmounted(() => { disposed = true; password.value = '' })
async function unlock() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const value = password.value
  password.value = ''
  try { await encryption.unlockProject(props.project, value); if (!disposed) emit('unlocked') }
  catch (cause) { if (!disposed) error.value = (cause as Error).message }
  finally { busy.value = false }
}
</script>

<template>
  <div v-if="project.encryption" class="description-unlock">
    <div v-if="encryption.getProject(project)" class="description-lock-label"><AppIcon name="lock" :size="15" /><span>项目描述已解锁</span><button type="button" class="text-button" @click="encryption.lockProject(project.id)">重新锁定项目</button></div>
    <template v-else>
      <p class="description-lock-label"><AppIcon name="lock" :size="15" />项目描述已加密 · {{ project.name }}</p>
      <div class="description-unlock-actions">
        <label class="field">项目解锁口令<input v-model="password" type="password" autocomplete="off" maxlength="256" :disabled="busy" @keydown.enter.prevent="unlock"></label>
        <button type="button" class="button secondary" :disabled="busy || !password" @click="unlock">{{ busy ? '解锁中…' : '解锁项目描述' }}</button>
      </div>
      <p class="field-help">解锁当前页面内此项目的全部描述。</p>
    </template>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </div>
</template>
