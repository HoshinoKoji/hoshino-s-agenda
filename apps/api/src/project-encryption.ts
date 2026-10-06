import { and, count, eq, inArray, lt } from 'drizzle-orm'
import type { Database } from './db'
import { entries, projectDescriptionChanges as changes, projectEncryptionJobs as jobs, projects } from './db/schema'
import { fail } from './errors'
import { DESCRIPTION_MAX_LENGTH, type EncryptedDescription, type Project, type ProjectEncryption } from '../../../shared/types'
import { isEncryptedDescription, validEncryptionId } from '../../../shared/encryption'
import { isProjectEncryption } from '../../../shared/projectEncryption'

export function publicProject(row: typeof projects.$inferSelect): Project {
  return { id: row.id, name: row.name, color: row.color, createdAt: row.createdAt,
    encryptionRevision: row.encryptionRevision, ...(row.encryption ? { encryption: row.encryption } : {}) }
}

export function validateProjectDescription(projectId: string, encryption: ProjectEncryption | null, description: string, sealed: EncryptedDescription | null) {
  if (encryption) {
    if (description !== '' || sealed?.version !== 2 || sealed.projectId !== projectId || sealed.keyId !== encryption.keyId) {
      fail(409, '此项目需使用项目口令加密描述，请同步并解锁项目后保存')
    }
  } else if (sealed?.version === 2) fail(409, '目标项目的加密设置已变化，请同步并重新处理描述')
}

export async function projectEncryptionRoute(db: Database, email: string, projectId: string, jobId: string | undefined, action: string | undefined, method: string, input: Record<string, unknown>) {
  const project = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerEmail, email))).get()
  if (!project) fail(404, '项目不存在')
  const now = new Date().toISOString()
  await db.delete(jobs).where(and(eq(jobs.ownerEmail, email), lt(jobs.expiresAt, now)))
  if (!jobId && method === 'POST') {
    const { requestId, expectedRevision, encryption } = input
    if (!validEncryptionId(requestId) || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) fail(400, '转换标识或项目版本无效')
    if (encryption !== null && !isProjectEncryption(encryption)) fail(400, '项目加密格式无效')
    if (input.rewrap !== undefined && typeof input.rewrap !== 'boolean') fail(400, '口令修改类型无效')
    const rewrap = input.rewrap === true
    if (rewrap && (!project.encryption || !encryption || encryption.keyId !== project.encryption.keyId)) fail(400, '修改口令需保留原项目密钥身份')
    const previous = await db.select().from(jobs).where(eq(jobs.id, requestId)).get()
    if (previous) {
      if (previous.ownerEmail !== email || previous.projectId !== projectId || previous.revision !== expectedRevision ||
        previous.rewrap !== rewrap || JSON.stringify(previous.encryption) !== JSON.stringify(encryption)) fail(409, '转换标识已使用')
      return { id: previous.id, committed: previous.committed }
    }
    if (project.encryptionRevision !== expectedRevision) fail(409, '项目事项已变化，请同步后重新转换')
    await db.insert(jobs).values({ id: requestId, ownerEmail: email, projectId, revision: expectedRevision as number,
      encryption, rewrap, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() })
    return { id: requestId, committed: false }
  }
  if (!jobId) fail(404, '转换接口不存在')
  const job = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.projectId, projectId), eq(jobs.ownerEmail, email))).get()
  if (!job) fail(404, '转换已取消或过期，请重新开始')
  if (method === 'DELETE' && !action) {
    // A cancellation racing a commit must not delete its acknowledgement.
    await db.delete(jobs).where(and(eq(jobs.id, job.id), eq(jobs.committed, false)))
    return { ok: true, committed: job.committed }
  }
  if (action === 'chunks' && method === 'PUT') {
    if (job.committed) return { ok: true, committed: true }
    if (job.rewrap) fail(400, '修改口令不需要上传描述')
    if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > 100) fail(400, '每次转换需提交 1–100 个事项')
    const rows = input.entries.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '事项转换格式无效')
      const item = value as Record<string, unknown>
      if (!validEncryptionId(item.id) || typeof item.description !== 'string' || item.description.length > DESCRIPTION_MAX_LENGTH ||
        (item.encryptedDescription !== null && !isEncryptedDescription(item.encryptedDescription))) fail(400, '事项转换内容无效')
      validateProjectDescription(projectId, job.encryption, item.description, item.encryptedDescription)
      // Disabling a project restores plaintext, not another inaccessible project key.
      if (!job.encryption && item.encryptedDescription !== null) fail(400, '取消项目加密时需提交解锁后的描述')
      return { jobId: job.id, entryId: item.id, description: item.description, encryptedDescription: item.encryptedDescription }
    })
    if (new Set(rows.map(row => row.entryId)).size !== rows.length) fail(400, '转换事项不能重复')
    let owned = 0
    // Leave room for owner/project bindings under D1's 100-parameter limit.
    for (let offset = 0; offset < rows.length; offset += 80) {
      const result = await db.select({ count: count() }).from(entries).where(and(eq(entries.ownerEmail, email), eq(entries.projectId, projectId),
        inArray(entries.id, rows.slice(offset, offset + 80).map(row => row.entryId)))).get()
      owned += result?.count ?? 0
    }
    if (owned !== rows.length) fail(400, '转换事项不属于当前项目')
    const writes = rows.map(row => db.insert(changes).values(row).onConflictDoUpdate({ target: [changes.jobId, changes.entryId],
      set: { description: row.description, encryptedDescription: row.encryptedDescription } }))
    await db.batch([writes[0]!, ...writes.slice(1)])
    return { ok: true, committed: false }
  }
  if (action === 'commit' && method === 'POST') {
    if (job.committed) return { id: projectId, encryption: job.encryption, committed: true }
    const writes = [
      db.update(jobs).set({ committed: true, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() }).where(eq(jobs.id, job.id)),
      db.update(projects).set({ encryption: job.encryption }).where(and(eq(projects.id, projectId), eq(projects.ownerEmail, email))),
    ]
    // SQLite UPDATE FROM is emitted by Drizzle. No ciphertext or list of IDs is
    // embedded in the commit request, and every row changes in one transaction.
    await db.batch([writes[0]!, writes[1]!, ...(!job.rewrap ? [db.update(entries).set({ description: changes.description,
      encryptedDescription: changes.encryptedDescription, updatedAt: now }).from(changes)
      .where(and(eq(changes.jobId, job.id), eq(changes.entryId, entries.id), eq(entries.projectId, projectId), eq(entries.ownerEmail, email)))] : []),
      db.delete(changes).where(eq(changes.jobId, job.id))])
    return { id: projectId, encryption: job.encryption, committed: true }
  }
  return fail(404, '转换接口不存在')
}
