CREATE TABLE entry_series (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
  rule TEXT NOT NULL CHECK(json_valid(rule)),
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(id, owner_email)
);
CREATE INDEX entry_series_owner ON entry_series(owner_email);
CREATE TABLE series_mutations (
  series_id TEXT NOT NULL REFERENCES entry_series(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  PRIMARY KEY(series_id, version)
);
CREATE TABLE series_skips (
  series_id TEXT NOT NULL REFERENCES entry_series(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY(series_id, date)
);
ALTER TABLE entries ADD COLUMN series_id TEXT REFERENCES entry_series(id) ON DELETE CASCADE;
ALTER TABLE entries ADD COLUMN scheduled_date TEXT;
ALTER TABLE entries ADD COLUMN recurrence_exception INTEGER NOT NULL DEFAULT 0 CHECK(recurrence_exception IN (0, 1));
CREATE UNIQUE INDEX entries_series_date ON entries(series_id, scheduled_date);
-- ALTER TABLE cannot add a composite FK. Enforce the same-owner invariant for both writes.
CREATE TRIGGER entries_series_owner_insert BEFORE INSERT ON entries
WHEN NEW.series_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM entry_series WHERE id = NEW.series_id AND owner_email = NEW.owner_email
) BEGIN SELECT RAISE(ABORT, 'series owner mismatch'); END;
CREATE TRIGGER entries_series_owner_update BEFORE UPDATE OF series_id, owner_email ON entries
WHEN NEW.series_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM entry_series WHERE id = NEW.series_id AND owner_email = NEW.owner_email
) BEGIN SELECT RAISE(ABORT, 'series owner mismatch'); END;
