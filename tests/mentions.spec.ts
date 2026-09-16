import { test, expect } from '@playwright/test'
import { descriptionReferences, legacyReferenceIds, mentionIds, mentionQueryAt, parseDescription, serializeMention } from '../shared/mentions'

test('标记转义往返、偏移与同名不同 ID', () => {
  const title = '方括号[标题] \\ 换行\n回车\r @邮件 (括号) 😀'
  const marker = serializeMention({ id: 'a_1-2', title })
  expect(marker).toBe('@[方括号\\[标题\\] \\\\ 换行\\n回车\\r @邮件 (括号) 😀](item:a_1-2)')
  const text = `前缀 ${marker}\n后缀`
  expect(parseDescription(text)).toEqual([
    { type: 'text', text: '前缀 ', start: 0, end: 3 },
    { type: 'mention', text: marker, id: 'a_1-2', label: title, start: 3, end: 3 + marker.length },
    { type: 'text', text: '\n后缀', start: 3 + marker.length, end: text.length },
  ])
  expect(mentionIds(`${serializeMention({ id: 'one', title })} ${serializeMention({ id: 'two', title })}`)).toEqual(['one', 'two'])
})

test('普通邮箱/@与畸形标记保持字面文本，不形成引用', () => {
  for (const text of [
    'hello@example.com @普通文本 @@ [链接](item:id)',
    'word@[标题](item:id) a+@[标题](item:id) \\@[标题](item:id)',
    '@[未闭合](item:id', '@[坏\\q转义](item:id)', '@[嵌[套]](item:id)',
    '@[换\n行](item:id)', '@[标题](https://example.com)', '@[标题](item:)',
    '@[标题](item:bad/id)', `@[标题](item:${'x'.repeat(65)})`,
  ]) {
    expect(mentionIds(text)).toEqual([])
    expect(parseDescription(text).map(part => part.text).join('')).toBe(text)
    expect(parseDescription(text).every(part => part.type === 'text')).toBe(true)
  }
  expect(parseDescription('')).toEqual([])
})

test('引用去重与自身/缺失过滤，legacy 合并和移除', () => {
  const description = '@[一](item:one) @[同一](item:one) @[自身](item:self) @[删除](item:missing)'
  const entries = [{ id: 'one' }, { id: 'two' }, { id: 'self' }]
  expect(mentionIds(description)).toEqual(['one', 'self', 'missing'])
  const legacy = legacyReferenceIds({ description, references: ['one', 'two', 'two'] })
  expect(legacy).toEqual(['two'])
  expect(descriptionReferences(description, entries, 'self', [...legacy, 'missing', 'self'])).toEqual(['one', 'two'])
  expect(descriptionReferences('', entries, 'self', legacy)).toEqual(['two'])
  expect(descriptionReferences('', entries, 'self', [])).toEqual([])
  expect(descriptionReferences(description, [{ id: 'two' }], 'self', legacy)).toEqual(['two'])
})

test('光标/选区边界、UTF-16 与中间插入范围保留后缀', () => {
  expect(mentionQueryAt('@', 1)).toEqual({ start: 0, end: 1, query: '' })
  const text = '😀 前缀 @项目 2026 后缀'
  const caret = text.indexOf(' 后缀')
  const query = mentionQueryAt(text, caret)!
  expect(query).toEqual({ start: 6, end: caret, query: '项目 2026' })
  const marker = serializeMention({ id: 'target', title: '目标' })
  expect(text.slice(0, query.start) + marker + text.slice(query.end)).toBe(`😀 前缀 ${marker} 后缀`)
  for (const [value, start, end] of [
    ['@test', 0, 0], ['@test', -1, -1], ['@test', 6, 6], ['@test', 2, 3],
    ['a@b', 3, 3], ['@@', 2, 2], ['\\@', 2, 2], ['@a\nb', 4, 4],
    [marker, 2, 2], [marker, marker.length - 1, marker.length - 1], [marker, marker.length, marker.length],
  ] as const) expect(mentionQueryAt(value, start, end)).toBeNull()
  expect(mentionQueryAt(`${marker} @新`, marker.length + 3)?.query).toBe('新')
  expect(mentionQueryAt('中文@项目', 5)?.query).toBe('项目')
})
