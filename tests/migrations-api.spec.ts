import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { test, expect } from './fixtures'

const requireApi = createRequire(resolve('apps/api/package.json'))
const { unstable_splitSqlQuery: splitSql } = requireApi('wrangler') as { unstable_splitSqlQuery: (sql: string) => string[] }
const directory = resolve('apps/api/migrations')
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
const sql = (name: string) => readFileSync(join(directory, name), 'utf8')

function apply(db: DatabaseSync, name: string) {
  const query = `${sql(name)}\nINSERT INTO d1_migrations(name) VALUES ('${name}');`
  // Compile each statement independently as the local Wrangler/D1 path does.
  for (const statement of splitSql(query)) db.prepare(statement).run()
}

test('D1 迁移：从空库逐条应用全部语句，项目触发器采用远程兼容形式', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE d1_migrations (name TEXT PRIMARY KEY)')
    for (const name of migrations) {
      apply(db, name)
      if (name.startsWith('0008') || name.startsWith('0009')) {
        for (const statement of splitSql(sql(name)).filter(value => /^CREATE TRIGGER\b/i.test(value))) {
          expect(statement, `${name} 的触发器应完整位于一行，避免远程 /query 拆分差异`).not.toContain('\n')
          expect(statement).not.toMatch(/\bCASE\b/i)
          expect(statement.match(/;/g)).toHaveLength(1)
        }
      }
    }
    expect(db.prepare('SELECT count(*) AS total FROM d1_migrations').get()?.total).toBe(migrations.length)
  } finally { db.close() }
})

test('D1 迁移：升级旧 CASE 触发器保留数据并保留全部提交校验', () => {
  const db = new DatabaseSync(':memory:')
  const guardNames = ['project_conversion_commit', 'project_conversion_snapshot', 'project_conversion_rewrap', 'project_conversion_complete']
  // Simulate a database that successfully applied the original local 0008.
  const legacyGuard = `CREATE TRIGGER project_conversion_commit BEFORE UPDATE OF committed ON project_encryption_jobs
WHEN NEW.committed = 1 BEGIN
  SELECT CASE WHEN OLD.committed = 1 THEN RAISE(ABORT, 'project conversion committed') END;
  SELECT CASE WHEN OLD.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') OR
    NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND owner_email = NEW.owner_email AND encryption_revision = NEW.revision)
    THEN RAISE(ABORT, 'project conversion conflict') END;
  SELECT CASE WHEN NEW.rewrap = 1 AND (NEW.encryption IS NULL OR NOT EXISTS (
    SELECT 1 FROM projects WHERE id = NEW.project_id AND encryption IS NOT NULL
      AND json_extract(encryption, '$.keyId') = json_extract(NEW.encryption, '$.keyId')))
    THEN RAISE(ABORT, 'project conversion conflict') END;
  SELECT CASE WHEN NEW.rewrap = 0 AND (
    (SELECT count(*) FROM entries WHERE project_id = NEW.project_id AND owner_email = NEW.owner_email) !=
    (SELECT count(*) FROM project_description_changes WHERE job_id = NEW.id))
    THEN RAISE(ABORT, 'project conversion incomplete') END;
END;`
  try {
    db.exec('CREATE TABLE d1_migrations (name TEXT PRIMARY KEY)')
    for (const name of migrations.filter(value => value < '0009')) apply(db, name)
    for (const name of guardNames) db.exec(`DROP TRIGGER ${name}`)
    // The SQL itself is valid, but splitting at a CASE END leaves an incomplete trigger.
    expect(() => db.prepare(legacyGuard.slice(0, legacyGuard.indexOf(';') + 1))).toThrow('incomplete input')
    db.exec(legacyGuard)
    db.exec(`INSERT INTO accounts(email) VALUES ('migration@example.com');
INSERT INTO projects(id, owner_email, name, color, created_at) VALUES ('p', 'migration@example.com', '已有项目', '#123456', '2026-01-01');
INSERT INTO entries(id, owner_email, project_id, title, description, created_at, updated_at) VALUES ('plain', 'migration@example.com', 'p', '原明文', '必须保留的正文', '2026-01-01', '2026-01-01');
INSERT INTO entries(id, owner_email, project_id, title, description, encrypted_description, created_at, updated_at) VALUES ('sealed', 'migration@example.com', 'p', '原密文', '', '{"version":1,"ciphertext":"preserved-fixture"}', '2026-01-01', '2026-01-01');`)
    const config = JSON.stringify({ version: 1, keyId: 'new-key' })
    const body = JSON.stringify({ version: 2, projectId: 'p', keyId: 'new-key', ciphertext: 'staged-fixture' })
    const revision = db.prepare('SELECT encryption_revision AS revision FROM projects WHERE id = ?').get('p')!.revision
    db.prepare('INSERT INTO project_encryption_jobs(id, owner_email, project_id, revision, encryption, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('job', 'migration@example.com', 'p', revision as number, config, '9999-01-01')
    const stage = db.prepare('INSERT INTO project_description_changes(job_id, entry_id, description, encrypted_description) VALUES (?, ?, ?, ?)')
    stage.run('job', 'plain', '', body)
    const snapshot = () => ({
      projects: db.prepare('SELECT * FROM projects ORDER BY id').all(), entries: db.prepare('SELECT * FROM entries ORDER BY id').all(),
      jobs: db.prepare('SELECT * FROM project_encryption_jobs ORDER BY id').all(), changes: db.prepare('SELECT * FROM project_description_changes ORDER BY entry_id').all(),
    })
    const before = snapshot()
    apply(db, '0009_project_encryption_trigger_compat.sql')
    expect(snapshot()).toEqual(before)
    const definitions = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'project_conversion_%' ORDER BY name").all()
    expect(definitions.map(value => value.name)).toEqual([...guardNames].sort())
    for (const definition of definitions) { expect(definition.sql).not.toContain('\n'); expect(definition.sql).not.toMatch(/\bCASE\b/i) }

    const commit = db.prepare("UPDATE project_encryption_jobs SET committed = 1 WHERE id = 'job'")
    expect(() => commit.run()).toThrow('project conversion incomplete')
    expect(snapshot()).toEqual(before)
    stage.run('job', 'sealed', '', body)
    db.exec("UPDATE project_encryption_jobs SET revision = revision - 1 WHERE id = 'job'")
    expect(() => commit.run()).toThrow('project conversion conflict')
    db.exec("UPDATE project_encryption_jobs SET revision = revision + 1, expires_at = '2000-01-01' WHERE id = 'job'")
    expect(() => db.prepare("UPDATE project_encryption_jobs SET committed = 1, expires_at = '9999-01-01' WHERE id = 'job'").run()).toThrow('project conversion conflict')
    db.exec("UPDATE project_encryption_jobs SET expires_at = '9999-01-01' WHERE id = 'job'")
    commit.run()
    expect(() => commit.run()).toThrow('project conversion committed')
    expect(() => db.prepare("UPDATE project_description_changes SET description = '' WHERE job_id = 'job'").run()).toThrow('project conversion unavailable')

    db.prepare('INSERT INTO project_encryption_jobs(id, owner_email, project_id, revision, encryption, rewrap, expires_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run('rewrap', 'migration@example.com', 'p', revision as number, JSON.stringify({ keyId: 'wrong-key' }), '9999-01-01')
    expect(() => db.prepare("UPDATE project_encryption_jobs SET committed = 1 WHERE id = 'rewrap'").run()).toThrow('project conversion conflict')
  } finally { db.close() }
})
