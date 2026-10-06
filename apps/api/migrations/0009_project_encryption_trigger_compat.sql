-- Upgrade databases that already applied the original 0008 CASE-based guard.
-- Recreating only the guards preserves all project, entry and conversion data.
DROP TRIGGER IF EXISTS project_conversion_commit;
DROP TRIGGER IF EXISTS project_conversion_snapshot;
DROP TRIGGER IF EXISTS project_conversion_rewrap;
DROP TRIGGER IF EXISTS project_conversion_complete;
CREATE TRIGGER project_conversion_commit BEFORE UPDATE OF committed ON project_encryption_jobs WHEN NEW.committed = 1 AND OLD.committed = 1 BEGIN SELECT RAISE(ABORT, 'project conversion committed'); END;
CREATE TRIGGER project_conversion_snapshot BEFORE UPDATE OF committed ON project_encryption_jobs WHEN NEW.committed = 1 AND (OLD.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND owner_email = NEW.owner_email AND encryption_revision = NEW.revision)) BEGIN SELECT RAISE(ABORT, 'project conversion conflict'); END;
CREATE TRIGGER project_conversion_rewrap BEFORE UPDATE OF committed ON project_encryption_jobs WHEN NEW.committed = 1 AND NEW.rewrap = 1 AND (NEW.encryption IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND encryption IS NOT NULL AND json_extract(encryption, '$.keyId') = json_extract(NEW.encryption, '$.keyId'))) BEGIN SELECT RAISE(ABORT, 'project conversion conflict'); END;
CREATE TRIGGER project_conversion_complete BEFORE UPDATE OF committed ON project_encryption_jobs WHEN NEW.committed = 1 AND NEW.rewrap = 0 AND ((SELECT count(*) FROM entries WHERE project_id = NEW.project_id AND owner_email = NEW.owner_email) != (SELECT count(*) FROM project_description_changes WHERE job_id = NEW.id)) BEGIN SELECT RAISE(ABORT, 'project conversion incomplete'); END;
