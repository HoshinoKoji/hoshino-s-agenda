export const PROJECT_COLORS = ['#8574D8', '#5B9E91', '#D59C58', '#CE7E92', '#6C99CB', '#969A64'] as const

// Measured in UTF-16 code units (JavaScript string.length).
export const DESCRIPTION_MAX_LENGTH = 20_000

// Includes escaped descriptions, Base64 ciphertext and other JSON fields.
export const JSON_BODY_MAX_BYTES = 256 * 1024

export interface EncryptedDescription {
  version: 1
  salt: string
  iv: string
  ciphertext: string
}

export interface Project {
  id: string
  name: string
  color: string
  createdAt: string
}

export type RecurrenceFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
export type RecurrenceScope = 'single' | 'following' | 'all'
export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  startDate: string
  until: string
  // Preserve the original month/day when splitting a clamped occurrence's future.
  anchorDate?: string
}
export interface EntryRecurrence {
  seriesId: string
  scheduledDate: string
  exception: boolean
  version: number
  rule: RecurrenceRule
}

export interface Entry {
  id: string
  projectId: string
  // null means this entry has not been assigned a calendar date.
  date: string | null
  title: string
  description: string
  // Omitted for plaintext entries. Encrypted entries always have an empty description.
  encryptedDescription?: EncryptedDescription
  completed: boolean
  references: string[]
  assetIds: string[]
  createdAt: string
  updatedAt: string
  recurrence?: EntryRecurrence
}

export type EntrySaveResult = Pick<Entry, 'id' | 'description' | 'encryptedDescription'> & { savedEntry?: Entry }

export interface EntryRemoveOptions {
  scope: RecurrenceScope
  seriesVersion: number
}

export interface AgendaData {
  projects: Project[]
  entries: Entry[]
  assets: Asset[]
}

export interface Asset {
  id: string
  name: string
  contentType: string
  size: number
  image: boolean
  createdAt: string
  usageCount: number
}

export interface ProjectInput {
  name: string
  color: string
}

export interface EntryInput {
  projectId: string
  date: string | null
  title: string
  // Plain text, preserving whitespace. Omission on POST or PUT becomes an empty string.
  description?: string
  // Explicit null removes encryption. An encrypted entry cannot be PUT without this field.
  encryptedDescription?: EncryptedDescription | null
  completed: boolean
  references: string[]
  assetIds?: string[]
  recurrence?: RecurrenceRule | null
  scope?: RecurrenceScope
  seriesVersion?: number
  // Explicit acknowledgement of the nonexistent-date modal.
  acknowledgeAdjustments?: boolean
  // A stable creation ID makes retrying an acknowledged/ambiguous POST idempotent.
  requestId?: string
}
