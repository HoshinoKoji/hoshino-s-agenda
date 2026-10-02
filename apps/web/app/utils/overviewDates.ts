export type OverviewDateFilter =
  | { type: 'all' }
  | { type: 'undated' }
  | { type: 'range'; start: string; end: string }

export function matchesOverviewDateFilter(date: string | null, filter: OverviewDateFilter): boolean {
  if (filter.type === 'all') return true
  if (filter.type === 'undated') return date === null
  return date !== null && date >= filter.start && date <= filter.end
}
