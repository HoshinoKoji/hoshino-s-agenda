<script setup lang="ts">
import type { RecurrenceAdjustment } from '../../../../shared/recurrence'
defineProps<{ adjustments: RecurrenceAdjustment[]; count: number }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <Teleport to="body">
    <AppDialog title="重复日期替代提醒" @close="emit('cancel')">
      <p class="recurrence-confirm-description">有 {{ adjustments.length }} 次排期没有对应日期，将使用该月最后一天。之后仍按原始月日重复。</p>
      <ul class="recurrence-adjustments" aria-label="日期替代明细"><li v-for="item in adjustments" :key="item.requested"><span>{{ item.requested }}（不存在）</span><strong>→ {{ item.actual }}</strong></li></ul>
      <p class="recurrence-confirm-description">此次规则共安排 {{ count }} 次事项。确认后保存；取消会保留当前草稿。</p>
      <footer class="form-footer"><button type="button" class="button secondary" autofocus @click="emit('cancel')">返回修改</button><button type="button" class="button primary" @click="emit('confirm')">确认替代并保存</button></footer>
    </AppDialog>
  </Teleport>
</template>
