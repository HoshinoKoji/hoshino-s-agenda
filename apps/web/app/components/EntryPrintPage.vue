<script setup lang="ts">
import type { Entry, Project } from '../../../../shared/types'
import { legacyReferenceIds } from '../../../../shared/mentions'
import { dateKey } from '~/utils/dates'

const props = defineProps<{
  entryId: string
  email: string
  projects: Project[]
  entries: Entry[]
  loading: boolean
  error: string
  synced: boolean
}>()
const emit = defineEmits<{ retry: []; enter: [email: string] }>()
const entry = computed(() => props.entries.find(item => item.id === props.entryId))
const project = computed(() => props.projects.find(item => item.id === entry.value?.projectId))
const entryMap = computed(() => new Map(props.entries.map(item => [item.id, item])))
const legacy = computed(() => entry.value ? legacyReferenceIds(entry.value).map(id => entryMap.value.get(id)?.title ?? '事项已删除') : [])
const backlinks = computed(() => props.entries.filter(item => item.id !== props.entryId && item.references.includes(props.entryId)))
function printEntry() { window.print() }

useHead({ title: computed(() => entry.value ? `${entry.value.title} · 日迹事项` : '事项打印 · 日迹') })
</script>

<template>
  <main class="print-page">
    <header class="print-toolbar">
      <a href="/" class="button secondary">返回工作台</a>
      <button v-if="entry && project && !error && synced && !loading" class="button primary" @click="printEntry"><AppIcon name="print" :size="17" />打印 / 保存为 PDF</button>
    </header>
    <section v-if="!email" class="print-message">
      <h1>输入邮箱后查看事项</h1>
      <p>打印页需要读取事项所属的数据空间。</p>
      <EmailForm @submit="emit('enter', $event)" />
    </section>
    <section v-else-if="error" class="print-message" role="alert">
      <h1>事项加载失败</h1><p>{{ error }}</p><button class="button secondary" @click="emit('retry')">重试</button>
    </section>
    <section v-else-if="loading || !synced" class="print-message" role="status">正在加载事项…</section>
    <section v-else-if="!entry || !project" class="print-message" role="status"><h1>找不到这个事项</h1><p>事项可能已删除，或不属于当前邮箱。</p></section>
    <article v-else class="print-sheet">
      <header class="print-heading">
        <p class="print-brand">日迹 · 事项记录</p>
        <h1>{{ entry.title }}</h1>
        <p class="print-project"><i class="project-dot" :style="{ background: project.color }" />{{ project.name }}</p>
      </header>
      <dl class="print-meta">
        <div><dt>记录日期</dt><dd>{{ entry.date ?? '未设日期' }}</dd></div>
        <div><dt>状态</dt><dd>{{ entry.completed ? '已完成' : '进行中' }}</dd></div>
        <div><dt>添加日期</dt><dd>{{ dateKey(new Date(entry.createdAt)) }}</dd></div>
      </dl>
      <section v-if="entry.description" class="print-section">
        <h2>描述</h2>
        <div class="entry-description"><EntryMarkdown :entry="entry" :entries="entries" :projects="projects" :interactive="false" /></div>
      </section>
      <section v-if="legacy.length" class="print-section">
        <h2>引用</h2><p class="print-references">{{ legacy.map(title => `@${title}`).join('、') }}</p>
      </section>
      <section v-if="backlinks.length" class="print-section">
        <h2>被引用</h2><p class="print-references">{{ backlinks.map(item => `@${item.title}`).join('、') }}</p>
      </section>
    </article>
  </main>
</template>
