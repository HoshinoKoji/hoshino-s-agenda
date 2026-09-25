import { test as base, expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'
import { PROJECT_COLORS, type AgendaData, type EntryInput, type Project } from '../shared/types'

export class Space {
  constructor(readonly email: string, readonly api: APIRequestContext) {}

  async agenda(): Promise<AgendaData> {
    const response = await this.api.get('/api/agenda')
    expect(response.ok()).toBeTruthy()
    return response.json()
  }

  async project(name: string, color: string = PROJECT_COLORS[0]): Promise<Project> {
    const response = await this.api.post('/api/projects', { data: { name, color } })
    expect(response.status()).toBe(201)
    return response.json()
  }

  async entry(projectId: string, title: string, date: string | null, references: string[] = [], description?: string): Promise<string> {
    const data: EntryInput = { projectId, title, date, references, completed: false, ...(description === undefined ? {} : { description }) }
    const response = await this.api.post('/api/entries', { data })
    expect(response.status()).toBe(201)
    const result = await response.json()
    expect(result.description).toBe(description ?? '')
    return result.id
  }
}

async function withSpace(playwright: PlaywrightWorkerArgs['playwright'], use: (space: Space) => Promise<void>) {
  const email = `test-${crypto.randomUUID()}@example.com`
  const api = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:8787', extraHTTPHeaders: { 'X-User-Email': email } })
  const space = new Space(email, api)
  try { await use(space) }
  finally {
    try {
      for (const project of (await space.agenda()).projects) {
        expect((await api.delete(`/api/projects/${project.id}`)).ok()).toBeTruthy()
      }
      for (const asset of (await space.agenda()).assets) {
        expect((await api.delete(`/api/assets/${asset.id}`)).ok()).toBeTruthy()
      }
    } finally { await api.dispose() }
  }
}

export const test = base.extend<{ space: Space; otherSpace: Space }>({
  space: async ({ playwright }, use) => withSpace(playwright, use),
  otherSpace: async ({ playwright }, use) => withSpace(playwright, use),
})
export { expect }
