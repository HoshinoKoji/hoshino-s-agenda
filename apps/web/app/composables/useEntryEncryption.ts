import { inject, provide, shallowReactive, watch, onUnmounted, type InjectionKey, type Ref } from 'vue'
import type { EncryptedDescription, Entry, EntrySaveResult, Project, ProjectEncryption } from '../../../../shared/types'
import { decryptDescription, decryptDescriptionWithKey } from '../../../../shared/encryption'
import { unlockProjectEncryption } from '../../../../shared/projectEncryption'

interface Secret {
  fingerprint: string
  description: string
  key: CryptoKey
}

export interface EntrySaveSnapshot {
  encryptedDescription: EncryptedDescription
  description: string
  key: CryptoKey
}

function createEntryEncryption(email: Ref<string>, entries: Ref<Entry[]>, projects: Ref<Project[]>) {
  // Keep decrypted text and non-extractable keys out of API data and browser storage.
  const secrets = shallowReactive(new Map<string, Secret>())
  const attempts = new Map<string, number>()
  const pendingSaves = new Map<string, { secret: Secret; previousFingerprint: string | undefined; projectId?: string }>()
  const projectSecrets = shallowReactive(new Map<string, { fingerprint: string; key: CryptoKey }>())
  const projectAttempts = new Map<string, number>()
  const pendingProjects = new Map<string, { fingerprint: string; key: CryptoKey }>()
  let generation = 0
  const projectFingerprint = (project: Project) => JSON.stringify(project.encryption)
  const projectFor = (entry: Entry) => projects.value.find(project => project.id === entry.projectId)
  const fingerprint = (entry: Entry) => entry.encryptedDescription?.version === 2
    ? JSON.stringify([entry.encryptedDescription, projectFor(entry)?.encryption]) : JSON.stringify(entry.encryptedDescription)
  function getProject(project: Project) {
    const secret = projectSecrets.get(project.id)
    return secret?.fingerprint === projectFingerprint(project) ? secret : undefined
  }

  function get(entry: Entry) {
    if (entry.encryptedDescription?.version === 2) {
      const project = projectFor(entry)
      if (!project || !getProject(project)) return undefined
    }
    const secret = secrets.get(entry.id)
    return secret?.fingerprint === fingerprint(entry) ? secret : undefined
  }
  function description(entry: Entry): string | undefined {
    return entry.encryptedDescription ? get(entry)?.description : entry.description
  }
  function lock(id: string) {
    const entry = entries.value.find(item => item.id === id)
    if (entry?.encryptedDescription?.version === 2) { lockProject(entry.projectId); return }
    lockEntry(id)
  }
  function lockEntry(id: string) {
    attempts.set(id, (attempts.get(id) || 0) + 1)
    secrets.delete(id)
    pendingSaves.delete(id)
  }
  function lockProject(id: string) {
    projectAttempts.set(id, (projectAttempts.get(id) || 0) + 1)
    projectSecrets.delete(id)
    pendingProjects.delete(id)
    for (const entry of entries.value) if (entry.projectId === id && entry.encryptedDescription?.version === 2) lockEntry(entry.id)
    for (const [entryId, pending] of pendingSaves) if (pending.projectId === id) lockEntry(entryId)
  }
  function clear() {
    generation++
    secrets.clear()
    attempts.clear()
    pendingSaves.clear()
    projectSecrets.clear()
    projectAttempts.clear()
    pendingProjects.clear()
  }
  async function decryptProjectEntries(project: Project, key: CryptoKey) {
    const currentGeneration = generation
    const config = projectFingerprint(project)
    const attempt = projectAttempts.get(project.id) || 0
    const results = await Promise.all(entries.value.filter(entry => entry.projectId === project.id && entry.encryptedDescription?.version === 2).map(async entry => {
      const original = fingerprint(entry)
      const saved = get(entry)
      const secret = saved?.key === key ? saved : { ...await decryptDescriptionWithKey(entry.encryptedDescription!, key), fingerprint: original }
      return { entry, original, secret }
    }))
    const latestProject = projects.value.find(item => item.id === project.id)
    if (currentGeneration !== generation || (projectAttempts.get(project.id) || 0) !== attempt || !latestProject || projectFingerprint(latestProject) !== config) {
      throw new Error('项目或空间已变化，请重新解锁')
    }
    for (const { entry, original, secret } of results) {
      const latest = entries.value.find(item => item.id === entry.id)
      if (latest && fingerprint(latest) === original) secrets.set(entry.id, secret)
    }
  }
  async function unlockProjectWithKey(project: Project, key: CryptoKey) {
    if (!project.encryption) throw new Error('项目未启用描述加密')
    if (!(key instanceof CryptoKey) || key.extractable || key.algorithm.name !== 'AES-GCM' || (key.algorithm as { length?: number }).length !== 256 || !key.usages.includes('decrypt')) throw new Error('项目密钥无效')
    await decryptProjectEntries(project, key)
    projectSecrets.set(project.id, { fingerprint: projectFingerprint(project), key })
  }
  async function unlockProject(project: Project, password: string) {
    if (!project.encryption) return
    const currentGeneration = generation
    const attempt = (projectAttempts.get(project.id) || 0) + 1
    projectAttempts.set(project.id, attempt)
    const original = projectFingerprint(project)
    const key = await unlockProjectEncryption(project.id, project.encryption, password)
    const latest = projects.value.find(item => item.id === project.id)
    if (currentGeneration !== generation || projectAttempts.get(project.id) !== attempt || !latest || projectFingerprint(latest) !== original) throw new Error('项目或空间已变化，请重新解锁')
    await unlockProjectWithKey(latest, key)
  }
  function retainProject(id: string, config: ProjectEncryption, key: CryptoKey) {
    pendingProjects.set(id, { fingerprint: JSON.stringify(config), key })
  }
  function prepareSave(entry?: Entry) {
    const currentGeneration = generation
    const id = entry?.id
    const attempt = id ? attempts.get(id) || 0 : 0
    const previousFingerprint = entry ? fingerprint(entry) : undefined
    let confirmed = false
    function isCurrent() {
      if (confirmed || currentGeneration !== generation) return false
      if (!id) return true
      const latest = entries.value.find(item => item.id === id)
      return !!latest && (attempts.get(id) || 0) === attempt && fingerprint(latest) === previousFingerprint
    }
    function confirm(result: EntrySaveResult, snapshot: EntrySaveSnapshot) {
      if (!isCurrent()) return
      confirmed = true
      const projectId = snapshot.encryptedDescription.version === 2 ? snapshot.encryptedDescription.projectId : undefined
      const project = projectId ? projects.value.find(item => item.id === projectId) : undefined
      if (projectId && (!project || getProject(project)?.key !== snapshot.key)) return
      const savedFingerprint = fingerprint({ ...result, projectId: snapshot.encryptedDescription.version === 2 ? snapshot.encryptedDescription.projectId : entry?.projectId || '' } as Entry)
      if (typeof result.id !== 'string' || !result.id || (id && result.id !== id) || result.description !== '' ||
        JSON.stringify(result.encryptedDescription) !== JSON.stringify(snapshot.encryptedDescription) || (!id && attempts.has(result.id))) return
      // Only an acknowledged write may queue a plaintext/key snapshot for its matching GET.
      pendingSaves.set(result.id, {
        secret: { fingerprint: savedFingerprint, description: snapshot.description, key: snapshot.key },
        previousFingerprint,
        projectId,
      })
    }
    return { isCurrent, confirm }
  }
  async function unlockUsing(entry: Entry, decrypt: (data: EncryptedDescription) => ReturnType<typeof decryptDescription>) {
    if (!entry.encryptedDescription) return
    const currentGeneration = generation
    const attempt = (attempts.get(entry.id) || 0) + 1
    attempts.set(entry.id, attempt)
    const original = fingerprint(entry)
    const secret = await decrypt(entry.encryptedDescription)
    const latest = entries.value.find(item => item.id === entry.id)
    if (currentGeneration !== generation || attempts.get(entry.id) !== attempt || !latest || fingerprint(latest) !== original) {
      throw new Error('事项或空间已变化，请重新解锁')
    }
    secrets.set(entry.id, { ...secret, fingerprint: original })
  }
  const unlock = (entry: Entry, password: string) => {
    if (entry.encryptedDescription?.version === 2) {
      const project = projectFor(entry)
      if (!project) throw new Error('项目不存在')
      return unlockProject(project, password)
    }
    return unlockUsing(entry, data => decryptDescription(data, password))
  }
  const unlockWithKey = (entry: Entry, key: CryptoKey) => {
    if (entry.encryptedDescription?.version === 2) {
      const project = projectFor(entry)
      if (!project) throw new Error('项目不存在')
      return unlockProjectWithKey(project, key)
    }
    return unlockUsing(entry, data => decryptDescriptionWithKey(data, key))
  }

  watch(email, clear, { flush: 'sync' })
  watch([entries, projects], ([latest, latestProjects]) => {
    for (const [id, pending] of pendingProjects) {
      const project = latestProjects.find(item => item.id === id)
      if (project && projectFingerprint(project) === pending.fingerprint) projectSecrets.set(id, pending)
      pendingProjects.delete(id)
    }
    for (const [id, secret] of projectSecrets) {
      const project = latestProjects.find(item => item.id === id)
      if (!project || projectFingerprint(project) !== secret.fingerprint) lockProject(id)
    }
    const items = new Map(latest.map(entry => [entry.id, entry]))
    for (const [id, pending] of pendingSaves) {
      const entry = items.get(id)
      if (entry && fingerprint(entry) === pending.secret.fingerprint) {
        const current = secrets.get(id)
        // Retain the same cache object for metadata-only saves and pending print handoffs.
        if (!current || current.fingerprint !== pending.secret.fingerprint || current.description !== pending.secret.description || current.key !== pending.secret.key) {
          secrets.set(id, pending.secret)
        }
        pendingSaves.delete(id)
      } else if (!entry || fingerprint(entry) !== pending.previousFingerprint) {
        pendingSaves.delete(id)
      }
    }
    for (const [id, secret] of secrets) {
      const entry = items.get(id)
      if (!entry || fingerprint(entry) !== secret.fingerprint) lockEntry(id)
    }
    for (const project of latestProjects) {
      const secret = getProject(project)
      if (secret) void decryptProjectEntries(project, secret.key).catch(() => { /* A damaged description remains locked. */ })
    }
  }, { flush: 'sync' })
  onUnmounted(clear)
  return { get, description, lock, unlock, unlockWithKey, prepareSave, fingerprint, projectFor, getProject, unlockProject, lockProject, retainProject }
}

export type EntryEncryption = ReturnType<typeof createEntryEncryption>

const encryptionKey: InjectionKey<ReturnType<typeof createEntryEncryption>> = Symbol('entry-encryption')

export function provideEntryEncryption(email: Ref<string>, entries: Ref<Entry[]>, projects: Ref<Project[]>) {
  const encryption = createEntryEncryption(email, entries, projects)
  provide(encryptionKey, encryption)
  return encryption
}

export function useEntryEncryption() {
  const encryption = inject(encryptionKey)
  if (!encryption) throw new Error('Entry encryption provider is missing')
  return encryption
}
