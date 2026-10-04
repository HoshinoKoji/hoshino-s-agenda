import type { RecurrenceFrequency, RecurrenceRule } from './types'

export const MAX_RECURRENCE_OCCURRENCES = 366
export const RECURRENCE_LABELS: Record<RecurrenceFrequency, string> = {
  daily: '每天', weekdays: '工作日', weekly: '每周', monthly: '每月', yearly: '每年',
}
export interface RecurrenceAdjustment { requested: string; actual: string }

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const key = (year: number, month: number, day: number) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
function monthDays(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** UTC is used only for calendar arithmetic, never to interpret the user's timezone. */
export function expandRecurrence(value: unknown): { rule: RecurrenceRule; dates: string[]; adjustments: RecurrenceAdjustment[] } {
  const input = value as Partial<RecurrenceRule> | null
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !Object.hasOwn(RECURRENCE_LABELS, input.frequency ?? '')) throw new Error('请选择有效的重复规则')
  if (!isCalendarDate(input.startDate)) throw new Error('重复事项必须设置有效的开始日期')
  if (!isCalendarDate(input.until)) throw new Error('重复事项必须设置有效的截止日期')
  if (input.anchorDate !== undefined && !isCalendarDate(input.anchorDate)) throw new Error('重复事项的原始月日无效')
  if (input.until < input.startDate) throw new Error('截止日期不能早于开始日期')
  const rule: RecurrenceRule = { frequency: input.frequency!, startDate: input.startDate, until: input.until }
  if (input.anchorDate && input.anchorDate !== input.startDate && ['monthly', 'yearly'].includes(rule.frequency)) rule.anchorDate = input.anchorDate
  const dates: string[] = []
  const adjustments: RecurrenceAdjustment[] = []
  const [year, month] = rule.startDate.split('-').map(Number) as [number, number, number]
  const [, anchorMonth, day] = (rule.anchorDate ?? rule.startDate).split('-').map(Number) as [number, number, number]
  const start = new Date(`${rule.startDate}T12:00:00Z`)
  for (let index = 0; ; index++) {
    let actual: string
    let requested: string
    if (rule.frequency === 'monthly' || rule.frequency === 'yearly') {
      const offset = month - 1 + (rule.frequency === 'monthly' ? index : 0)
      const y = year + (rule.frequency === 'yearly' ? index : Math.floor(offset / 12))
      const m = rule.frequency === 'yearly' ? anchorMonth : offset % 12 + 1
      if (y > 9999) break
      requested = key(y, m, day)
      actual = key(y, m, Math.min(day, monthDays(y, m)))
    } else {
      const date = new Date(start)
      date.setUTCDate(date.getUTCDate() + index * (rule.frequency === 'weekly' ? 7 : 1))
      if (date.getUTCFullYear() > 9999) break
      actual = requested = date.toISOString().slice(0, 10)
      if (actual > rule.until) break
      if (rule.frequency === 'weekdays' && [0, 6].includes(date.getUTCDay())) continue
    }
    if (actual > rule.until) break
    if (actual < rule.startDate) continue
    dates.push(actual)
    if (actual !== requested) adjustments.push({ requested, actual })
    if (dates.length > MAX_RECURRENCE_OCCURRENCES) throw new Error(`一个重复系列最多 ${MAX_RECURRENCE_OCCURRENCES} 次，请缩短截止日期范围`)
  }
  if (!dates.length) throw new Error('该时间段内没有符合规则的日期')
  return { rule, dates, adjustments }
}
