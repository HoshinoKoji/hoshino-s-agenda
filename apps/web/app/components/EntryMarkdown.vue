<script lang="ts">
import MarkdownIt from 'markdown-it'
import { computed, defineComponent, h, type PropType, type VNode } from 'vue'
import type { Entry, Project } from '../../../../shared/types'
import { parseDescription } from '../../../../shared/mentions'
import EntryTooltip from './EntryTooltip.vue'

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true })
markdown.inline.ruler.before('link', 'entry_mention', (state, silent) => {
  const position = state.pos
  if (state.src[position] !== '@' || (position && /[A-Za-z0-9_.+%\-@\\]/.test(state.src[position - 1]!))) return false
  const part = parseDescription(state.src.slice(position))[0]
  if (part?.type !== 'mention' || part.start !== 0) return false
  if (!silent) {
    const token = state.push('entry_mention', '', 0)
    token.content = part.text
    token.meta = { id: part.id, label: part.label }
  }
  state.pos += part.text.length
  return true
})

type Token = ReturnType<typeof markdown.parse>[number]
type Node = VNode | string
const tags = new Set(['p', 'strong', 'em', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

export default defineComponent({
  props: {
    entry: { type: Object as PropType<Entry>, required: true },
    entries: { type: Array as PropType<Entry[]>, required: true },
    projects: { type: Array as PropType<Project[]>, required: true },
    interactive: { type: Boolean, default: true },
  },
  emits: { follow: (_entry: Entry) => true },
  setup(props, { emit }) {
    const tokens = computed(() => markdown.parse(props.entry.description, {}))
    return () => {
      const entries = new Map(props.entries.map(entry => [entry.id, entry]))
      const references = new Set(props.entry.references)
      const root: Node[] = []
      const stack: { tag: string; attrs: Record<string, string>; children: Node[] }[] = []
      const append = (node: Node) => (stack.at(-1)?.children ?? root).push(node)
      const render = (items: Token[]) => {
        for (const token of items) {
          if (token.hidden) continue
          if (token.type === 'inline') { render(token.children ?? []); continue }
          if (token.type === 'text' || token.type === 'html_inline' || token.type === 'html_block') { append(token.content); continue }
          if (token.type === 'softbreak' || token.type === 'hardbreak') { append(h('br')); continue }
          if (token.type === 'code_inline') { append(h('code', token.content)); continue }
          if (token.type === 'code_block' || token.type === 'fence') { append(h('pre', [h('code', token.content)])); continue }
          if (token.type === 'hr') { append(h('hr')); continue }
          if (token.type === 'image') { append(token.content); continue }
          if (token.type === 'entry_mention') {
            const { id, label } = token.meta as { id: string; label: string }
            const target = entries.get(id)
            const linked = target && references.has(id) && id !== props.entry.id
            if (!target) append(h('span', { class: 'entry-mention missing' }, `@${label}（已删除）`))
            else if (!linked || stack.some(frame => frame.tag === 'a')) append(linked ? h('span', { class: 'entry-mention' }, `@${target.title}`) : token.content)
            else if (props.interactive) append(h(EntryTooltip, { entry: target, entries: props.entries, projects: props.projects }, { default: () => h('button', { type: 'button', class: 'entry-mention', onClick: () => emit('follow', target) }, `@${target.title}`) }))
            else append(h('span', { class: 'entry-mention' }, `@${target.title}`))
            continue
          }
          if (!tags.has(token.tag)) continue
          if (token.nesting === 1) {
            const attrs: Record<string, string> = {}
            if (token.tag === 'a') attrs.href = String(token.attrGet('href') || '')
            if (token.tag === 'ol' && token.attrGet('start')) attrs.start = String(token.attrGet('start'))
            stack.push({ tag: token.tag, attrs, children: [] })
          } else if (token.nesting === -1) {
            const frame = stack.pop()
            if (frame) append(h(frame.tag, frame.attrs, frame.children))
          }
        }
      }
      render(tokens.value)
      return root
    }
  },
})
</script>
