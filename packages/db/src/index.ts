import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic, type SqlValue } from "sql.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface RunResult {
  changes: number;
}

export class SqliteStatement {
  constructor(
    private readonly owner: SqliteDatabase,
    private readonly sql: string
  ) {}

  run(...params: SqlValue[]): RunResult {
    const statement = this.owner.raw.prepare(this.sql);
    try {
      if (params.length > 0) {
        statement.bind(params);
      }
      while (statement.step()) {
        // Exhaust rows for statements that return them.
      }
      const changes = this.owner.raw.getRowsModified();
      this.owner.persist();
      return { changes };
    } finally {
      statement.free();
    }
  }

  get(...params: SqlValue[]): Record<string, SqlValue> | undefined {
    return this.all(...params)[0];
  }

  all(...params: SqlValue[]): Array<Record<string, SqlValue>> {
    const statement = this.owner.raw.prepare(this.sql);
    const rows: Array<Record<string, SqlValue>> = [];
    try {
      if (params.length > 0) {
        statement.bind(params);
      }
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  }
}

export class SqliteDatabase {
  constructor(
    readonly raw: SqlJsDatabase,
    private readonly dbPath: string
  ) {}

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this, sql);
  }

  exec(sql: string): void {
    this.raw.run(sql);
    this.persist();
  }

  pragma(sql: string): void {
    this.raw.run(`PRAGMA ${sql}`);
    this.persist();
  }

  persist(): void {
    writeFileSync(this.dbPath, Buffer.from(this.raw.export()));
  }

  close(): void {
    this.persist();
    this.raw.close();
  }
}

export const initialMigrationSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  current_blob_sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, path),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  storage_path TEXT NOT NULL,
  content_text TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extracted_sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  blob_sha256 TEXT NOT NULL,
  extractor_name TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  content_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY(blob_sha256) REFERENCES blobs(sha256)
);

CREATE TABLE IF NOT EXISTS file_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  blob_sha256 TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  storage_path TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY(blob_sha256) REFERENCES blobs(sha256)
);

CREATE TABLE IF NOT EXISTS file_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  path TEXT NOT NULL,
  blob_sha256 TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  source_blob_sha256 TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(source_file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY(source_blob_sha256) REFERENCES blobs(sha256)
);

CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(from_node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY(to_node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recall_traces (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  query TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  result_node_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  memory_node_id TEXT NOT NULL,
  embedding_type TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(memory_node_id, embedding_type),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(memory_node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS protected_paths (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  path_glob TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, path_glob, rule_type),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_promotions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  source_node_id TEXT,
  proposed_node_json TEXT NOT NULL,
  status TEXT NOT NULL,
  actor TEXT NOT NULL,
  reviewer TEXT,
  reason TEXT,
  append INTEGER NOT NULL DEFAULT 1,
  candidate_node_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(source_node_id) REFERENCES memory_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY(candidate_node_id) REFERENCES memory_nodes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS memory_reviews (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  promotion_id TEXT,
  node_id TEXT,
  status TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(promotion_id) REFERENCES memory_promotions(id) ON DELETE SET NULL,
  FOREIGN KEY(node_id) REFERENCES memory_nodes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_items (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_json TEXT NOT NULL,
  FOREIGN KEY(snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_health_reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  report_json TEXT NOT NULL,
  overall_score INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  task TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  run_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_run_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_memory_usages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  memory_node_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  usage_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(memory_node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS handoff_summaries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  project_hint TEXT,
  summary TEXT NOT NULL,
  open_questions_json TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  next_actions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(role_id, action),
  FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id, user_id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, user_id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  last_pulled_at TEXT,
  last_pushed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, peer_id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  object_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conflict_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  local_version TEXT NOT NULL,
  remote_version TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_files_workspace_path ON files(workspace_id, path);
CREATE INDEX IF NOT EXISTS idx_extracted_sources_file ON extracted_sources(workspace_id, file_id, blob_sha256);
CREATE INDEX IF NOT EXISTS idx_file_artifacts_file ON file_artifacts(workspace_id, file_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_workspace ON memory_nodes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_trust_status ON memory_nodes(workspace_id, trust_level, status);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_source ON memory_nodes(source_file_id, source_blob_sha256);
CREATE INDEX IF NOT EXISTS idx_memory_links_workspace ON memory_links(workspace_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_node ON memory_embeddings(memory_node_id);
CREATE INDEX IF NOT EXISTS idx_audit_workspace_created ON audit_events(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_recall_traces_workspace_created ON recall_traces(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_promotions_workspace_status ON memory_promotions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_memory_reviews_workspace ON memory_reviews(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_workspace_created ON snapshots(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshot_items_snapshot ON snapshot_items(snapshot_id, item_type);
CREATE INDEX IF NOT EXISTS idx_memory_health_workspace_created ON memory_health_reports(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_created ON agent_runs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_run ON agent_run_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_run_memory_usages_run ON run_memory_usages(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_handoff_summaries_workspace_created ON handoff_summaries(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_workspace_created ON sync_events(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conflict_records_workspace_status ON conflict_records(workspace_id, status);
`;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export async function openMemoryDatabase(dbPath: string): Promise<SqliteDatabase> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const SQL = await loadSqlJs();
  const db = existsSync(dbPath)
    ? new SQL.Database(readFileSync(dbPath))
    : new SQL.Database();
  const wrapped = new SqliteDatabase(db, dbPath);
  wrapped.pragma("foreign_keys = ON");
  wrapped.pragma("journal_mode = WAL");
  wrapped.exec(initialMigrationSql);
  applyCompatibilityMigrations(wrapped);
  return wrapped;
}

function applyCompatibilityMigrations(db: SqliteDatabase): void {
  tryRun(db, "ALTER TABLE memory_nodes ADD COLUMN source_location_json TEXT");
  tryRun(db, "ALTER TABLE memory_nodes ADD COLUMN trust_level TEXT NOT NULL DEFAULT 'source_backed'");
  tryRun(db, "ALTER TABLE memory_nodes ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  tryRun(db, "ALTER TABLE memory_nodes ADD COLUMN ttl_expires_at TEXT");
  tryRun(db, "ALTER TABLE memory_links ADD COLUMN confidence REAL NOT NULL DEFAULT 0.7");
  tryRun(db, "ALTER TABLE memory_links ADD COLUMN reason TEXT NOT NULL DEFAULT ''");
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS recall_traces (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      query TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      result_node_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS extracted_sources (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      blob_sha256 TEXT NOT NULL,
      extractor_name TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      content_text TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY(blob_sha256) REFERENCES blobs(sha256)
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS file_artifacts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      blob_sha256 TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      storage_path TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY(blob_sha256) REFERENCES blobs(sha256)
    )`
  );
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_memory_links_workspace ON memory_links(workspace_id, relation_type)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_extracted_sources_file ON extracted_sources(workspace_id, file_id, blob_sha256)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_file_artifacts_file ON file_artifacts(workspace_id, file_id, artifact_type)");
  tryRun(
    db,
    "CREATE INDEX IF NOT EXISTS idx_recall_traces_workspace_created ON recall_traces(workspace_id, created_at)"
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS memory_promotions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      source_node_id TEXT,
      proposed_node_json TEXT NOT NULL,
      status TEXT NOT NULL,
      actor TEXT NOT NULL,
      reviewer TEXT,
      reason TEXT,
      append INTEGER NOT NULL DEFAULT 1,
      candidate_node_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(source_node_id) REFERENCES memory_nodes(id) ON DELETE SET NULL,
      FOREIGN KEY(candidate_node_id) REFERENCES memory_nodes(id) ON DELETE SET NULL
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS memory_reviews (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      promotion_id TEXT,
      node_id TEXT,
      status TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(promotion_id) REFERENCES memory_promotions(id) ON DELETE SET NULL,
      FOREIGN KEY(node_id) REFERENCES memory_nodes(id) ON DELETE SET NULL
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS snapshot_items (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_json TEXT NOT NULL,
      FOREIGN KEY(snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS memory_health_reports (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      report_json TEXT NOT NULL,
      overall_score INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`
  );
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_memory_nodes_trust_status ON memory_nodes(workspace_id, trust_level, status)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_memory_promotions_workspace_status ON memory_promotions(workspace_id, status)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_memory_reviews_workspace ON memory_reviews(workspace_id, created_at)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_snapshots_workspace_created ON snapshots(workspace_id, created_at)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_snapshot_items_snapshot ON snapshot_items(snapshot_id, item_type)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_memory_health_workspace_created ON memory_health_reports(workspace_id, created_at)");
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      task TEXT NOT NULL,
      actor TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      run_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS agent_run_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS run_memory_usages (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      memory_node_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      usage_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(memory_node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS handoff_summaries (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT,
      project_hint TEXT,
      summary TEXT NOT NULL,
      open_questions_json TEXT NOT NULL,
      decisions_json TEXT NOT NULL,
      next_actions_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
    )`
  );
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_created ON agent_runs(workspace_id, created_at)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_agent_run_events_run ON agent_run_events(run_id, created_at)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_run_memory_usages_run ON run_memory_usages(run_id, created_at)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_handoff_summaries_workspace_created ON handoff_summaries(workspace_id, created_at)");
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(role_id, action),
      FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, user_id),
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, user_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS sync_cursors (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      last_pulled_at TEXT,
      last_pushed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, peer_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS sync_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      object_version TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`
  );
  tryRun(
    db,
    `CREATE TABLE IF NOT EXISTS conflict_records (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      local_version TEXT NOT NULL,
      remote_version TEXT NOT NULL,
      conflict_type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`
  );
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id, user_id)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_sync_events_workspace_created ON sync_events(workspace_id, created_at)");
  tryRun(db, "CREATE INDEX IF NOT EXISTS idx_conflict_records_workspace_status ON conflict_records(workspace_id, status)");
  db.persist();
}

function tryRun(db: SqliteDatabase, sql: string): void {
  try {
    db.raw.run(sql);
  } catch {
    // Existing local databases may already have the compatibility shape.
  }
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  sqlJsPromise ??= initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm")
  });
  return sqlJsPromise;
}
