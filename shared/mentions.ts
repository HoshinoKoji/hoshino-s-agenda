/** Plain-text mentions, not Markdown. Labels escape \\, [, ], LF and CR. */
export type DescriptionPart =
  | { type: 'text'; text: string; start: number; end: number }
  | { type: 'mention'; text: string; id: string; label: string; start: number; end: number }

export const MAX_ENTRY_REFERENCES = 50

// Avoid interpreting email addresses (or an @ inside an ASCII word) as mentions.
function mentionBoundary(text: string, position: number): boolean {
  return position === 0 || !/[A-Za-z0-9_.+%\-@\\]/.test(text[position - 1]!)
}

export function serializeMention(entry: { id: string; title: string }): string {
  const label = entry.title.replace(/[\\\[\]\n\r]/g, char => {
    if (char === '\n') return '\\n'
    if (char === '\r') return '\\r'
    return `\\${char}`
  })
  return `@[${label}](item:${entry.id})`
}

export function parseDescription(text: string): DescriptionPart[] {
  const pattern = /@\[((?:\\[\\\[\]nr]|[^\\\[\]\r\n])*)\]\(item:([A-Za-z0-9_-]{1,64})\)/g
  const parts: DescriptionPart[] = []
  let position = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index!
    if (!mentionBoundary(text, start)) continue
    if (start > position) parts.push({ type: 'text', text: text.slice(position, start), start: position, end: start })
    const label = match[1]!.replace(/\\([\\\[\]nr])/g, (_, char: string) => char === 'n' ? '\n' : char === 'r' ? '\r' : char)
    position = start + match[0].length
    parts.push({ type: 'mention', text: match[0], id: match[2]!, label, start, end: position })
  }
  if (position < text.length) parts.push({ type: 'text', text: text.slice(position), start: position, end: text.length })
  return parts
}

export function mentionIds(text: string): string[] {
  return [...new Set(parseDescription(text).flatMap(part => part.type === 'mention' ? [part.id] : []))]
}

/** Existing relations without a marker must survive editing until explicitly removed. */
export function legacyReferenceIds(entry: { description: string; references: string[] }): string[] {
  const inline = new Set(mentionIds(entry.description))
  return [...new Set(entry.references)].filter(id => !inline.has(id))
}

/** Used only when saving an edit; renderers must separately check API references. */
export function descriptionReferences(text: string, entries: readonly { id: string }[], selfId?: string, legacy: readonly string[] = []): string[] {
  const existing = new Set(entries.map(entry => entry.id))
  return [...new Set([...mentionIds(text), ...legacy])].filter(id => id !== selfId && existing.has(id))
}

export interface MentionQuery { start: number; end: number; query: string }

/** Selection offsets use the same UTF-16 units as textarea.selectionStart. */
export function mentionQueryAt(text: string, start: number, end = start): MentionQuery | null {
  if (start !== end || start < 0 || start > text.length) return null
  // Moving the caret inside an existing marker must not open another picker.
  if (parseDescription(text).some(part => part.type === 'mention' && start > part.start && start < part.end)) return null
  const at = text.lastIndexOf('@', start - 1)
  if (at < 0 || at >= start || !mentionBoundary(text, at)) return null
  const query = text.slice(at + 1, start)
  if (/[\r\n@\[\]\\]/.test(query)) return null
  return { start: at, end: start, query }
}
