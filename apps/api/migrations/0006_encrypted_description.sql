ALTER TABLE entries ADD COLUMN encrypted_description TEXT
  CHECK (encrypted_description IS NULL OR (description = '' AND json_valid(encrypted_description)));
