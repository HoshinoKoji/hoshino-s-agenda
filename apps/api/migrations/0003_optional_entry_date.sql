-- D1 applies each migration transactionally. Back up references before rebuilding
-- their parent table: dropping entries with ON DELETE CASCADE would erase them.
CREATE TABLE _entry_references_backup AS SELECT * FROM entry_references;
DROP TABLE entry_references;

CREATE TABLE entries_new (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  date TEXT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (id, owner_email),
  FOREIGN KEY (project_id, owner_email) REFERENCES projects(id, owner_email) ON DELETE CASCADE
);
INSERT INTO entries_new (id, owner_email, project_id, date, title, completed, created_at, updated_at, description)
SELECT id, owner_email, project_id, date, title, completed, created_at, updated_at, description FROM entries;
DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;
CREATE INDEX entries_owner_date ON entries(owner_email, date);
CREATE INDEX entries_project ON entries(project_id);

CREATE TABLE entry_references (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id),
  CHECK (source_id != target_id),
  FOREIGN KEY (source_id, owner_email) REFERENCES entries(id, owner_email) ON DELETE CASCADE,
  FOREIGN KEY (target_id, owner_email) REFERENCES entries(id, owner_email) ON DELETE CASCADE
);
INSERT INTO entry_references SELECT source_id, target_id, owner_email FROM _entry_references_backup;
DROP TABLE _entry_references_backup;
CREATE INDEX references_owner ON entry_references(owner_email);
CREATE INDEX references_target ON entry_references(target_id);
