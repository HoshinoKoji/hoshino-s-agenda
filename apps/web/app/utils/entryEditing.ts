import type { Entry, EntryInput } from '../../../../shared/types'

/** Include relations as their cleanup need not change updatedAt. */
export function entryRevision(entry: Entry | undefined): string {
  if (!entry) return ''
  const repeat = entry.recurrence
  return JSON.stringify({
    id: entry.id, projectId: entry.projectId, date: entry.date, title: entry.title, description: entry.description,
    encryptedDescription: entry.encryptedDescription ?? null, completed: entry.completed,
    createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    references: [...entry.references].sort(), assetIds: [...entry.assetIds].sort(),
    recurrence: repeat ? { seriesId: repeat.seriesId, scheduledDate: repeat.scheduledDate, exception: repeat.exception,
      version: repeat.version, rule: { frequency: repeat.rule.frequency, startDate: repeat.rule.startDate, until: repeat.rule.until, anchorDate: repeat.rule.anchorDate } } : null,
  })
}

export function matchesSavedInput(entry: Entry, input: EntryInput): boolean {
  return entry.title === input.title.trim() && entry.projectId === input.projectId && entry.date === input.date &&
    entry.completed === input.completed && entry.description === (input.description ?? '') &&
    JSON.stringify(entry.encryptedDescription ?? null) === JSON.stringify(input.encryptedDescription ?? null) &&
    JSON.stringify([...entry.references].sort()) === JSON.stringify([...input.references].sort()) &&
    JSON.stringify([...entry.assetIds].sort()) === JSON.stringify([...(input.assetIds ?? [])].sort())
}
