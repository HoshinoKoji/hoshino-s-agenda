export const PROJECT_COLORS = ['#8574D8', '#5B9E91', '#D59C58', '#CE7E92', '#6C99CB', '#969A64'] as const

export interface Project {
  id: string
  name: string
  color: string
  createdAt: string
}

export interface Entry {
  id: string
  projectId: string
  date: string
  title: string
  completed: boolean
  references: string[]
  createdAt: string
  updatedAt: string
}

export interface AgendaData {
  projects: Project[]
  entries: Entry[]
}

export interface ProjectInput {
  name: string
  color: string
}

export interface EntryInput {
  projectId: string
  date: string
  title: string
  completed: boolean
  references: string[]
}
