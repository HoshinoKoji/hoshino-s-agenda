import type { AgendaData, Entry, EntryInput, ProjectInput } from '../../../../shared/types'

export function useAgenda(email: Ref<string>) {
  const data = ref<AgendaData>({ projects: [], entries: [] })
  const loading = ref(false)
  const saving = ref(false)
  const orderingAccount = ref('')
  const reordering = computed(() => !!orderingAccount.value && orderingAccount.value === email.value)
  const error = ref('')
  const syncedAt = ref<Date | null>(null)
  let generation = 0

  async function request<T>(path: string, method = 'GET', body?: unknown, account = email.value): Promise<T> {
    try {
      return await $fetch<T>(`/api${path}`, {
        method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        headers: { 'X-User-Email': account },
        body: body === undefined ? undefined : JSON.stringify(body),
        ...(body === undefined ? {} : { headers: { 'X-User-Email': account, 'Content-Type': 'application/json' } }),
        timeout: 15000,
        retry: 0,
      })
    } catch (cause) {
      const detail = cause as { data?: { error?: string } }
      throw new Error(detail.data?.error || '连接云端失败，请检查网络或后端服务后重试')
    }
  }

  async function refresh() {
    const current = ++generation
    if (!email.value) return
    loading.value = true
    error.value = ''
    try {
      const result = await request<AgendaData>('/agenda')
      if (current === generation) { data.value = result; syncedAt.value = new Date() }
    } catch (cause) {
      if (current === generation) error.value = (cause as Error).message
    } finally {
      if (current === generation) loading.value = false
    }
  }

  watch(email, () => {
    generation++
    data.value = { projects: [], entries: [] }
    syncedAt.value = null
    loading.value = false
    error.value = ''
    if (email.value) void refresh()
  })

  async function mutate(path: string, method: string, body?: unknown) {
    if (saving.value) throw new Error('正在保存，请稍候')
    saving.value = true
    error.value = ''
    const account = email.value
    try {
      await request(path, method, body, account)
      if (email.value === account) await refresh()
    } finally { saving.value = false }
  }

  const saveProject = (input: ProjectInput, id?: string) => mutate(id ? `/projects/${id}` : '/projects', id ? 'PUT' : 'POST', input)
  const saveEntry = (input: EntryInput, id?: string) => mutate(id ? `/entries/${id}` : '/entries', id ? 'PUT' : 'POST', input)
  const deleteProject = (id: string) => mutate(`/projects/${id}`, 'DELETE')
  const deleteEntry = (id: string) => mutate(`/entries/${id}`, 'DELETE')

  async function toggleEntry(entry: Entry) {
    try { await mutate(`/entries/${entry.id}`, 'PATCH', { completed: !entry.completed }) }
    catch (cause) { error.value = (cause as Error).message }
  }

  async function reorderProjects(projectIds: string[]) {
    if (saving.value || loading.value) return false
    const previousIds = data.value.projects.map(project => project.id)
    const account = email.value
    orderingAccount.value = account
    try { await mutate('/projects/order', 'PUT', { projectIds, previousIds }); return email.value === account && !error.value }
    catch (cause) { if (email.value === account) error.value = (cause as Error).message; return false }
    finally { orderingAccount.value = '' }
  }

  return { data, loading, saving, reordering, error, syncedAt, refresh, saveProject, saveEntry, deleteProject, deleteEntry, toggleEntry, reorderProjects }
}
