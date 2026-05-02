import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { initialMigrationSql, openMemoryDatabase, type SqliteDatabase } from "./index.js";

export interface MetadataWorkspace {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface MetadataBlob {
  sha256: string;
  storage_path: string;
  content_text: string | null;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface MetadataFile {
  id: string;
  workspace_id: string;
  path: string;
  current_blob_sha256: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface MetadataMemoryNode {
  id: string;
  workspace_id: string;
  source_file_id: string;
  source_blob_sha256: string;
  summary: string;
  trigger: string;
  detail: string | null;
  raw_excerpt: string | null;
  raw_ref: string;
  source_location_json?: string | null;
  tags_json: string;
  memory_type: string;
  importance: number;
  confidence: number;
  trust_level?: string;
  status?: string;
  ttl_expires_at?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  last_confirmed_at?: string | null;
  last_used_at?: string | null;
  stale_reason?: string | null;
  duplicate_of?: string | null;
  conflicts_with_json?: string | null;
  conflict_reason?: string | null;
  scope?: string;
  project_id?: string | null;
  project_slug?: string | null;
  repo_id?: string | null;
  repo_path?: string | null;
  session_id?: string | null;
  agent_id?: string | null;
  contact_id?: string | null;
  run_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetadataStore {
  readonly kind: "sqlite" | "postgres";
  initialize(): Promise<void>;
  close(): Promise<void> | void;
  createWorkspace(name: string): Promise<MetadataWorkspace>;
  listWorkspaces(): Promise<MetadataWorkspace[]>;
  putBlob(blob: MetadataBlob): Promise<void>;
  putFile(file: MetadataFile): Promise<void>;
  putMemoryNode(node: MetadataMemoryNode): Promise<void>;
  getMemoryNode(id: string): Promise<MetadataMemoryNode | null>;
}

const metadataMemoryNodeColumns = [
  "id",
  "workspace_id",
  "source_file_id",
  "source_blob_sha256",
  "summary",
  "trigger",
  "detail",
  "raw_excerpt",
  "raw_ref",
  "source_location_json",
  "tags_json",
  "memory_type",
  "importance",
  "confidence",
  "trust_level",
  "status",
  "ttl_expires_at",
  "valid_from",
  "valid_until",
  "last_confirmed_at",
  "last_used_at",
  "stale_reason",
  "duplicate_of",
  "conflicts_with_json",
  "conflict_reason",
  "scope",
  "project_id",
  "project_slug",
  "repo_id",
  "repo_path",
  "session_id",
  "agent_id",
  "contact_id",
  "run_id",
  "created_at",
  "updated_at"
] as const;

const metadataMemoryNodeUpdatableColumns = [
  "summary",
  "trigger",
  "detail",
  "scope",
  "project_id",
  "project_slug",
  "repo_id",
  "repo_path",
  "session_id",
  "agent_id",
  "contact_id",
  "run_id",
  "updated_at"
] satisfies Array<(typeof metadataMemoryNodeColumns)[number]>;

type MetadataSqlValue = string | number | null;

function metadataMemoryNodeValues(node: MetadataMemoryNode): MetadataSqlValue[] {
  return [
    node.id,
    node.workspace_id,
    node.source_file_id,
    node.source_blob_sha256,
    node.summary,
    node.trigger,
    node.detail,
    node.raw_excerpt,
    node.raw_ref,
    node.source_location_json ?? null,
    node.tags_json,
    node.memory_type,
    node.importance,
    node.confidence,
    node.trust_level ?? "source_backed",
    node.status ?? "active",
    node.ttl_expires_at ?? null,
    node.valid_from ?? node.created_at,
    node.valid_until ?? null,
    node.last_confirmed_at ?? null,
    node.last_used_at ?? null,
    node.stale_reason ?? null,
    node.duplicate_of ?? null,
    node.conflicts_with_json ?? "[]",
    node.conflict_reason ?? null,
    node.scope ?? "workspace",
    node.project_id ?? null,
    node.project_slug ?? null,
    node.repo_id ?? null,
    node.repo_path ?? null,
    node.session_id ?? null,
    node.agent_id ?? null,
    node.contact_id ?? null,
    node.run_id ?? null,
    node.created_at,
    node.updated_at
  ];
}

export class SQLiteMetadataStore implements MetadataStore {
  readonly kind = "sqlite" as const;
  private db?: SqliteDatabase;

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    this.db = await openMemoryDatabase(this.dbPath);
  }

  close(): void {
    this.db?.close();
  }

  async createWorkspace(name: string): Promise<MetadataWorkspace> {
    const db = this.requireDb();
    const existing = db.prepare("SELECT * FROM workspaces WHERE name = ?").get(name) as MetadataWorkspace | undefined;
    if (existing) return existing;
    const now = isoNow();
    const workspace: MetadataWorkspace = {
      id: randomUUID(),
      name,
      created_at: now,
      updated_at: now
    };
    db.prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(workspace.id, workspace.name, workspace.created_at, workspace.updated_at);
    return workspace;
  }

  async listWorkspaces(): Promise<MetadataWorkspace[]> {
    return this.requireDb().prepare("SELECT * FROM workspaces ORDER BY created_at DESC").all() as unknown as MetadataWorkspace[];
  }

  async putBlob(blob: MetadataBlob): Promise<void> {
    this.requireDb()
      .prepare(
        "INSERT OR REPLACE INTO blobs (sha256, storage_path, content_text, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(blob.sha256, blob.storage_path, blob.content_text, blob.mime_type, blob.size_bytes, blob.created_at);
  }

  async putFile(file: MetadataFile): Promise<void> {
    this.requireDb()
      .prepare(
        `INSERT OR REPLACE INTO files
         (id, workspace_id, path, current_blob_sha256, mime_type, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        file.id,
        file.workspace_id,
        file.path,
        file.current_blob_sha256,
        file.mime_type,
        file.size_bytes,
        file.created_at,
        file.updated_at
      );
  }

  async putMemoryNode(node: MetadataMemoryNode): Promise<void> {
    this.requireDb()
      .prepare(
        `INSERT OR REPLACE INTO memory_nodes
         (${metadataMemoryNodeColumns.join(", ")})
         VALUES (${metadataMemoryNodeColumns.map(() => "?").join(", ")})`
      )
      .run(...metadataMemoryNodeValues(node));
  }

  async getMemoryNode(id: string): Promise<MetadataMemoryNode | null> {
    return (this.requireDb().prepare("SELECT * FROM memory_nodes WHERE id = ?").get(id) as MetadataMemoryNode | undefined) ?? null;
  }

  private requireDb(): SqliteDatabase {
    if (!this.db) {
      throw new Error("SQLiteMetadataStore has not been initialized.");
    }
    return this.db;
  }
}

export interface PostgresMetadataStoreOptions {
  connectionString?: string;
  client?: Pick<Client, "connect" | "end" | "query">;
  memoryFallback?: boolean;
}

export class PostgresMetadataStore implements MetadataStore {
  readonly kind = "postgres" as const;
  private readonly workspaces = new Map<string, MetadataWorkspace>();
  private readonly blobs = new Map<string, MetadataBlob>();
  private readonly files = new Map<string, MetadataFile>();
  private readonly nodes = new Map<string, MetadataMemoryNode>();
  private client?: Pick<Client, "connect" | "end" | "query">;
  private useMemory = false;

  constructor(private readonly options: PostgresMetadataStoreOptions = {}) {
    this.client = options.client;
  }

  async initialize(): Promise<void> {
    if (!this.client && this.options.connectionString) {
      this.client = new Client({ connectionString: this.options.connectionString });
    }
    if (!this.client) {
      if (this.options.memoryFallback) {
        this.useMemory = true;
        return;
      }
      throw new Error("PostgresMetadataStore requires a connectionString, client, or explicit memoryFallback.");
    }
    await this.client.connect?.();
    await this.client.query(postgresMigrationSql);
    await this.client.query(postgresCompatibilityMigrationSql);
  }

  async close(): Promise<void> {
    await this.client?.end?.();
  }

  async createWorkspace(name: string): Promise<MetadataWorkspace> {
    if (this.useMemory) {
      const existing = [...this.workspaces.values()].find((workspace) => workspace.name === name);
      if (existing) return existing;
      const workspace = this.workspaceRecord(name);
      this.workspaces.set(workspace.id, workspace);
      return workspace;
    }
    const workspace = this.workspaceRecord(name);
    const result = await this.client!.query(
      `INSERT INTO workspaces (id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET updated_at = workspaces.updated_at
       RETURNING *`,
      [workspace.id, workspace.name, workspace.created_at, workspace.updated_at]
    );
    return result.rows[0] as MetadataWorkspace;
  }

  async listWorkspaces(): Promise<MetadataWorkspace[]> {
    if (this.useMemory) return [...this.workspaces.values()];
    const result = await this.client!.query("SELECT * FROM workspaces ORDER BY created_at DESC");
    return result.rows as MetadataWorkspace[];
  }

  async putBlob(blob: MetadataBlob): Promise<void> {
    if (this.useMemory) {
      this.blobs.set(blob.sha256, blob);
      return;
    }
    await this.client!.query(
      `INSERT INTO blobs (sha256, storage_path, content_text, mime_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (sha256) DO UPDATE SET storage_path = EXCLUDED.storage_path`,
      [blob.sha256, blob.storage_path, blob.content_text, blob.mime_type, blob.size_bytes, blob.created_at]
    );
  }

  async putFile(file: MetadataFile): Promise<void> {
    if (this.useMemory) {
      this.files.set(file.id, file);
      return;
    }
    await this.client!.query(
      `INSERT INTO files (id, workspace_id, path, current_blob_sha256, mime_type, size_bytes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (workspace_id, path) DO UPDATE SET
         current_blob_sha256 = EXCLUDED.current_blob_sha256,
         mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         updated_at = EXCLUDED.updated_at`,
      [
        file.id,
        file.workspace_id,
        file.path,
        file.current_blob_sha256,
        file.mime_type,
        file.size_bytes,
        file.created_at,
        file.updated_at
      ]
    );
  }

  async putMemoryNode(node: MetadataMemoryNode): Promise<void> {
    if (this.useMemory) {
      this.nodes.set(node.id, node);
      return;
    }
    await this.client!.query(
      `INSERT INTO memory_nodes
       (${metadataMemoryNodeColumns.join(", ")})
       VALUES (${metadataMemoryNodeColumns.map((_, index) => `$${index + 1}`).join(", ")})
       ON CONFLICT (id) DO UPDATE SET
         ${metadataMemoryNodeUpdatableColumns.map((column) => `${column} = EXCLUDED.${column}`).join(",\n         ")}`,
      metadataMemoryNodeValues(node)
    );
  }

  async getMemoryNode(id: string): Promise<MetadataMemoryNode | null> {
    if (this.useMemory) return this.nodes.get(id) ?? null;
    const result = await this.client!.query("SELECT * FROM memory_nodes WHERE id = $1", [id]);
    return (result.rows[0] as MetadataMemoryNode | undefined) ?? null;
  }

  private workspaceRecord(name: string): MetadataWorkspace {
    const now = isoNow();
    return {
      id: randomUUID(),
      name,
      created_at: now,
      updated_at: now
    };
  }
}

export const postgresMigrationSql = initialMigrationSql
  .replace(/PRAGMA foreign_keys = ON;/g, "")
  .replace(/INTEGER NOT NULL DEFAULT 1/g, "INTEGER NOT NULL DEFAULT 1")
  .replace(/ON DELETE SET NULL/g, "ON DELETE SET NULL");

export const postgresCompatibilityMigrationSql = `
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS project_id TEXT;
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS project_slug TEXT;
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS repo_id TEXT;
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS repo_path TEXT;
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS agent_id TEXT;
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS contact_id TEXT;
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS run_id TEXT;
`;

function isoNow(): string {
  return new Date().toISOString();
}
