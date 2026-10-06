import type { AgendaData, Asset, Entry, EntryInput, EntryRemoveOptions, EntrySaveResult, Project, ProjectDescriptionChange, ProjectEncryptionChange, ProjectInput } from '../../../../shared/types'
import { JSON_BODY_MAX_BYTES } from '../../../../shared/types'

export function useAgenda(email: Ref<string>) {
  const data = ref<AgendaData>({ projects: [], entries: [], assets: [] })
  const loading = ref(false)
  const saving = ref(false)
  const orderingAccount = ref('')
  const reordering = computed(() => !!orderingAccount.value && orderingAccount.value === email.value)
  const error = ref('')
  const syncedAt = ref<Date | null>(null)
  let generation = 0
  let accountGeneration = 0
  const windowSync = useAgendaWindowSync(email, computed(() => loading.value || saving.value), refresh)
  watch(email, () => { accountGeneration++ }, { flush: 'sync' })

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
    data.value = { projects: [], entries: [], assets: [] }
    syncedAt.value = null
    loading.value = false
    error.value = ''
    if (email.value) void refresh()
  })

  async function mutate<T = void>(path: string, method: string, body?: unknown, onSaved?: (result: T) => void, operation?: (account: string) => Promise<T>) {
    if (saving.value) throw new Error('正在保存，请稍候')
    saving.value = true
    error.value = ''
    const account = email.value
    const currentAccount = accountGeneration
    try {
      const result = operation ? await operation(account) : await request<T>(path, method, body, account)
      windowSync.notify(account)
      if (currentAccount !== accountGeneration) return
      onSaved?.(result)
      await refresh()
      if (currentAccount === accountGeneration) return result
    } finally { saving.value = false }
  }

  const saveProject = async (input: ProjectInput, id?: string, onSaved?: (result: Project) => void) => { await mutate<Project>(id ? `/projects/${id}` : '/projects', id ? 'PUT' : 'POST', input, onSaved) }
  const cancelProjectConversion = (projectId: string, id: string) => request(`/projects/${projectId}/encryption/${id}`, 'DELETE')
  async function changeProjectEncryption(projectId: string, change: ProjectEncryptionChange, rows: ProjectDescriptionChange[], onSaved?: () => void) {
    const path = `/projects/${projectId}/encryption`
    const currentAccount = accountGeneration
    await mutate(`${path}/${change.requestId}/commit`, 'POST', {}, onSaved, async account => {
      const isCurrent = () => { if (currentAccount !== accountGeneration) throw new Error('空间已变化，请重新开始转换') }
      isCurrent()
      const job = await request<{ committed: boolean }>(path, 'POST', change, account)
      if (!job.committed) {
        const chunks: ProjectDescriptionChange[][] = []
        let chunk: ProjectDescriptionChange[] = []
        const bytes = (values: ProjectDescriptionChange[]) => new TextEncoder().encode(JSON.stringify({ entries: values })).byteLength
        for (const row of rows) {
          if (chunk.length && (chunk.length === 100 || bytes([...chunk, row]) > JSON_BODY_MAX_BYTES)) { chunks.push(chunk); chunk = [] }
          chunk.push(row)
          if (bytes(chunk) > JSON_BODY_MAX_BYTES) throw new Error('单个描述的转换内容过大')
        }
        if (chunk.length) chunks.push(chunk)
        for (const entries of chunks) { isCurrent(); await request(`${path}/${change.requestId}/chunks`, 'PUT', { entries }, account) }
      }
      isCurrent()
      return request<void>(`${path}/${change.requestId}/commit`, 'POST', {}, account)
    })
    if (currentAccount !== accountGeneration) throw new Error('空间已变化，请重新同步项目')
    if (error.value) throw new Error(`项目描述已写入云端，但同步确认失败，请重试保存以确认。${error.value}`)
  }
  const saveEntry = (input: EntryInput, id?: string, onSaved?: (result: EntrySaveResult) => void) =>
    mutate<EntrySaveResult>(id ? `/entries/${id}` : '/entries', id ? 'PUT' : 'POST', input, onSaved)
  const deleteProject = (id: string) => mutate(`/projects/${id}`, 'DELETE')
  const deleteEntry = (id: string, options?: EntryRemoveOptions) => mutate(`/entries/${id}`, 'DELETE', options)
  const deleteAsset = (id: string) => mutate(`/assets/${id}`, 'DELETE')
  const renameAsset = (id: string, name: string) => mutate(`/assets/${id}`, 'PATCH', { name })

  async function uploadAsset(file: File): Promise<Asset> {
    if (saving.value) throw new Error('正在保存，请稍候')
    if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('文件大小需在 1 字节至 20 MiB 之间')
    saving.value = true
    error.value = ''
    const account = email.value
    try {
      const response = await fetch('/api/assets', {
        method: 'POST', headers: { 'X-User-Email': account, 'X-File-Name': encodeURIComponent(file.name),
          'Content-Type': file.type || 'application/octet-stream' }, body: file,
      })
      const result = await response.json() as Asset & { error?: string }
      if (!response.ok) throw new Error(result.error || '上传失败，请重试')
      windowSync.notify(account)
      if (email.value === account) await refresh()
      return result
    } finally { saving.value = false }
  }

  async function toggleEntry(entry: Entry) {
    try { await mutate(`/entries/${entry.id}`, 'PATCH', { completed: !entry.completed }) }
    catch (cause) { error.value = (cause as Error).message }
  }

  async function moveEntry(entry: Entry, date: string) {
    if (saving.value || loading.value || entry.date === date) return
    const account = email.value
    try { await mutate(`/entries/${entry.id}`, 'PATCH', { date }) }
    catch (cause) { if (email.value === account) error.value = (cause as Error).message }
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

  return { data, loading, saving, reordering, error, syncedAt, refresh, saveProject, changeProjectEncryption, cancelProjectConversion, saveEntry, deleteProject, deleteEntry, deleteAsset, renameAsset, uploadAsset, toggleEntry, moveEntry, reorderProjects }
}
