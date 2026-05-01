-- Postgres-compatible schema for MemFS team/cloud metadata.
-- It intentionally mirrors the SQLite migration shape where practical so
-- local-first sync can move payloads between stores without remapping fields.

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  current_blob_sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, path)
);

CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  storage_path TEXT NOT NULL,
  content_text TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  source_blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  summary TEXT NOT NULL,
  trigger TEXT NOT NULL,
  detail TEXT,
  raw_excerpt TEXT,
  raw_ref TEXT NOT NULL,
  source_location_json TEXT,
  tags_json TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  importance INTEGER NOT NULL,
  confidence REAL NOT NULL,
  trust_level TEXT NOT NULL DEFAULT 'source_backed',
  status TEXT NOT NULL DEFAULT 'active',
  ttl_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  object_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pg_files_workspace_path ON files(workspace_id, path);
CREATE INDEX IF NOT EXISTS idx_pg_memory_nodes_workspace ON memory_nodes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pg_sync_events_workspace_created ON sync_events(workspace_id, created_at);
