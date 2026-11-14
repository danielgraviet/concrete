-- Per-user file storage usage (R2 bytes) for /v1/files. Separate from the AI
-- request quota in `usage`: file routes never touch that table.
CREATE TABLE IF NOT EXISTS storage_usage (
  uid        TEXT    NOT NULL PRIMARY KEY,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL
);
