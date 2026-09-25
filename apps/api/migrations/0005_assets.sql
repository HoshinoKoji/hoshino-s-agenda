CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  image INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (id, owner_email)
);
CREATE INDEX assets_owner_created ON assets(owner_email, created_at);

CREATE TABLE entry_assets (
  entry_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  PRIMARY KEY (entry_id, asset_id),
  FOREIGN KEY (entry_id, owner_email) REFERENCES entries(id, owner_email) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, owner_email) REFERENCES assets(id, owner_email) ON DELETE RESTRICT
);
CREATE INDEX entry_assets_owner ON entry_assets(owner_email);
CREATE INDEX entry_assets_asset ON entry_assets(asset_id);

-- A failed R2 deletion remains retryable without exposing a deleted asset.
CREATE TABLE asset_deletions (
  object_key TEXT PRIMARY KEY
);
