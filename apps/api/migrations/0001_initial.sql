PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (id, owner_email)
);
CREATE INDEX projects_owner ON projects(owner_email);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  date TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, owner_email),
  FOREIGN KEY (project_id, owner_email) REFERENCES projects(id, owner_email) ON DELETE CASCADE
);
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
CREATE INDEX references_owner ON entry_references(owner_email);
CREATE INDEX references_target ON entry_references(target_id);
