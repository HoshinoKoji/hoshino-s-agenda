<script setup lang="ts">
import type { Entry } from '../../../../shared/types'

const props = defineProps<{ entry: Entry }>()
const emit = defineEmits<{ unlocked: [] }>()
const encryption = useEntryEncryption()
const password = ref('')
const busy = ref(false)
const error = ref('')
const id = useId()
let disposed = false
onUnmounted(() => { disposed = true; password.value = '' })
async function unlock() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const value = password.value
  password.value = ''
  try {
    await encryption.unlock(props.entry, value)
    if (!disposed) emit('unlocked')
  } catch (cause) { if (!disposed) error.value = (cause as Error).message }
  finally { busy.value = false }
}
</script>

<template>
  <div class="description-unlock">
    <p class="description-lock-label"><AppIcon name="lock" :size="15" />描述已加密</p>
    <div class="description-unlock-actions">
      <label class="field" :for="id">解锁密码<input :id="id" v-model="password" type="password" autocomplete="off" maxlength="256" :disabled="busy" @keydown.enter.prevent="unlock"></label>
      <button type="button" class="button secondary" :disabled="busy || !password" @click="unlock">{{ busy ? '解锁中…' : '解锁描述' }}</button>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </div>
</template>
