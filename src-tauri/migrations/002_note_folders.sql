CREATE TABLE IF NOT EXISTS note_folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_note_folders_name ON note_folders(lower(name)) WHERE deleted_at IS NULL;