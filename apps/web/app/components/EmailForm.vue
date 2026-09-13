<script setup lang="ts">
const props = defineProps<{ initial?: string }>()
const emit = defineEmits<{ submit: [email: string] }>()
const value = ref(props.initial || '')
</script>

<template>
  <form class="email-form" @submit.prevent="emit('submit', value.trim().toLowerCase())">
    <label class="field">邮箱地址<div class="email-input"><AppIcon name="mail" :size="19" /><input v-model="value" type="email" required maxlength="254" pattern="[^\s@]+@[^\s@]+\.[^\s@]+" autocomplete="email" placeholder="you@example.com" autofocus></div></label>
    <p class="field-help">同一个邮箱，同一份记录。当前无需密码或验证码。</p>
    <button class="button primary" type="submit">{{ initial ? '切换数据空间' : '进入我的日历' }}<AppIcon name="arrow" :size="18" /></button>
  </form>
</template>
