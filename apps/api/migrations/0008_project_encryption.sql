ALTER TABLE projects ADD COLUMN encryption TEXT CHECK(encryption IS NULL OR json_valid(encryption));
ALTER TABLE projects ADD COLUMN encryption_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE project_encryption_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  encryption TEXT CHECK(encryption IS NULL OR json_valid(encryption)),
  rewrap INTEGER NOT NULL DEFAULT 0 CHECK(rewrap IN (0, 1)),
  committed INTEGER NOT NULL DEFAULT 0 CHECK(committed IN (0, 1)),
  expires_at TEXT NOT NULL,
  FOREIGN KEY(project_id, owner_email) REFERENCES projects(id, owner_email) ON DELETE CASCADE
);
CREATE INDEX project_encryption_jobs_expiry ON project_encryption_jobs(expires_at);
CREATE TABLE project_description_changes (
  job_id TEXT NOT NULL REFERENCES project_encryption_jobs(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  encrypted_description TEXT CHECK(encrypted_description IS NULL OR (description = '' AND json_valid(encrypted_description))),
  PRIMARY KEY(job_id, entry_id)
);

-- Snapshot revisions include membership and all entry writes, including recurring batches.
-- Keep complete triggers on one line for D1's remote /query statement splitter.
CREATE TRIGGER project_revision_insert AFTER INSERT ON entries BEGIN UPDATE projects SET encryption_revision = encryption_revision + 1 WHERE id = NEW.project_id; END;
CREATE TRIGGER project_revision_update AFTER UPDATE ON entries BEGIN UPDATE projects SET encryption_revision = encryption_revision + 1 WHERE id IN (OLD.project_id, NEW.project_id); END;
CREATE TRIGGER project_revision_delete AFTER DELETE ON entries BEGIN UPDATE projects SET encryption_revision = encryption_revision + 1 WHERE id = OLD.project_id; END;
CREATE TRIGGER project_revision_encryption AFTER UPDATE OF encryption ON projects WHEN OLD.encryption IS NOT NEW.encryption BEGIN UPDATE projects SET encryption_revision = encryption_revision + 1 WHERE id = NEW.id; END;

-- Enforce policy in the write transaction, rather than trusting an earlier API read.
CREATE TRIGGER entry_project_encryption_insert BEFORE INSERT ON entries WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND ((p.encryption IS NOT NULL AND (NEW.encrypted_description IS NULL OR json_extract(NEW.encrypted_description, '$.version') IS NOT 2 OR json_extract(NEW.encrypted_description, '$.projectId') IS NOT p.id OR json_extract(NEW.encrypted_description, '$.keyId') IS NOT json_extract(p.encryption, '$.keyId'))) OR (p.encryption IS NULL AND json_extract(NEW.encrypted_description, '$.version') = 2))) BEGIN SELECT RAISE(ABORT, 'project encryption mismatch'); END;
CREATE TRIGGER entry_project_encryption_update BEFORE UPDATE OF project_id, description, encrypted_description ON entries WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND ((p.encryption IS NOT NULL AND (NEW.encrypted_description IS NULL OR json_extract(NEW.encrypted_description, '$.version') IS NOT 2 OR json_extract(NEW.encrypted_description, '$.projectId') IS NOT p.id OR json_extract(NEW.encrypted_description, '$.keyId') IS NOT json_extract(p.encryption, '$.keyId'))) OR (p.encryption IS NULL AND json_extract(NEW.encrypted_description, '$.version') = 2))) BEGIN SELECT RAISE(ABORT, 'project encryption mismatch'); END;

CREATE TRIGGER project_change_insert BEFORE INSERT ON project_description_changes WHEN NOT EXISTS (SELECT 1 FROM project_encryption_jobs j JOIN entries e ON e.id = NEW.entry_id WHERE j.id = NEW.job_id AND j.committed = 0 AND j.rewrap = 0 AND e.project_id = j.project_id AND e.owner_email = j.owner_email AND j.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) BEGIN SELECT RAISE(ABORT, 'project conversion unavailable'); END;
CREATE TRIGGER project_change_update BEFORE UPDATE ON project_description_changes WHEN NOT EXISTS (SELECT 1 FROM project_encryption_jobs j JOIN entries e ON e.id = NEW.entry_id WHERE j.id = NEW.job_id AND j.committed = 0 AND j.rewrap = 0 AND e.project_id = j.project_id AND e.owner_email = j.owner_email AND j.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) BEGIN SELECT RAISE(ABORT, 'project conversion unavailable'); END;

-- Every guard aborts the first write of the same atomic batch. Separate single-
-- statement triggers avoid nested CASE/END parsing; their execution order is irrelevant.
CREATE TRIGGER project_conversion_commit BEFORE UPDATE OF committed ON project_encryption_jobs WHEN NEW.committed = 1 AND OLD.committed = 1 BEGIN SELECT RAISE(ABORT, 'project conversion committed'); END;
CREATE TRIGGER project_conversion_snapshot BEFORE UPDATE OF committed ON project_encryption_jobs WHEN NEW.committed = 1 AND (OLD.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND owner_email = NEW.owner_email AND encryption_revision = NEW.revision)) BEGIN SELECT RAISE(ABORT, 'project conversion conflict'); END;
CREATE TRIGGER project_conversion_rewrap BEFORE UPDATE OF committed ON project_encryption_jobs WHEN NEW.committed = 1 AND NEW.rewrap = 1 AND (NEW.encryption IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND encryption IS NOT NULL AND json_extract(encryption, '$.keyId') = json_extract(NEW.encryption, '$.keyId'))) BEGIN SELECT RAISE(ABORT, 'project conversion conflict'); END;
CREATE TRIGGER project_conversion_complete BEFORE UPDATE OF committed ON project_encryption_jobs WHEN NEW.committed = 1 AND NEW.rewrap = 0 AND ((SELECT count(*) FROM entries WHERE project_id = NEW.project_id AND owner_email = NEW.owner_email) != (SELECT count(*) FROM project_description_changes WHERE job_id = NEW.id)) BEGIN SELECT RAISE(ABORT, 'project conversion incomplete'); END;
