import { and, count, eq, inArray } from 'drizzle-orm'
import { PROJECT_COLORS, type AgendaData, type EntryInput, type ProjectInput } from '../../../shared/types'
import { createDb, type Database } from './db'
import { accounts, entries, entryReferences, projects } from './db/schema'

interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const json = (data: unknown, status = 200) => Response.json(data, { status })
function fail(status: number, message: string): never { throw new HttpError(status, message) }

function getEmail(request: Request) {
  const email = (request.headers.get('X-User-Email') || '').trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, '请提供有效的邮箱地址')
  }
  return email
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) fail(415, '请使用 JSON 请求')
  // Bound the actual stream as well as Content-Length (which clients can omit).
  const reader = request.body?.getReader()
  if (!reader) fail(400, '请求内容不能为空')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 16_384) {
      await reader.cancel()
      fail(413, '请求内容过大')
    }
    chunks.push(value)
  }
  try {
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '请求内容必须是对象')
    return value as Record<string, unknown>
  } catch { return fail(400, '请求内容不是有效的 JSON 对象') }
}

function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    fail(400, `${label}需为 1–${max} 个字符`)
  }
  return value.trim()
}

function projectInput(value: Record<string, unknown>): ProjectInput {
  const name = text(value.name, '项目名称', 64)
  if (!PROJECT_COLORS.includes(value.color as typeof PROJECT_COLORS[number])) fail(400, '请选择有效的项目颜色')
  return { name, color: value.color as string }
}

function entryInput(value: Record<string, unknown>, id: string): EntryInput {
  const title = text(value.title, '事项标题', 200)
  const projectId = text(value.projectId, '项目 ID', 64)
  const date = text(value.date, '日期', 10)
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    fail(400, '请提供有效的日期，格式为 YYYY-MM-DD')
  }
  if (typeof value.completed !== 'boolean') fail(400, '完成状态必须为布尔值')
  if (!Array.isArray(value.references) || value.references.length > 50 ||
    !value.references.every(ref => typeof ref === 'string' && ref.length > 0 && ref.length <= 64)) {
    fail(400, '引用必须为事项 ID 列表，最多 50 个')
  }
  const references = [...new Set(value.references as string[])]
  if (references.includes(id)) fail(400, '事项不能引用自身')
  return { title, projectId, date, completed: value.completed, references }
}

async function ensureOwned(db: Database, table: typeof projects | typeof entries, id: string, email: string) {
  const row = await db.select({ id: table.id }).from(table)
    .where(and(eq(table.id, id), eq(table.ownerEmail, email))).get()
  if (!row) fail(404, table === projects ? '项目不存在' : '事项不存在')
}

async function route(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, '')
  const method = request.method
  if (path === '/api/health' && method === 'GET') return json({ ok: true })
  const email = getEmail(request)
  const db = createDb(env.DB)

  if (path === '/api/agenda' && method === 'GET') {
    const [projectRows, entryRows, referenceRows] = await db.batch([
      db.select({ id: projects.id, name: projects.name, color: projects.color, createdAt: projects.createdAt })
        .from(projects).where(eq(projects.ownerEmail, email)).orderBy(projects.createdAt, projects.id),
      db.select({
        id: entries.id, projectId: entries.projectId, date: entries.date, title: entries.title,
        completed: entries.completed, createdAt: entries.createdAt, updatedAt: entries.updatedAt,
      }).from(entries).where(eq(entries.ownerEmail, email)).orderBy(entries.date, entries.createdAt, entries.id),
      db.select({ sourceId: entryReferences.sourceId, targetId: entryReferences.targetId })
        .from(entryReferences).where(eq(entryReferences.ownerEmail, email)).orderBy(entryReferences.targetId),
    ])
    const references = new Map<string, string[]>()
    for (const row of referenceRows) {
      references.set(row.sourceId, [...(references.get(row.sourceId) || []), row.targetId])
    }
    return json({
      projects: projectRows,
      entries: entryRows.map(row => ({ ...row, references: references.get(row.id) || [] })),
    } satisfies AgendaData)
  }

  if (path === '/api/projects' && method === 'POST') {
    const data = projectInput(await body(request))
    const project = { id: crypto.randomUUID(), ...data, createdAt: new Date().toISOString() }
    await db.batch([
      db.insert(accounts).values({ email }).onConflictDoNothing({ target: accounts.email }),
      db.insert(projects).values({ ...project, ownerEmail: email }),
    ])
    return json(project, 201)
  }

  const projectMatch = path.match(/^\/api\/projects\/([\w-]+)$/)
  if (projectMatch && (method === 'PUT' || method === 'DELETE')) {
    const id = projectMatch[1]
    await ensureOwned(db, projects, id, email)
    if (method === 'DELETE') {
      await db.delete(projects).where(and(eq(projects.id, id), eq(projects.ownerEmail, email)))
    } else {
      const data = projectInput(await body(request))
      await db.update(projects).set(data).where(and(eq(projects.id, id), eq(projects.ownerEmail, email)))
    }
    return json({ ok: true })
  }

  const entryMatch = path.match(/^\/api\/entries\/([\w-]+)$/)
  if ((path === '/api/entries' && method === 'POST') || (entryMatch && method === 'PUT')) {
    const id = entryMatch?.[1] || crypto.randomUUID()
    if (entryMatch) await ensureOwned(db, entries, id, email)
    const data = entryInput(await body(request), id)
    await ensureOwned(db, projects, data.projectId, email)
    if (data.references.length) {
      const row = await db.select({ count: count() }).from(entries)
        .where(and(eq(entries.ownerEmail, email), inArray(entries.id, data.references))).get()
      if (row?.count !== data.references.length) fail(400, '引用的事项不存在或不属于当前邮箱')
    }
    const now = new Date().toISOString()
    const values = { projectId: data.projectId, date: data.date, title: data.title, completed: data.completed, updatedAt: now }
    const write = entryMatch
      ? db.update(entries).set(values).where(and(eq(entries.id, id), eq(entries.ownerEmail, email)))
      : db.insert(entries).values({ ...values, id, ownerEmail: email, createdAt: now })
    // Drizzle's D1 batch is transactional: an entry and all its references change together.
    await db.batch([
      write,
      db.delete(entryReferences).where(and(eq(entryReferences.sourceId, id), eq(entryReferences.ownerEmail, email))),
      ...data.references.map(targetId => db.insert(entryReferences).values({ sourceId: id, targetId, ownerEmail: email })),
    ])
    return json({ id }, entryMatch ? 200 : 201)
  }

  if (entryMatch && (method === 'PATCH' || method === 'DELETE')) {
    const id = entryMatch[1]
    await ensureOwned(db, entries, id, email)
    if (method === 'DELETE') {
      await db.delete(entries).where(and(eq(entries.id, id), eq(entries.ownerEmail, email)))
    } else {
      const data = await body(request)
      if (typeof data.completed !== 'boolean') fail(400, '完成状态必须为布尔值')
      await db.update(entries).set({ completed: data.completed, updatedAt: new Date().toISOString() })
        .where(and(eq(entries.id, id), eq(entries.ownerEmail, email)))
    }
    return json({ ok: true })
  }
  return fail(404, '接口不存在')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
    const headers = new Headers({ 'Vary': 'Origin', 'Cache-Control': 'no-store' })
    if (origin && !allowed.includes(origin)) return json({ error: '此站点来源未被允许' }, 403)
    if (origin) headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type, X-User-Email')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    let response: Response
    try { response = await route(request, env) }
    catch (error) {
      if (error instanceof HttpError) response = json({ error: error.message }, error.status)
      else {
        console.error('Agenda request failed', error)
        response = json({ error: '暂时无法访问数据库，请稍后重试' }, 500)
      }
    }
    headers.forEach((value, key) => response.headers.set(key, value))
    return response
  },
} satisfies ExportedHandler<Env>
