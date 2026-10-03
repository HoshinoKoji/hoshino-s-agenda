import type { Entry, EntryInput } from '../../../../shared/types'

/** Include relations as their cleanup need not change updatedAt. */
export function entryRevision(entry: Entry | undefined): string {
  return entry ? JSON.stringify({ ...entry, references: [...entry.references].sort(), assetIds: [...entry.assetIds].sort() }) : ''
}

export function matchesSavedInput(entry: Entry, input: EntryInput): boolean {
  return entry.title === input.title.trim() && entry.projectId === input.projectId && entry.date === input.date &&
    entry.completed === input.completed && entry.description === (input.description ?? '') &&
    JSON.stringify(entry.encryptedDescription ?? null) === JSON.stringify(input.encryptedDescription ?? null) &&
    JSON.stringify([...entry.references].sort()) === JSON.stringify([...input.references].sort()) &&
    JSON.stringify([...entry.assetIds].sort()) === JSON.stringify([...(input.assetIds ?? [])].sort())
}
