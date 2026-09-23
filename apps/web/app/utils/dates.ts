export function dateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function parseDate(value: string): Date {
  const [year = 2000, month = 1, day = 1] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  date.setFullYear(year)
  return date
}

export function startOfWeek(value: string): Date {
  const date = parseDate(value)
  date.setDate(date.getDate() - (date.getDay() + 6) % 7)
  return date
}

export function formatDate(value: string): string {
  return parseDate(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
}
