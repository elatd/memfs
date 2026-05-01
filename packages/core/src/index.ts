import { openMemoryDatabase, type SqliteDatabase } from "@memoryfs/db";
import {
  cosineSimilarity,
  embedText,
  extractMemoryNodesFromContent,
  keywordScore,
  planRecallQuery,
  tokenize,
  type ExtractedMemoryNode,
  type MemoryModelOptions,
  type MemoryType,
  type RecallMode,
  type RecallQueryPlan
} from "@memoryfs/memory";
import { extractDocument, type ExtractedSection } from "@memoryfs/memory/extractors";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuthzProvider, PermissionAction, SyncStore } from "./adapters.js";

export const defaultProtectedPathGlobs = [
  "/profile.md",
  "/preferences.md",
  "/projects/*/decisions.md",
  "/projects/*/constraints.md"
] as const;

export type FileEventType = "write" | "delete" | "ingest" | "upload" | "extract";
export type MemoryRelationType =
  | "related_to"
  | "supports"
  | "contradicts"
  | "supersedes"
  | "duplicates"
  | "caused_by"
  | "derived_from"
  | "belongs_to_project"
  | "used_in_run"
  | "promoted_from";
export type MemoryTrustLevel =
  | "ephemeral"
  | "agent_generated"
  | "source_backed"
  | "reviewed"
  | "trusted"
  | "superseded"
  | "rejected";
export type MemoryNodeStatus = "active" | "pending" | "rejected";
export type PromotionStatus = "pending" | "approved" | "rejected" | "applied";
export type SnapshotItemType =
  | "file"
  | "blob"
  | "memory_node"
  | "memory_link"
  | "protected_path"
  | "extracted_source"
  | "file_artifact";
export type AgentRunStatus = "created" | "running" | "completed" | "failed" | "compiled";
export type RunMemoryUsageType = "recalled" | "opened" | "cited" | "ignored" | "promoted";
export type MemfsMode = "local" | "team" | "cloud";
export type TeamRole = "owner" | "admin" | "editor" | "agent" | "viewer";
export type ConflictStatus = "unresolved" | "resolved_local" | "resolved_remote" | "resolved_manual";
export type ConflictResolutionMode = "keep_local" | "keep_remote" | "manual_merge" | "keep_both";

export interface MemoryFSOptions {
  dataDir: string;
  databasePath?: string;
  mode?: MemfsMode;
  databaseUrl?: string;
  syncEnabled?: boolean;
  authRequired?: boolean;
  authzProvider?: AuthzProvider;
  syncStore?: SyncStore;
  memory?: MemoryModelOptions;
}

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface FileRecord {
  id: string;
  workspace_id: string;
  path: string;
  current_blob_sha256: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface BlobRecord {
  sha256: string;
  storage_path: string;
  content_text: string | null;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface MemoryNode {
  id: string;
  workspace_id: string;
  source_file_id: string;
  source_blob_sha256: string;
  source_path: string;
  summary: string;
  trigger: string;
  detail: string | null;
  raw_excerpt: string | null;
  raw_ref: string;
  source_location_json: string | null;
  tags: string[];
  memory_type: MemoryType;
  importance: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  trust_level: MemoryTrustLevel;
  status: MemoryNodeStatus;
  ttl_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractedSource {
  id: string;
  workspace_id: string;
  file_id: string;
  blob_sha256: string;
  extractor_name: string;
  extractor_version: string;
  content_text: string;
  metadata_json: string;
  created_at: string;
}

export interface FileArtifact {
  id: string;
  workspace_id: string;
  file_id: string;
  blob_sha256: string;
  artifact_type: string;
  storage_path: string | null;
  metadata_json: string;
  created_at: string;
}

export interface MemoryLink {
  id: string;
  workspace_id: string;
  from_node_id: string;
  to_node_id: string;
  relation_type: MemoryRelationType;
  confidence: number;
  reason: string;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  workspace_id: string | null;
  actor: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

export interface WriteFileOptions {
  actor?: string;
  ingest?: boolean;
  allow_protected_write?: boolean;
  run_id?: string;
}

export interface UploadFileOptions extends WriteFileOptions {
  mime_type?: string;
}

export interface DeleteFileOptions {
  actor?: string;
  allow_protected_write?: boolean;
}

export interface ReadFileOptions {
  actor?: string;
  run_id?: string;
}

export interface TeamMember {
  id: string;
  workspace_id: string;
  user_id: string;
  handle: string;
  display_name: string | null;
  role: TeamRole;
  created_at: string;
  updated_at: string;
}

export interface SyncEvent {
  id: string;
  workspace_id: string;
  object_type: string;
  object_id: string;
  operation: string;
  object_version: string;
  payload_json: string;
  actor: string;
  created_at: string;
}

export interface ConflictRecord {
  id: string;
  workspace_id: string;
  object_type: string;
  object_id: string;
  local_version: string;
  remote_version: string;
  conflict_type: string;
  status: ConflictStatus;
  payload_json: string;
  created_at: string;
  resolved_at: string | null;
}

export interface SyncStatus {
  mode: MemfsMode;
  enabled: boolean;
  pending_events: number;
  unresolved_conflicts: number;
  object_storage: {
    configured: boolean;
    bucket: string | null;
  };
}

export interface SyncPullResult {
  applied: number;
  conflicts: ConflictRecord[];
}

export interface SyncPushResult {
  pushed: number;
  events: SyncEvent[];
}

export interface RecallOptions {
  limit?: number;
  include_detail?: boolean;
  include_raw?: boolean;
  project_hint?: string;
  mode?: RecallMode;
  memory_types?: string[];
  trust_levels?: string[];
  include_why?: boolean;
  include_contradictions?: boolean;
  include_links?: boolean;
  include_trust?: boolean;
  include_rejected?: boolean;
  run_id?: string;
  log_memory_usage?: boolean;
}

export interface RecallResult {
  node_id: string;
  type: "memory_node";
  summary: string;
  trigger: string;
  detail?: string | null;
  tags: string[];
  memory_type: MemoryType;
  importance: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  trust_level?: MemoryTrustLevel;
  status?: MemoryNodeStatus;
  score: number;
  source_path: string;
  raw_ref: string;
  source_location?: Record<string, unknown> | null;
  source_kind?: string | null;
  extractor_name?: string | null;
  raw_excerpt?: string | null;
  raw_content?: string | null;
  why?: WhyRecalled;
  links?: MemoryLinkPacket[];
  warnings?: string[];
  related_nodes?: Array<{
    node_id: string;
    relation_type: MemoryRelationType;
    summary: string;
  }>;
}

export interface MemoryNodeSource {
  node: MemoryNode;
  source_file: FileRecord;
  raw_ref: string;
  source_location: Record<string, unknown> | null;
  source_kind: string | null;
  extracted_sources: ExtractedSource[];
}

export interface RecallResponse {
  query: string;
  plan?: RecallQueryPlan;
  brief?: string;
  results: RecallResult[];
  warnings?: string[];
  trace_id?: string;
}

export interface WhyRecalled {
  trigger_similarity: number;
  summary_similarity: number;
  keyword_score: number;
  detail_similarity: number;
  raw_excerpt_similarity: number;
  importance_score: number;
  recency_score: number;
  path_project_score: number;
  graph_score: number;
  matched_terms: string[];
  matched_trigger: boolean;
  matched_summary: boolean;
  project_boost: boolean;
  linked_node_ids: string[];
  explanation: string;
}

export interface MemoryLinkPacket {
  id: string;
  from_node_id: string;
  to_node_id: string;
  other_node_id: string;
  relation_type: MemoryRelationType;
  confidence: number;
  reason: string;
  created_at: string;
  other_summary?: string;
  other_source_path?: string;
}

export interface ContradictionRecord {
  link: MemoryLinkPacket;
  from_node: MemoryNode;
  to_node: MemoryNode;
}

export interface PromoteMemoryRequest {
  source_path: string;
  target_path: string;
  source_node_id?: string;
  proposed_memory_type?: MemoryType;
  reason?: string;
  actor?: string;
  require_review?: boolean;
  append?: boolean;
}

export interface MemoryPromotion {
  id: string;
  workspace_id: string;
  source_path: string;
  target_path: string;
  source_node_id: string | null;
  proposed_node_json: string;
  status: PromotionStatus;
  actor: string;
  reviewer: string | null;
  reason: string | null;
  append: number;
  candidate_node_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryReview {
  id: string;
  workspace_id: string;
  promotion_id: string | null;
  node_id: string | null;
  status: string;
  reviewer: string;
  comment: string | null;
  created_at: string;
}

export interface Snapshot {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

export interface SnapshotItem {
  id: string;
  snapshot_id: string;
  item_type: SnapshotItemType;
  item_id: string;
  item_json: string;
}

export interface SnapshotDiff {
  snapshot_id: string;
  added: Array<{ item_type: SnapshotItemType; item_id: string }>;
  removed: Array<{ item_type: SnapshotItemType; item_id: string }>;
  changed: Array<{ item_type: SnapshotItemType; item_id: string }>;
}

export interface RollbackResult {
  snapshot_id: string;
  dry_run: boolean;
  diff: SnapshotDiff;
  restored: boolean;
}

export interface MemoryHealthReport {
  id: string;
  workspace_id: string;
  source_coverage: number;
  contradiction_count: number;
  unresolved_promotion_count: number;
  stale_node_count: number;
  rejected_node_count: number;
  low_confidence_count: number;
  orphan_node_count: number;
  raw_missing_count: number;
  unreviewed_trusted_path_writes: number;
  overall_score: number;
  created_at: string;
}

export interface AgentRun {
  id: string;
  workspace_id: string;
  title: string;
  task: string;
  actor: string;
  status: AgentRunStatus;
  started_at: string;
  completed_at: string | null;
  run_path: string;
  created_at: string;
}

export interface AgentRunEvent {
  id: string;
  workspace_id: string;
  run_id: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

export interface RunMemoryUsage {
  id: string;
  workspace_id: string;
  run_id: string;
  memory_node_id: string;
  source_path: string;
  usage_type: RunMemoryUsageType;
  created_at: string;
}

export interface HandoffSummary {
  id: string;
  workspace_id: string;
  run_id: string | null;
  project_hint: string | null;
  summary: string;
  open_questions_json: string;
  decisions_json: string;
  next_actions_json: string;
  created_at: string;
}

export interface BriefRequest {
  task: string;
  project_hint?: string;
  actor?: string;
  mode?: RecallMode;
  include_recent_runs?: boolean;
  include_open_questions?: boolean;
  include_contradictions?: boolean;
  include_raw?: boolean;
  limit?: number;
  create_run?: boolean;
}

export interface BriefResponse {
  brief_markdown: string;
  sections: {
    decisions: RecallResult[];
    constraints: RecallResult[];
    preferences: RecallResult[];
    previous_errors: RecallResult[];
    open_questions: RecallResult[];
    suggested_files: string[];
    warnings: string[];
  };
  memory_results: RecallResult[];
  run_id?: string;
}

export interface CompileRunResponse {
  candidate_nodes: MemoryNode[];
  suggested_promotions: MemoryPromotion[];
  contradictions: ContradictionRecord[];
  followups: string[];
  summary: string;
}

export interface StaleMemoryCandidate {
  node: MemoryNode;
  reasons: string[];
}

interface MemoryNodeRow {
  id: string;
  workspace_id: string;
  source_file_id: string;
  source_blob_sha256: string;
  source_path: string;
  summary: string;
  trigger: string;
  detail: string | null;
  raw_excerpt: string | null;
  raw_ref: string;
  source_location_json: string | null;
  tags_json: string;
  memory_type: MemoryType;
  importance: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  trust_level: MemoryTrustLevel;
  status: MemoryNodeStatus;
  ttl_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EmbeddingRow {
  embedding_type: string;
  embedding_json: string;
}

export class MemoryFSError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export class MemoryFS {
  readonly dataDir: string;
  readonly blobsDir: string;
  readonly workspacesDir: string;
  readonly dbPath: string;
  db!: SqliteDatabase;
  private readonly memoryOptions: MemoryModelOptions;
  private readonly mode: MemfsMode;
  private readonly syncEnabled: boolean;
  private readonly authRequired: boolean;
  private readonly authzProvider?: AuthzProvider;
  private readonly syncStore?: SyncStore;
  private readonly objectStoreBucket: string | null;

  constructor(options: MemoryFSOptions) {
    this.dataDir = path.resolve(options.dataDir);
    this.blobsDir = path.join(this.dataDir, "blobs");
    this.workspacesDir = path.join(this.dataDir, "workspaces");
    this.dbPath = options.databasePath ?? path.join(this.dataDir, "memoryfs.db");
    this.memoryOptions = options.memory ?? {};
    this.mode = options.mode ?? "local";
    this.syncEnabled = options.syncEnabled ?? this.mode !== "local";
    this.authRequired = options.authRequired ?? this.mode !== "local";
    this.authzProvider = options.authzProvider;
    this.syncStore = options.syncStore;
    this.objectStoreBucket = process.env.MEMFS_OBJECT_STORE_BUCKET ?? null;
  }

  async initialize(): Promise<void> {
    await mkdir(this.blobsDir, { recursive: true });
    await mkdir(this.workspacesDir, { recursive: true });
    this.db = await openMemoryDatabase(this.dbPath);
    this.ensureDefaultRoles();
  }

  close(): void {
    this.db?.close();
  }

  createWorkspace(name: string): Workspace {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new MemoryFSError("Workspace name is required.");
    }

    const existing = this.db.prepare("SELECT * FROM workspaces WHERE name = ?").get(trimmedName) as
      | Workspace
      | undefined;
    if (existing) {
      this.ensureDefaultProtectedPaths(existing.id);
      return existing;
    }

    const now = isoNow();
    const workspace: Workspace = {
      id: randomUUID(),
      name: trimmedName,
      created_at: now,
      updated_at: now
    };

    this.db
      .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(workspace.id, workspace.name, workspace.created_at, workspace.updated_at);
    this.ensureDefaultProtectedPaths(workspace.id);
    this.audit(workspace.id, "system", "workspace_create", { name: workspace.name });
    this.recordSyncEvent(workspace.id, "workspaces", workspace.id, "upsert", workspace, "system", workspace.updated_at);
    return workspace;
  }

  listWorkspaces(): Workspace[] {
    return this.db.prepare("SELECT * FROM workspaces ORDER BY created_at DESC").all() as unknown as Workspace[];
  }

  getWorkspace(workspaceId: string): Workspace {
    const workspace = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as
      | Workspace
      | undefined;
    if (!workspace) {
      throw new MemoryFSError("Workspace not found.", 404);
    }
    return workspace;
  }

  listFiles(workspaceId: string): FileRecord[] {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare("SELECT * FROM files WHERE workspace_id = ? ORDER BY path ASC")
      .all(workspaceId) as unknown as FileRecord[];
  }

  async readFile(
    workspaceId: string,
    inputPath: string,
    options: ReadFileOptions = {}
  ): Promise<{ file: FileRecord; content: string }> {
    const normalizedPath = normalizeMemoryPath(inputPath);
    this.ensureAuthorized(workspaceId, options.actor ?? "agent:unknown", "file.read", normalizedPath);
    const file = this.getFileByPath(workspaceId, normalizedPath);
    const blob = this.getBlob(file.current_blob_sha256);
    const content = await this.readBlobContent(blob);
    if (options.run_id) {
      this.logRunEvent(workspaceId, options.run_id, "file_read", {
        path: normalizedPath,
        actor: options.actor ?? "agent:unknown",
        blob_sha256: file.current_blob_sha256
      });
      await this.appendRunArtifact(workspaceId, options.run_id, "files-read.md", `- ${normalizedPath}`);
    }
    return { file, content };
  }

  async writeFile(
    workspaceId: string,
    inputPath: string,
    content: string,
    options: WriteFileOptions = {}
  ): Promise<FileRecord> {
    this.getWorkspace(workspaceId);
    const normalizedPath = normalizeMemoryPath(inputPath);
    if (normalizedPath === "/") {
      throw new MemoryFSError("Cannot write to workspace root.");
    }

    const actor = options.actor ?? "agent:unknown";
    this.ensureAuthorized(workspaceId, actor, "file.write", normalizedPath);
    const protectedMatch = this.matchProtectedPath(workspaceId, normalizedPath);
    if (protectedMatch && !options.allow_protected_write) {
      this.audit(workspaceId, actor, "protected_write_denied", {
        path: normalizedPath,
        rule: protectedMatch
      });
      throw new MemoryFSError(
        `Protected path ${normalizedPath} requires allow_protected_write=true.`,
        403
      );
    }

    const file = await this.persistFileBytes(workspaceId, normalizedPath, Buffer.from(content, "utf8"), {
      mimeType: inferMimeType(normalizedPath),
      actor,
      protected: Boolean(protectedMatch),
      eventType: "write",
      auditType: "file_write",
      runId: options.run_id
    });

    if (options.ingest) {
      await this.ingestFile(workspaceId, normalizedPath, actor);
    }

    return file;
  }

  async uploadFile(
    workspaceId: string,
    inputPath: string,
    bytes: Uint8Array,
    options: UploadFileOptions = {}
  ): Promise<FileRecord> {
    this.getWorkspace(workspaceId);
    const normalizedPath = normalizeMemoryPath(inputPath);
    if (normalizedPath === "/") {
      throw new MemoryFSError("Cannot upload to workspace root.");
    }

    const actor = options.actor ?? "agent:unknown";
    this.ensureAuthorized(workspaceId, actor, "file.write", normalizedPath);
    const protectedMatch = this.matchProtectedPath(workspaceId, normalizedPath);
    if (protectedMatch && !options.allow_protected_write) {
      this.audit(workspaceId, actor, "protected_write_denied", {
        path: normalizedPath,
        rule: protectedMatch
      });
      throw new MemoryFSError(
        `Protected path ${normalizedPath} requires allow_protected_write=true.`,
        403
      );
    }

    const file = await this.persistFileBytes(workspaceId, normalizedPath, Buffer.from(bytes), {
      mimeType: options.mime_type ?? inferMimeType(normalizedPath),
      actor,
      protected: Boolean(protectedMatch),
      eventType: "upload",
      auditType: "file_upload",
      runId: options.run_id
    });

    if (options.ingest) {
      await this.ingestFile(workspaceId, normalizedPath, actor);
    }

    return file;
  }

  async deleteFile(workspaceId: string, inputPath: string, options: DeleteFileOptions = {}): Promise<void> {
    this.getWorkspace(workspaceId);
    const normalizedPath = normalizeMemoryPath(inputPath);
    const actor = options.actor ?? "agent:unknown";
    this.ensureAuthorized(workspaceId, actor, "file.delete", normalizedPath);
    const protectedMatch = this.matchProtectedPath(workspaceId, normalizedPath);

    if (protectedMatch && !options.allow_protected_write) {
      this.audit(workspaceId, actor, "protected_delete_denied", {
        path: normalizedPath,
        rule: protectedMatch
      });
      throw new MemoryFSError(
        `Protected path ${normalizedPath} requires allow_protected_write=true.`,
        403
      );
    }

    const file = this.getFileByPath(workspaceId, normalizedPath);
    this.insertFileEvent({
      workspaceId,
      fileId: file.id,
      eventType: "delete",
      path: normalizedPath,
      blobSha256: file.current_blob_sha256,
      actor
    });
    await rm(this.workspaceFilePath(workspaceId, normalizedPath), { force: true });
    this.db.prepare("DELETE FROM files WHERE id = ?").run(file.id);
    this.audit(workspaceId, actor, "file_delete", {
      path: normalizedPath,
      blob_sha256: file.current_blob_sha256
    });
    this.recordSyncEvent(workspaceId, "files", file.id, "delete", {
      path: normalizedPath,
      current_blob_sha256: file.current_blob_sha256
    }, actor, isoNow());
  }

  async ingestFile(workspaceId: string, inputPath: string, actor = "agent:unknown"): Promise<MemoryNode[]> {
    const normalizedPath = normalizeMemoryPath(inputPath);
    const { file, source, document, extractor } = await this.extractAndStoreSource(workspaceId, normalizedPath);
    const unsupported = Boolean(document.metadata.unsupported);
    const sections = sourceSections(document);
    const created: MemoryNode[] = [];

    if (!unsupported) {
      for (const section of sections) {
        const extracted = await extractMemoryNodesFromContent({
          content: section.text,
          path: normalizedPath,
          options: this.memoryOptions
        });
        for (const extractedNode of extracted) {
          const node = await this.insertExtractedMemoryNode(
            workspaceId,
            file,
            extractedNode,
            actor,
            section.sourceLocation
          );
          if (node) {
            created.push(node);
          }
        }
      }
    }

    this.insertFileEvent({
      workspaceId,
      fileId: file.id,
      eventType: "ingest",
      path: normalizedPath,
      blobSha256: file.current_blob_sha256,
      actor
    });
    this.audit(workspaceId, actor, "memory_ingest_file", {
      path: normalizedPath,
      extractor_name: extractor.name,
      extractor_version: extractor.version,
      extracted_source_id: source.id,
      unsupported,
      section_count: sections.length,
      created_count: created.length
    });
    if (unsupported) {
      this.audit(workspaceId, actor, "file_extraction_unsupported", {
        path: normalizedPath,
        extractor_name: extractor.name,
        reason: document.metadata.reason ?? "Unsupported file type."
      });
    }
    return created;
  }

  async extractFile(workspaceId: string, inputPath: string, actor = "agent:unknown"): Promise<ExtractedSource> {
    const normalizedPath = normalizeMemoryPath(inputPath);
    const { file, source, document, extractor } = await this.extractAndStoreSource(workspaceId, normalizedPath);
    this.insertFileEvent({
      workspaceId,
      fileId: file.id,
      eventType: "extract",
      path: normalizedPath,
      blobSha256: file.current_blob_sha256,
      actor
    });
    this.audit(workspaceId, actor, "file_extracted", {
      path: normalizedPath,
      extractor_name: extractor.name,
      extractor_version: extractor.version,
      extracted_source_id: source.id,
      unsupported: Boolean(document.metadata.unsupported),
      section_count: document.sections.length
    });
    return source;
  }

  listExtractedSources(workspaceId: string, selector?: string): ExtractedSource[] {
    this.getWorkspace(workspaceId);
    if (!selector) {
      return this.db
        .prepare("SELECT * FROM extracted_sources WHERE workspace_id = ? ORDER BY created_at DESC")
        .all(workspaceId) as unknown as ExtractedSource[];
    }

    const file = selector.startsWith("/") ? this.getFileByPath(workspaceId, selector) : this.getFileById(workspaceId, selector);
    return this.db
      .prepare("SELECT * FROM extracted_sources WHERE workspace_id = ? AND file_id = ? ORDER BY created_at DESC")
      .all(workspaceId, file.id) as unknown as ExtractedSource[];
  }

  getMemoryNodeSource(workspaceId: string, nodeId: string): MemoryNodeSource {
    const node = this.getMemoryNode(workspaceId, nodeId);
    const sourceFile = this.getFileById(workspaceId, node.source_file_id);
    return {
      node,
      source_file: sourceFile,
      raw_ref: node.raw_ref,
      source_location: parseSourceLocation(node.source_location_json),
      source_kind: sourceKindForNode(node, sourceFile),
      extracted_sources: this.listExtractedSources(workspaceId, sourceFile.id)
    };
  }

  async recallMemory(workspaceId: string, query: string, options: RecallOptions = {}): Promise<RecallResponse> {
    this.getWorkspace(workspaceId);
    const queryText = query.trim();
    if (!queryText) {
      throw new MemoryFSError("Recall query is required.");
    }

    const plan = planRecallQuery({
      query: queryText,
      project_hint: options.project_hint,
      mode: options.mode,
      memory_types: options.memory_types,
      trust_levels: options.trust_levels,
      include_detail: options.include_detail,
      include_raw: options.include_raw,
      include_why: options.include_why,
      include_contradictions: options.include_contradictions,
      limit: options.limit
    });
    const limit = options.limit ?? 8;
    const queryEmbedding = await embedText(queryText, this.memoryOptions);
    const nodes = this.listMemoryNodes(workspaceId).filter((node) => {
      if (options.memory_types?.length && !options.memory_types.includes(node.memory_type)) return false;
      const trustRequested = options.trust_levels?.length
        ? options.trust_levels.includes(node.trust_level)
        : true;
      if (!trustRequested) return false;
      if (!options.include_rejected && (node.status === "rejected" || node.trust_level === "rejected")) return false;
      if (node.status === "pending" && !options.trust_levels?.includes(node.trust_level)) return false;
      return true;
    });
    const scored = await Promise.all(
      nodes.map(async (node) => {
        const embeddings = this.getNodeEmbeddings(node.id);
        const triggerSimilarity = unitSimilarity(
          cosineSimilarity(queryEmbedding, embeddings.trigger ?? embeddings.summary ?? [])
        );
        const summarySimilarity = unitSimilarity(
          cosineSimilarity(queryEmbedding, embeddings.summary ?? embeddings.trigger ?? [])
        );
        const detailSimilarity = unitSimilarity(
          cosineSimilarity(queryEmbedding, embeddings.detail ?? embeddings.raw_excerpt ?? [])
        );
        const rawExcerptSimilarity = unitSimilarity(
          cosineSimilarity(queryEmbedding, embeddings.raw_excerpt ?? embeddings.detail ?? [])
        );
        const keyword = Math.max(
          keywordScore(queryText, `${node.summary} ${node.trigger} ${node.detail ?? ""}`),
          keywordScore(queryText, `${node.source_path} ${node.tags.join(" ")}`)
        );
        const importance = (node.importance - 1) / 4;
        const recency = recencyScore(node.updated_at);
        const pathProject = pathOrProjectMatch(queryText, node.source_path, options.project_hint);
        const nodeLinks = this.getMemoryNodeLinks(workspaceId, node.id);
        const graphScore = this.graphScoreForNode(queryText, nodeLinks);
        const strategy = plan.retrieval_strategy;
        const baseScore =
          strategy.trigger_weight * triggerSimilarity +
          strategy.summary_weight * summarySimilarity +
          strategy.keyword_weight * keyword +
          strategy.detail_weight * Math.max(detailSimilarity, rawExcerptSimilarity * 0.75) +
          strategy.importance_weight * importance +
          strategy.recency_weight * recency +
          strategy.path_project_weight * pathProject +
          strategy.graph_weight * graphScore;
        const score = baseScore * trustScoreMultiplier(node);
        const terms = matchedTerms(queryText, `${node.summary} ${node.trigger} ${node.detail ?? ""} ${node.tags.join(" ")} ${node.source_path}`);
        const why: WhyRecalled = {
          trigger_similarity: round4(triggerSimilarity),
          summary_similarity: round4(summarySimilarity),
          keyword_score: round4(keyword),
          detail_similarity: round4(detailSimilarity),
          raw_excerpt_similarity: round4(rawExcerptSimilarity),
          importance_score: round4(importance),
          recency_score: round4(recency),
          path_project_score: round4(pathProject),
          graph_score: round4(graphScore),
          matched_terms: terms,
          matched_trigger: terms.some((term) => tokenize(node.trigger).includes(term)),
          matched_summary: terms.some((term) => tokenize(node.summary).includes(term)),
          project_boost: pathProject > 0.5,
          linked_node_ids: nodeLinks.map((link) => link.other_node_id),
          explanation: explainRecall(node, {
            matchedTerms: terms,
            triggerSimilarity,
            summarySimilarity,
            keyword,
            importance,
            pathProject,
            graphScore,
            mode: plan.mode
          })
        };

        return {
          node,
          score,
          why,
          links: nodeLinks
        };
      })
    );

    const results: RecallResult[] = [];
    for (const entry of scored.sort((left, right) => right.score - left.score).slice(0, limit)) {
      const includeRawExcerpt = options.include_raw || entry.node.confidence < 0.5;
      const sourceInfo = this.sourceInfoForNode(entry.node);
      const result: RecallResult = {
        node_id: entry.node.id,
        type: "memory_node",
        summary: entry.node.summary,
        trigger: entry.node.trigger,
        tags: entry.node.tags,
        memory_type: entry.node.memory_type,
        importance: entry.node.importance,
        confidence: entry.node.confidence,
        ...(options.include_trust
          ? {
              trust_level: entry.node.trust_level,
              status: entry.node.status
            }
          : {}),
        score: Number(entry.score.toFixed(4)),
        source_path: entry.node.source_path,
        raw_ref: entry.node.raw_ref,
        source_location: sourceInfo.source_location,
        source_kind: sourceInfo.source_kind,
        extractor_name: sourceInfo.extractor_name,
        raw_excerpt: includeRawExcerpt ? entry.node.raw_excerpt : null
      };

      const resultWarnings = warningsForNode(entry.links);
      if (resultWarnings.length > 0) {
        result.warnings = resultWarnings;
      }

      if (options.include_detail) {
        result.detail = entry.node.detail;
        result.related_nodes = this.getRelatedNodes(entry.node.id);
      }

      if (options.include_why) {
        result.why = entry.why;
      }

      if (options.include_links) {
        result.links = entry.links;
      }

      if (options.include_raw) {
        result.raw_content = await this.readRawForNode(workspaceId, entry.node.id);
      }

      results.push(result);
    }

    if (options.run_id && options.log_memory_usage !== false) {
      for (const result of results) {
        this.logMemoryUsage(workspaceId, options.run_id, result.node_id, "recalled");
      }
      await this.appendRunArtifact(
        workspaceId,
        options.run_id,
        "memory-used.md",
        results.map((result) => `- recalled ${result.node_id} ${result.source_path}: ${result.summary}`).join("\n")
      );
    }

    if (options.include_contradictions || plan.needs_contradictions) {
      for (const contradiction of this.findContradictions(workspaceId).slice(0, 5)) {
        const ids = new Set(results.map((result) => result.node_id));
        if (ids.has(contradiction.from_node.id) || ids.has(contradiction.to_node.id)) {
          const target = results.find(
            (result) => result.node_id === contradiction.from_node.id || result.node_id === contradiction.to_node.id
          );
          target?.warnings?.push("Linked contradiction exists.");
          if (target && !target.warnings) {
            target.warnings = ["Linked contradiction exists."];
          }
        }
      }
    }

    const warnings = Array.from(new Set(results.flatMap((result) => result.warnings ?? [])));
    const traceId = this.insertRecallTrace(workspaceId, queryText, plan, results.map((result) => result.node_id));
    this.audit(workspaceId, "agent:recall", "memory_recall", {
      query: queryText,
      limit,
      include_detail: Boolean(options.include_detail),
      include_raw: Boolean(options.include_raw),
      include_why: Boolean(options.include_why),
      include_links: Boolean(options.include_links),
      include_trust: Boolean(options.include_trust),
      include_rejected: Boolean(options.include_rejected),
      mode: plan.mode,
      project_hint: options.project_hint ?? null,
      result_count: results.length,
      trace_id: traceId
    });

    return {
      query: queryText,
      plan,
      brief: briefForRecall(plan, results),
      results,
      warnings,
      trace_id: traceId
    };
  }

  async searchMemory(workspaceId: string, query: string, options: RecallOptions = {}): Promise<RecallResponse> {
    return this.recallMemory(workspaceId, query, {
      include_detail: true,
      include_raw: false,
      ...options
    });
  }

  listMemoryNodes(workspaceId: string): MemoryNode[] {
    this.getWorkspace(workspaceId);
    const rows = this.db
      .prepare(
        `SELECT memory_nodes.*, files.path AS source_path
         FROM memory_nodes
         JOIN files ON files.id = memory_nodes.source_file_id
         WHERE memory_nodes.workspace_id = ?
         ORDER BY memory_nodes.updated_at DESC`
      )
      .all(workspaceId) as unknown as MemoryNodeRow[];
    return rows.map(rowToMemoryNode);
  }

  getMemoryNode(workspaceId: string, nodeId: string): MemoryNode {
    this.getWorkspace(workspaceId);
    const row = this.db
      .prepare(
        `SELECT memory_nodes.*, files.path AS source_path
         FROM memory_nodes
         JOIN files ON files.id = memory_nodes.source_file_id
         WHERE memory_nodes.workspace_id = ? AND memory_nodes.id = ?`
      )
      .get(workspaceId, nodeId) as MemoryNodeRow | undefined;
    if (!row) {
      throw new MemoryFSError("Memory node not found.", 404);
    }
    return rowToMemoryNode(row);
  }

  async readRawForNode(
    workspaceId: string,
    nodeId: string,
    options: { run_id?: string; actor?: string } = {}
  ): Promise<string> {
    const node = this.getMemoryNode(workspaceId, nodeId);
    this.ensureAuthorized(workspaceId, options.actor ?? "agent:unknown", "memory.raw.read", node.source_path);
    const blob = this.getBlob(node.source_blob_sha256);
    if (options.run_id) {
      this.logMemoryUsage(workspaceId, options.run_id, nodeId, "opened");
      this.logRunEvent(workspaceId, options.run_id, "raw_memory_opened", {
        node_id: nodeId,
        source_path: node.source_path,
        actor: options.actor ?? "agent:unknown"
      });
    }
    return this.readBlobContent(blob);
  }

  listAuditEvents(workspaceId: string, limit = 100): AuditEvent[] {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare("SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(workspaceId, limit) as unknown as AuditEvent[];
  }

  listProtectedPaths(workspaceId: string): Array<{ path_glob: string; rule_type: string }> {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare(
        "SELECT path_glob, rule_type FROM protected_paths WHERE workspace_id = ? ORDER BY path_glob ASC"
      )
      .all(workspaceId) as unknown as Array<{ path_glob: string; rule_type: string }>;
  }

  addWorkspaceMember(
    workspaceId: string,
    input: { handle: string; role: TeamRole; display_name?: string | null; actor?: string }
  ): TeamMember {
    this.getWorkspace(workspaceId);
    const actor = input.actor ?? "human:team";
    this.ensureCanManageMembers(workspaceId, actor);
    const user = this.upsertUser(input.handle, input.display_name ?? null);
    const roleId = this.roleId(input.role);
    const now = isoNow();
    const existing = this.db
      .prepare("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
      .get(workspaceId, user.id) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare("UPDATE workspace_members SET role_id = ?, updated_at = ? WHERE id = ?")
        .run(roleId, now, existing.id);
    } else {
      this.db
        .prepare(
          "INSERT INTO workspace_members (id, workspace_id, user_id, role_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(randomUUID(), workspaceId, user.id, roleId, now, now);
    }
    this.audit(workspaceId, actor, "workspace_member_upserted", {
      handle: input.handle,
      role: input.role
    });
    return this.getWorkspaceMember(workspaceId, input.handle);
  }

  listWorkspaceMembers(workspaceId: string): TeamMember[] {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare(
        `SELECT workspace_members.id,
                workspace_members.workspace_id,
                users.id AS user_id,
                users.handle,
                users.display_name,
                roles.name AS role,
                workspace_members.created_at,
                workspace_members.updated_at
         FROM workspace_members
         JOIN users ON users.id = workspace_members.user_id
         JOIN roles ON roles.id = workspace_members.role_id
         WHERE workspace_members.workspace_id = ?
         ORDER BY users.handle ASC`
      )
      .all(workspaceId) as unknown as TeamMember[];
  }

  setWorkspaceMemberRole(
    workspaceId: string,
    handle: string,
    role: TeamRole,
    actor = "human:team"
  ): TeamMember {
    this.ensureCanManageMembers(workspaceId, actor);
    const member = this.getWorkspaceMember(workspaceId, handle);
    this.db
      .prepare("UPDATE workspace_members SET role_id = ?, updated_at = ? WHERE id = ?")
      .run(this.roleId(role), isoNow(), member.id);
    this.audit(workspaceId, actor, "workspace_member_role_set", {
      handle,
      role
    });
    return this.getWorkspaceMember(workspaceId, handle);
  }

  getSyncStatus(workspaceId: string): SyncStatus {
    this.getWorkspace(workspaceId);
    const pendingEvents = this.countRows("sync_events", workspaceId);
    const unresolvedConflicts = Number(
      (this.db
        .prepare("SELECT COUNT(*) AS count FROM conflict_records WHERE workspace_id = ? AND status = 'unresolved'")
        .get(workspaceId) as { count: number }).count
    );
    return {
      mode: this.mode,
      enabled: this.syncEnabled,
      pending_events: pendingEvents,
      unresolved_conflicts: unresolvedConflicts,
      object_storage: {
        configured: Boolean(this.objectStoreBucket),
        bucket: this.objectStoreBucket
      }
    };
  }

  listSyncEvents(workspaceId: string, limit = 100): SyncEvent[] {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare("SELECT * FROM sync_events WHERE workspace_id = ? ORDER BY created_at ASC LIMIT ?")
      .all(workspaceId, limit) as unknown as SyncEvent[];
  }

  async syncPush(workspaceId: string, actor = "agent:sync"): Promise<SyncPushResult> {
    this.ensureAuthorized(workspaceId, actor, "sync.push");
    const events = this.listSyncEvents(workspaceId, 1000);
    if (this.syncStore) {
      await this.syncStore.push(events);
    }
    this.upsertSyncCursor(workspaceId, "default", { pushed: true });
    this.audit(workspaceId, actor, "sync_push", {
      event_count: events.length
    });
    return {
      pushed: events.length,
      events
    };
  }

  async syncPull(
    workspaceId: string,
    input: { events?: SyncEvent[]; actor?: string } = {}
  ): Promise<SyncPullResult> {
    const actor = input.actor ?? "agent:sync";
    this.ensureAuthorized(workspaceId, actor, "sync.pull");
    const events = input.events ?? (this.syncStore ? await this.syncStore.pull(workspaceId) : []);
    const conflicts: ConflictRecord[] = [];
    let applied = 0;

    for (const event of events) {
      if (event.object_type === "files" && event.operation !== "delete") {
        const payload = parseJson<FileRecord & { content_base64?: string }>(event.payload_json);
        const conflict = await this.conflictForRemoteFile(workspaceId, event, payload);
        if (conflict) {
          conflicts.push(conflict);
          continue;
        }
        await this.applyRemoteFileEvent(workspaceId, event, payload, actor);
        applied += 1;
        continue;
      }

      if (event.object_type === "files" && event.operation === "delete") {
        const payload = parseJson<{ path: string }>(event.payload_json);
        const existing = this.tryGetFileByPath(workspaceId, payload.path);
        if (existing && this.matchProtectedPath(workspaceId, payload.path)) {
          conflicts.push(this.createConflict(workspaceId, event, existing.updated_at, "protected_path_conflict"));
          continue;
        }
        if (existing) {
          await this.deleteFile(workspaceId, payload.path, { actor, allow_protected_write: false });
          applied += 1;
        }
      }
    }

    this.upsertSyncCursor(workspaceId, "default", { pulled: true });
    this.audit(workspaceId, actor, "sync_pull", {
      applied,
      conflict_count: conflicts.length
    });
    return { applied, conflicts };
  }

  listConflicts(workspaceId: string): ConflictRecord[] {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare("SELECT * FROM conflict_records WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as unknown as ConflictRecord[];
  }

  async resolveConflict(
    workspaceId: string,
    conflictId: string,
    input: {
      mode: ConflictResolutionMode;
      actor?: string;
      manual_content?: string;
    }
  ): Promise<ConflictRecord> {
    const actor = input.actor ?? "human:sync";
    const conflict = this.getConflict(workspaceId, conflictId);
    if (conflict.status !== "unresolved") {
      return conflict;
    }
    const payload = parseJson<{ remote_event?: SyncEvent; payload?: FileRecord & { content_base64?: string } }>(conflict.payload_json);
    const event = payload.remote_event;
    const filePayload = payload.payload;
    let status: ConflictStatus = "resolved_manual";

    if (input.mode === "keep_local") {
      status = "resolved_local";
    } else if (event && filePayload && input.mode === "keep_remote") {
      await this.applyRemoteFileEvent(workspaceId, event, filePayload, actor, true);
      status = "resolved_remote";
    } else if (event && filePayload && input.mode === "keep_both") {
      await this.writeConflictCopy(workspaceId, filePayload, actor);
      status = "resolved_manual";
    } else if (event && filePayload && input.mode === "manual_merge") {
      if (input.manual_content === undefined) {
        throw new MemoryFSError("manual_merge requires manual_content.");
      }
      await this.writeFile(workspaceId, filePayload.path, input.manual_content, {
        actor,
        ingest: false,
        allow_protected_write: Boolean(this.matchProtectedPath(workspaceId, filePayload.path))
      });
      status = "resolved_manual";
    }

    const resolvedAt = isoNow();
    this.db
      .prepare("UPDATE conflict_records SET status = ?, resolved_at = ? WHERE id = ?")
      .run(status, resolvedAt, conflictId);
    this.audit(workspaceId, actor, "sync_conflict_resolved", {
      conflict_id: conflictId,
      mode: input.mode,
      status
    });
    return this.getConflict(workspaceId, conflictId);
  }

  linkMemoryNodes(
    workspaceId: string,
    fromNodeId: string,
    toNodeId: string,
    relationType: MemoryRelationType,
    options: { confidence?: number; reason?: string; actor?: string } = {}
  ): MemoryLink {
    this.getMemoryNode(workspaceId, fromNodeId);
    this.getMemoryNode(workspaceId, toNodeId);
    if (fromNodeId === toNodeId) {
      throw new MemoryFSError("Cannot link a memory node to itself.");
    }

    const existing = this.db
      .prepare(
        `SELECT * FROM memory_links
         WHERE workspace_id = ? AND from_node_id = ? AND to_node_id = ? AND relation_type = ?`
      )
      .get(workspaceId, fromNodeId, toNodeId, relationType) as MemoryLink | undefined;
    if (existing) {
      const nextConfidence = options.confidence ?? existing.confidence;
      const nextReason = options.reason ?? existing.reason;
      if (nextConfidence !== existing.confidence || nextReason !== existing.reason) {
        this.db
          .prepare("UPDATE memory_links SET confidence = ?, reason = ? WHERE id = ?")
          .run(nextConfidence, nextReason, existing.id);
        return {
          ...existing,
          confidence: nextConfidence,
          reason: nextReason
        };
      }
      return existing;
    }

    const link: MemoryLink = {
      id: randomUUID(),
      workspace_id: workspaceId,
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      relation_type: relationType,
      confidence: options.confidence ?? 0.7,
      reason: options.reason ?? "",
      created_at: isoNow()
    };
    this.db
      .prepare(
        `INSERT INTO memory_links
         (id, workspace_id, from_node_id, to_node_id, relation_type, confidence, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        link.id,
        link.workspace_id,
        link.from_node_id,
        link.to_node_id,
        link.relation_type,
        link.confidence,
        link.reason,
        link.created_at
      );
    this.audit(workspaceId, options.actor ?? "agent:graph", "memory_link_created", {
      link_id: link.id,
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      relation_type: relationType,
      confidence: link.confidence,
      reason: link.reason
    });
    if (relationType === "supersedes") {
      this.markMemoryNodeTrust(workspaceId, toNodeId, "superseded", "active");
      this.audit(workspaceId, options.actor ?? "agent:graph", "memory_node_superseded", {
        node_id: toNodeId,
        superseded_by_node_id: fromNodeId,
        link_id: link.id
      });
    }
    this.recordSyncEvent(workspaceId, "memory_links", link.id, "upsert", link, options.actor ?? "agent:graph", link.created_at);
    return link;
  }

  getMemoryNodeLinks(workspaceId: string, nodeId: string): MemoryLinkPacket[] {
    this.getMemoryNode(workspaceId, nodeId);
    const rows = this.db
      .prepare(
        `SELECT memory_links.*,
                other.id AS other_node_id,
                other.summary AS other_summary,
                files.path AS other_source_path
         FROM memory_links
         JOIN memory_nodes other ON other.id =
           CASE
             WHEN memory_links.from_node_id = ? THEN memory_links.to_node_id
             ELSE memory_links.from_node_id
           END
         JOIN files ON files.id = other.source_file_id
         WHERE memory_links.workspace_id = ?
           AND (memory_links.from_node_id = ? OR memory_links.to_node_id = ?)
         ORDER BY memory_links.created_at DESC`
      )
      .all(nodeId, workspaceId, nodeId, nodeId) as unknown as Array<MemoryLink & {
      other_node_id: string;
      other_summary: string;
      other_source_path: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      from_node_id: row.from_node_id,
      to_node_id: row.to_node_id,
      other_node_id: row.other_node_id,
      relation_type: row.relation_type,
      confidence: row.confidence,
      reason: row.reason,
      created_at: row.created_at,
      other_summary: row.other_summary,
      other_source_path: row.other_source_path
    }));
  }

  inferMemoryLinksForNewNode(workspaceId: string, nodeId: string, actor = "agent:ingest"): MemoryLink[] {
    const node = this.getMemoryNode(workspaceId, nodeId);
    const nodeEmbedding = this.getNodeEmbeddings(nodeId).summary ?? [];
    const links: MemoryLink[] = [];
    const existingNodes = this.listMemoryNodes(workspaceId).filter((candidate) => candidate.id !== nodeId);

    for (const existing of existingNodes) {
      const similarity = unitSimilarity(
        cosineSimilarity(nodeEmbedding, this.getNodeEmbeddings(existing.id).summary ?? [])
      );
      const relation = classifyNodeRelation(existing, node, similarity);
      if (relation.relation === "new") continue;
      links.push(
        this.linkMemoryNodes(workspaceId, node.id, existing.id, relation.relation, {
          confidence: relation.confidence,
          reason: relation.reason,
          actor
        })
      );
    }

    return links;
  }

  findContradictions(workspaceId: string): ContradictionRecord[] {
    this.getWorkspace(workspaceId);
    return this.linksByRelation(workspaceId, "contradicts").map((link) => ({
      link,
      from_node: this.getMemoryNode(workspaceId, link.from_node_id),
      to_node: this.getMemoryNode(workspaceId, link.to_node_id)
    }));
  }

  findSupersededMemories(workspaceId: string): ContradictionRecord[] {
    this.getWorkspace(workspaceId);
    return this.linksByRelation(workspaceId, "supersedes").map((link) => ({
      link,
      from_node: this.getMemoryNode(workspaceId, link.from_node_id),
      to_node: this.getMemoryNode(workspaceId, link.to_node_id)
    }));
  }

  explainRecall(workspaceId: string, query: string, options: RecallOptions = {}): Promise<RecallResponse> {
    return this.recallMemory(workspaceId, query, {
      include_detail: true,
      include_why: true,
      include_links: true,
      include_contradictions: true,
      ...options
    });
  }

  async createBrief(workspaceId: string, request: BriefRequest): Promise<BriefResponse> {
    this.getWorkspace(workspaceId);
    const task = request.task.trim();
    if (!task) {
      throw new MemoryFSError("Brief task is required.");
    }

    const actor = request.actor ?? "agent:brief";
    const recall = await this.recallMemory(workspaceId, task, {
      limit: request.limit ?? 12,
      include_detail: true,
      include_raw: Boolean(request.include_raw),
      project_hint: request.project_hint,
      mode: request.mode ?? "task_preparation",
      include_contradictions: request.include_contradictions ?? true,
      include_links: true,
      include_trust: true,
      trust_levels: ["trusted", "reviewed", "source_backed", "agent_generated", "ephemeral"]
    });
    const results = request.include_recent_runs
      ? recall.results
      : recall.results.filter((result) => result.memory_type !== "run_summary");
    const sections = sectionBriefResults(results, request.include_open_questions ?? true);
    const contradictionWarnings = (request.include_contradictions ?? true)
      ? this.findContradictions(workspaceId)
          .slice(0, 5)
          .map((item) => `Contradiction: ${item.from_node.summary} conflicts with ${item.to_node.summary}`)
      : [];
    sections.warnings = [...new Set([...(recall.warnings ?? []), ...sections.warnings, ...contradictionWarnings])];
    const briefMarkdown = renderBriefMarkdown(task, request.project_hint, sections, results);
    let runId: string | undefined;

    if (request.create_run) {
      const run = await this.createRun(workspaceId, {
        task,
        actor,
        title: titleFromTask(task)
      });
      runId = run.id;
      await this.writeRunArtifact(workspaceId, run.id, "brief.md", briefMarkdown);
      await this.writeRunArtifact(workspaceId, run.id, "prompt.md", task);
      this.logRunEvent(workspaceId, run.id, "brief_created", {
        result_count: results.length,
        suggested_files: sections.suggested_files
      });
    }

    this.audit(workspaceId, actor, "brief_created", {
      task,
      project_hint: request.project_hint ?? null,
      run_id: runId ?? null,
      result_count: results.length
    });
    return {
      brief_markdown: briefMarkdown,
      sections,
      memory_results: results,
      run_id: runId
    };
  }

  async createRun(
    workspaceId: string,
    input: { task: string; actor?: string; title?: string }
  ): Promise<AgentRun> {
    this.getWorkspace(workspaceId);
    const task = input.task.trim();
    if (!task) {
      throw new MemoryFSError("Run task is required.");
    }

    const now = isoNow();
    const id = runIdFromDate(new Date(now));
    const run: AgentRun = {
      id,
      workspace_id: workspaceId,
      title: input.title?.trim() || titleFromTask(task),
      task,
      actor: input.actor ?? "agent:run",
      status: "created",
      started_at: now,
      completed_at: null,
      run_path: `/runs/${id}`,
      created_at: now
    };
    this.db
      .prepare(
        `INSERT INTO agent_runs
         (id, workspace_id, title, task, actor, status, started_at, completed_at, run_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.workspace_id,
        run.title,
        run.task,
        run.actor,
        run.status,
        run.started_at,
        run.completed_at,
        run.run_path,
        run.created_at
      );
    await this.ensureRunFolder(workspaceId, run);
    this.logRunEvent(workspaceId, run.id, "run_created", { task, actor: run.actor });
    this.audit(workspaceId, run.actor, "agent_run_created", {
      run_id: run.id,
      run_path: run.run_path,
      task
    });
    return run;
  }

  startRun(workspaceId: string, runId: string, actor = "agent:run"): AgentRun {
    const run = this.getRun(workspaceId, runId);
    this.db
      .prepare("UPDATE agent_runs SET status = ? WHERE workspace_id = ? AND id = ?")
      .run("running", workspaceId, runId);
    this.logRunEvent(workspaceId, runId, "run_started", { actor });
    return { ...run, status: "running" };
  }

  listRuns(workspaceId: string): AgentRun[] {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare("SELECT * FROM agent_runs WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as unknown as AgentRun[];
  }

  getRun(workspaceId: string, runId: string): AgentRun {
    this.getWorkspace(workspaceId);
    const run = this.db
      .prepare("SELECT * FROM agent_runs WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, runId) as AgentRun | undefined;
    if (!run) {
      throw new MemoryFSError("Run not found.", 404);
    }
    return run;
  }

  listRunEvents(workspaceId: string, runId: string): AgentRunEvent[] {
    this.getRun(workspaceId, runId);
    return this.db
      .prepare("SELECT * FROM agent_run_events WHERE workspace_id = ? AND run_id = ? ORDER BY created_at ASC")
      .all(workspaceId, runId) as unknown as AgentRunEvent[];
  }

  logRunEvent(workspaceId: string, runId: string, eventType: string, payload: unknown): AgentRunEvent {
    this.getRun(workspaceId, runId);
    const event: AgentRunEvent = {
      id: randomUUID(),
      workspace_id: workspaceId,
      run_id: runId,
      event_type: eventType,
      payload_json: JSON.stringify(payload),
      created_at: isoNow()
    };
    this.db
      .prepare(
        "INSERT INTO agent_run_events (id, workspace_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(event.id, event.workspace_id, event.run_id, event.event_type, event.payload_json, event.created_at);
    return event;
  }

  logMemoryUsage(
    workspaceId: string,
    runId: string,
    nodeId: string,
    usageType: RunMemoryUsageType = "recalled"
  ): RunMemoryUsage {
    const node = this.getMemoryNode(workspaceId, nodeId);
    this.getRun(workspaceId, runId);
    const usage: RunMemoryUsage = {
      id: randomUUID(),
      workspace_id: workspaceId,
      run_id: runId,
      memory_node_id: nodeId,
      source_path: node.source_path,
      usage_type: usageType,
      created_at: isoNow()
    };
    this.db
      .prepare(
        "INSERT INTO run_memory_usages (id, workspace_id, run_id, memory_node_id, source_path, usage_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        usage.id,
        usage.workspace_id,
        usage.run_id,
        usage.memory_node_id,
        usage.source_path,
        usage.usage_type,
        usage.created_at
      );
    this.logRunEvent(workspaceId, runId, "memory_used", {
      memory_node_id: nodeId,
      source_path: node.source_path,
      usage_type: usageType
    });
    return usage;
  }

  listRunMemoryUsage(workspaceId: string, runId: string): RunMemoryUsage[] {
    this.getRun(workspaceId, runId);
    return this.db
      .prepare("SELECT * FROM run_memory_usages WHERE workspace_id = ? AND run_id = ? ORDER BY created_at ASC")
      .all(workspaceId, runId) as unknown as RunMemoryUsage[];
  }

  async completeRun(
    workspaceId: string,
    runId: string,
    input: { result?: string; errors?: string; followups?: string; actor?: string; failed?: boolean } = {}
  ): Promise<AgentRun> {
    const run = this.getRun(workspaceId, runId);
    if (input.result) await this.writeRunArtifact(workspaceId, runId, "result.md", input.result);
    if (input.errors) await this.writeRunArtifact(workspaceId, runId, "errors.md", input.errors);
    if (input.followups) await this.writeRunArtifact(workspaceId, runId, "followups.md", input.followups);
    const status: AgentRunStatus = input.failed ? "failed" : "completed";
    const completedAt = isoNow();
    this.db
      .prepare("UPDATE agent_runs SET status = ?, completed_at = ? WHERE workspace_id = ? AND id = ?")
      .run(status, completedAt, workspaceId, runId);
    this.logRunEvent(workspaceId, runId, "run_completed", {
      actor: input.actor ?? run.actor,
      status
    });
    this.audit(workspaceId, input.actor ?? run.actor, "agent_run_completed", {
      run_id: runId,
      status
    });
    return { ...run, status, completed_at: completedAt };
  }

  async compileRun(
    workspaceId: string,
    runId: string,
    input: { actor?: string; create_promotions?: boolean } = {}
  ): Promise<CompileRunResponse> {
    const run = this.getRun(workspaceId, runId);
    const actor = input.actor ?? run.actor;
    const artifacts = await this.readRunArtifacts(workspaceId, run);
    const combined = [
      artifacts["result.md"],
      artifacts["errors.md"],
      artifacts["followups.md"],
      artifacts["actions.md"],
      artifacts["memory-used.md"]
    ]
      .filter(Boolean)
      .join("\n\n");
    const extracted = await extractMemoryNodesFromContent({
      content: combined || run.task,
      path: `/compiled-runs/${run.id}/result.md`,
      options: this.memoryOptions
    });
    const candidatesMarkdown = renderCandidatesMarkdown(extracted, run);
    await this.writeRunArtifact(workspaceId, runId, "candidates.md", candidatesMarkdown);
    const candidateFile = this.getFileByPath(workspaceId, `${run.run_path}/candidates.md`);
    const candidateNodes: MemoryNode[] = [];
    const suggestedPromotions: MemoryPromotion[] = [];

    for (const extractedNode of extracted) {
      const node = await this.insertRunCandidateMemoryNode(workspaceId, candidateFile, extractedNode, actor);
      candidateNodes.push(node);
      if ((input.create_promotions ?? true) && durableCandidateTypes.has(node.memory_type)) {
        suggestedPromotions.push(
          await this.promoteMemory(workspaceId, {
            source_path: `${run.run_path}/candidates.md`,
            target_path: targetPathForCandidate(node, run),
            source_node_id: node.id,
            actor,
            reason: `Suggested from compiled run ${runId}.`,
            require_review: true
          })
        );
      }
    }

    const followups = extractFollowups(artifacts["followups.md"] ?? combined);
    this.db
      .prepare("UPDATE agent_runs SET status = ? WHERE workspace_id = ? AND id = ?")
      .run("compiled", workspaceId, runId);
    this.logRunEvent(workspaceId, runId, "run_compiled", {
      candidate_count: candidateNodes.length,
      suggested_promotion_count: suggestedPromotions.length
    });
    this.audit(workspaceId, actor, "agent_run_compiled", {
      run_id: runId,
      candidate_count: candidateNodes.length,
      suggested_promotion_count: suggestedPromotions.length
    });
    return {
      candidate_nodes: candidateNodes,
      suggested_promotions: suggestedPromotions,
      contradictions: this.findContradictions(workspaceId),
      followups,
      summary: `Compiled ${candidateNodes.length} candidate memories from ${run.title}.`
    };
  }

  async createHandoff(
    workspaceId: string,
    input: { run_id?: string; project_hint?: string; actor?: string }
  ): Promise<{ handoff: HandoffSummary; path: string; content: string; node: MemoryNode | null }> {
    this.getWorkspace(workspaceId);
    const actor = input.actor ?? "agent:handoff";
    const run = input.run_id ? this.getRun(workspaceId, input.run_id) : null;
    const query = input.project_hint
      ? `handoff summary for ${input.project_hint}`
      : run
        ? `handoff summary for ${run.task}`
        : "handoff summary of current workspace";
    const recall = await this.recallMemory(workspaceId, query, {
      mode: "handoff",
      include_detail: true,
      include_trust: true,
      include_contradictions: true,
      project_hint: input.project_hint,
      limit: 10
    });
    const decisions = recall.results.filter((result) => result.memory_type === "decision").map((result) => result.summary);
    const openQuestions = recall.results.filter((result) => result.memory_type === "unresolved_question").map((result) => result.summary);
    const nextActions = recall.results.filter((result) => result.memory_type === "task").map((result) => result.summary);
    const summary = handoffSummaryText(run, input.project_hint, recall.results);
    const content = renderHandoffMarkdown(summary, decisions, openQuestions, nextActions, recall.warnings ?? []);
    const safeProject = input.project_hint ? slugify(input.project_hint) : "workspace";
    const filePath = run ? `${run.run_path}/handoff.md` : `/handoffs/${timestampSlug()}-${safeProject}.md`;
    await this.writeFile(workspaceId, filePath, content, {
      actor,
      ingest: true,
      allow_protected_write: true
    });
    const handoff: HandoffSummary = {
      id: randomUUID(),
      workspace_id: workspaceId,
      run_id: run?.id ?? null,
      project_hint: input.project_hint ?? null,
      summary,
      open_questions_json: JSON.stringify(openQuestions),
      decisions_json: JSON.stringify(decisions),
      next_actions_json: JSON.stringify(nextActions),
      created_at: isoNow()
    };
    this.db
      .prepare(
        `INSERT INTO handoff_summaries
         (id, workspace_id, run_id, project_hint, summary, open_questions_json, decisions_json, next_actions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        handoff.id,
        handoff.workspace_id,
        handoff.run_id,
        handoff.project_hint,
        handoff.summary,
        handoff.open_questions_json,
        handoff.decisions_json,
        handoff.next_actions_json,
        handoff.created_at
      );
    const node = this.listMemoryNodes(workspaceId).find((entry) => entry.source_path === filePath) ?? null;
    this.audit(workspaceId, actor, "handoff_created", {
      run_id: run?.id ?? null,
      project_hint: input.project_hint ?? null,
      path: filePath
    });
    return { handoff, path: filePath, content, node };
  }

  listHandoffs(workspaceId: string): HandoffSummary[] {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare("SELECT * FROM handoff_summaries WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as unknown as HandoffSummary[];
  }

  listStaleMemory(workspaceId: string): StaleMemoryCandidate[] {
    this.getWorkspace(workspaceId);
    return this.listMemoryNodes(workspaceId)
      .map((node) => ({ node, reasons: staleReasonsForNode(node, this.nodeHasBeenUsed(node.id), this.sourceExists(node)) }))
      .filter((candidate) => candidate.reasons.length > 0);
  }

  reviewStaleMemory(
    workspaceId: string,
    input: { node_ids?: string[]; reviewer?: string; comment?: string }
  ): { reviewed: number; candidates: StaleMemoryCandidate[] } {
    const candidates = this.listStaleMemory(workspaceId);
    const ids = new Set(input.node_ids ?? candidates.map((candidate) => candidate.node.id));
    let reviewed = 0;
    for (const candidate of candidates) {
      if (!ids.has(candidate.node.id)) continue;
      this.insertReview(
        workspaceId,
        null,
        candidate.node.id,
        "stale_review",
        input.reviewer ?? "human:reviewer",
        input.comment ?? candidate.reasons.join(", ")
      );
      reviewed += 1;
    }
    this.audit(workspaceId, input.reviewer ?? "human:reviewer", "stale_memory_reviewed", {
      reviewed,
      node_ids: [...ids]
    });
    return { reviewed, candidates };
  }

  async promoteMemory(workspaceId: string, request: PromoteMemoryRequest): Promise<MemoryPromotion> {
    this.getWorkspace(workspaceId);
    const actor = request.actor ?? "agent:promotion";
    this.ensureAuthorized(workspaceId, actor, "memory.promote", request.target_path);
    const sourcePath = normalizeMemoryPath(request.source_path);
    const targetPath = normalizeMemoryPath(request.target_path);
    if (targetPath === "/") {
      throw new MemoryFSError("Promotion target path cannot be the workspace root.");
    }

    const { file, content } = await this.readFile(workspaceId, sourcePath);
    const sourceNode = request.source_node_id ? this.getMemoryNode(workspaceId, request.source_node_id) : null;
    if (sourceNode && sourceNode.source_file_id !== file.id) {
      throw new MemoryFSError("Promotion source_node_id must belong to source_path.");
    }

    const protectedTarget = this.matchProtectedPath(workspaceId, targetPath);
    const requireReview = request.require_review ?? Boolean(protectedTarget);
    const proposed = sourceNode
      ? extractedFromMemoryNode(sourceNode, request.proposed_memory_type)
      : proposedNodeFromContent(content, sourcePath, request.proposed_memory_type);
    const candidateNode = await this.insertCandidateMemoryNode(workspaceId, file, proposed, actor);
    if (sourceNode) {
      this.linkMemoryNodes(workspaceId, candidateNode.id, sourceNode.id, "promoted_from", {
        confidence: 0.85,
        reason: `Candidate promotion from ${sourcePath} to ${targetPath}.`,
        actor
      });
    }

    const now = isoNow();
    const promotion: MemoryPromotion = {
      id: randomUUID(),
      workspace_id: workspaceId,
      source_path: sourcePath,
      target_path: targetPath,
      source_node_id: sourceNode?.id ?? null,
      proposed_node_json: JSON.stringify({
        ...proposed,
        source_path: sourcePath,
        target_path: targetPath,
        candidate_node_id: candidateNode.id,
        protected_target: Boolean(protectedTarget)
      }),
      status: requireReview ? "pending" : "approved",
      actor,
      reviewer: null,
      reason: request.reason ?? null,
      append: request.append === false ? 0 : 1,
      candidate_node_id: candidateNode.id,
      created_at: now,
      updated_at: now
    };

    this.db
      .prepare(
        `INSERT INTO memory_promotions
         (id, workspace_id, source_path, target_path, source_node_id, proposed_node_json, status, actor, reviewer, reason, append, candidate_node_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        promotion.id,
        promotion.workspace_id,
        promotion.source_path,
        promotion.target_path,
        promotion.source_node_id,
        promotion.proposed_node_json,
        promotion.status,
        promotion.actor,
        promotion.reviewer,
        promotion.reason,
        promotion.append,
        promotion.candidate_node_id,
        promotion.created_at,
        promotion.updated_at
      );
    this.audit(workspaceId, actor, "memory_promotion_created", {
      promotion_id: promotion.id,
      source_path: sourcePath,
      target_path: targetPath,
      status: promotion.status,
      protected_target: Boolean(protectedTarget),
      candidate_node_id: candidateNode.id
    });

    if (!requireReview) {
      return this.applyPromotion(workspaceId, promotion.id, actor);
    }

    return promotion;
  }

  listPromotions(workspaceId: string): MemoryPromotion[] {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare("SELECT * FROM memory_promotions WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as unknown as MemoryPromotion[];
  }

  getPromotion(workspaceId: string, promotionId: string): MemoryPromotion {
    this.getWorkspace(workspaceId);
    const promotion = this.db
      .prepare("SELECT * FROM memory_promotions WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, promotionId) as MemoryPromotion | undefined;
    if (!promotion) {
      throw new MemoryFSError("Promotion not found.", 404);
    }
    return promotion;
  }

  async approvePromotion(
    workspaceId: string,
    promotionId: string,
    reviewer = "human:reviewer",
    comment?: string,
    apply = true
  ): Promise<MemoryPromotion> {
    const promotion = this.getPromotion(workspaceId, promotionId);
    if (promotion.status === "rejected") {
      throw new MemoryFSError("Rejected promotions cannot be approved.");
    }

    this.updatePromotionStatus(workspaceId, promotionId, "approved", reviewer);
    this.insertReview(workspaceId, promotionId, promotion.candidate_node_id, "approved", reviewer, comment);
    this.audit(workspaceId, reviewer, "memory_promotion_approved", {
      promotion_id: promotionId,
      comment: comment ?? null
    });

    if (promotion.candidate_node_id) {
      this.markMemoryNodeTrust(workspaceId, promotion.candidate_node_id, "reviewed", "active");
    }

    return apply ? this.applyPromotion(workspaceId, promotionId, reviewer) : this.getPromotion(workspaceId, promotionId);
  }

  rejectPromotion(workspaceId: string, promotionId: string, reviewer = "human:reviewer", comment?: string): MemoryPromotion {
    const promotion = this.getPromotion(workspaceId, promotionId);
    if (promotion.status === "applied") {
      throw new MemoryFSError("Applied promotions cannot be rejected.");
    }

    this.updatePromotionStatus(workspaceId, promotionId, "rejected", reviewer);
    this.insertReview(workspaceId, promotionId, promotion.candidate_node_id, "rejected", reviewer, comment);
    if (promotion.candidate_node_id) {
      this.markMemoryNodeTrust(workspaceId, promotion.candidate_node_id, "rejected", "rejected");
    }
    this.audit(workspaceId, reviewer, "memory_promotion_rejected", {
      promotion_id: promotionId,
      comment: comment ?? null
    });
    return this.getPromotion(workspaceId, promotionId);
  }

  async applyPromotion(workspaceId: string, promotionId: string, actor = "human:reviewer"): Promise<MemoryPromotion> {
    const promotion = this.getPromotion(workspaceId, promotionId);
    if (promotion.status === "rejected") {
      throw new MemoryFSError("Rejected promotions cannot be applied.");
    }
    const protectedTarget = this.matchProtectedPath(workspaceId, promotion.target_path);
    if (protectedTarget && promotion.status !== "approved" && promotion.status !== "applied") {
      throw new MemoryFSError("Protected promotion targets require approval before apply.", 403);
    }
    if (promotion.status === "applied") {
      return promotion;
    }

    const proposed = parseJson<ExtractedMemoryNode>(promotion.proposed_node_json);
    const block = promotionBlock(promotion, proposed);
    let nextContent = block;
    if (promotion.append) {
      try {
        const existing = await this.readFile(workspaceId, promotion.target_path);
        nextContent = `${existing.content.trimEnd()}\n\n${block}`;
      } catch {
        nextContent = block;
      }
    }

    const targetFile = await this.writeFile(workspaceId, promotion.target_path, nextContent, {
      actor,
      ingest: true,
      allow_protected_write: true
    });
    this.db
      .prepare("UPDATE memory_nodes SET trust_level = ?, status = ?, updated_at = ? WHERE source_file_id = ?")
      .run("trusted", "active", isoNow(), targetFile.id);
    if (promotion.candidate_node_id) {
      this.markMemoryNodeTrust(workspaceId, promotion.candidate_node_id, "trusted", "active");
    }
    this.updatePromotionStatus(workspaceId, promotionId, "applied", actor);
    this.audit(workspaceId, actor, "memory_promotion_applied", {
      promotion_id: promotionId,
      source_path: promotion.source_path,
      target_path: promotion.target_path,
      candidate_node_id: promotion.candidate_node_id
    });
    return this.getPromotion(workspaceId, promotionId);
  }

  createSnapshot(
    workspaceId: string,
    input: { name: string; description?: string; actor?: string }
  ): Snapshot {
    this.getWorkspace(workspaceId);
    this.ensureAuthorized(workspaceId, input.actor ?? "human:snapshot", "snapshot.create");
    const name = input.name.trim();
    if (!name) {
      throw new MemoryFSError("Snapshot name is required.");
    }

    const snapshot: Snapshot = {
      id: randomUUID(),
      workspace_id: workspaceId,
      name,
      description: input.description ?? null,
      created_by: input.actor ?? "human:snapshot",
      created_at: isoNow()
    };
    this.db
      .prepare("INSERT INTO snapshots (id, workspace_id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(snapshot.id, snapshot.workspace_id, snapshot.name, snapshot.description, snapshot.created_by, snapshot.created_at);

    for (const item of this.currentSnapshotItems(workspaceId, snapshot.id)) {
      this.db
        .prepare("INSERT INTO snapshot_items (id, snapshot_id, item_type, item_id, item_json) VALUES (?, ?, ?, ?, ?)")
        .run(item.id, item.snapshot_id, item.item_type, item.item_id, item.item_json);
    }
    this.audit(workspaceId, snapshot.created_by, "snapshot_created", {
      snapshot_id: snapshot.id,
      name: snapshot.name
    });
    this.recordSyncEvent(workspaceId, "snapshots", snapshot.id, "upsert", snapshot, snapshot.created_by, snapshot.created_at);
    return snapshot;
  }

  listSnapshots(workspaceId: string): Snapshot[] {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare("SELECT * FROM snapshots WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as unknown as Snapshot[];
  }

  getSnapshot(workspaceId: string, snapshotId: string): Snapshot & { items: SnapshotItem[] } {
    this.getWorkspace(workspaceId);
    const snapshot = this.db
      .prepare("SELECT * FROM snapshots WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, snapshotId) as Snapshot | undefined;
    if (!snapshot) {
      throw new MemoryFSError("Snapshot not found.", 404);
    }
    const items = this.db
      .prepare("SELECT * FROM snapshot_items WHERE snapshot_id = ? ORDER BY item_type, item_id")
      .all(snapshotId) as unknown as SnapshotItem[];
    return { ...snapshot, items };
  }

  diffSnapshot(workspaceId: string, snapshotId: string): SnapshotDiff {
    const snapshot = this.getSnapshot(workspaceId, snapshotId);
    const current = this.currentSnapshotItems(workspaceId, snapshotId);
    return diffSnapshotItems(snapshot.id, snapshot.items, current);
  }

  async rollbackSnapshot(
    workspaceId: string,
    snapshotId: string,
    input: { dry_run?: boolean; actor?: string } = {}
  ): Promise<RollbackResult> {
    const snapshot = this.getSnapshot(workspaceId, snapshotId);
    this.ensureAuthorized(workspaceId, input.actor ?? "human:rollback", "snapshot.rollback");
    const diff = this.diffSnapshot(workspaceId, snapshotId);
    if (input.dry_run) {
      return {
        snapshot_id: snapshotId,
        dry_run: true,
        diff,
        restored: false
      };
    }

    await this.restoreSnapshotItems(workspaceId, snapshot.items);
    this.audit(workspaceId, input.actor ?? "human:rollback", "snapshot_rollback", {
      snapshot_id: snapshot.id,
      name: snapshot.name,
      diff
    });
    return {
      snapshot_id: snapshotId,
      dry_run: false,
      diff,
      restored: true
    };
  }

  recomputeMemoryHealth(workspaceId: string): MemoryHealthReport {
    this.getWorkspace(workspaceId);
    const rows = this.db
      .prepare(
        `SELECT memory_nodes.*,
                files.id AS joined_file_id,
                files.path AS joined_source_path,
                blobs.sha256 AS joined_blob_sha256,
                blobs.storage_path AS joined_blob_storage_path,
                blobs.content_text AS joined_blob_content_text
         FROM memory_nodes
         LEFT JOIN files ON files.id = memory_nodes.source_file_id
         LEFT JOIN blobs ON blobs.sha256 = memory_nodes.source_blob_sha256
         WHERE memory_nodes.workspace_id = ?`
      )
      .all(workspaceId) as Array<Record<string, unknown>>;
    const total = rows.length;
    const validSourceCount = rows.filter((row) => row.joined_file_id && row.joined_blob_sha256).length;
    const orphanNodeCount = rows.filter((row) => !row.joined_file_id || !row.joined_blob_sha256).length;
    const rawMissingCount = rows.filter((row) => {
      if (!row.joined_blob_sha256) return true;
      if (row.joined_blob_content_text !== null && row.joined_blob_content_text !== undefined) return false;
      const storagePath = typeof row.joined_blob_storage_path === "string" ? row.joined_blob_storage_path : "";
      return !storagePath || !existsSync(path.join(this.dataDir, storagePath));
    }).length;
    const staleNodeCount = rows.filter((row) => {
      const ttl = typeof row.ttl_expires_at === "string" ? row.ttl_expires_at : null;
      return ttl ? new Date(ttl).getTime() < Date.now() : false;
    }).length;
    const rejectedNodeCount = rows.filter((row) => row.status === "rejected" || row.trust_level === "rejected").length;
    const lowConfidenceCount = rows.filter((row) => Number(row.confidence) < 0.55).length;
    const unresolvedPromotionCount = Number(
      (this.db
        .prepare("SELECT COUNT(*) AS count FROM memory_promotions WHERE workspace_id = ? AND status IN ('pending', 'approved')")
        .get(workspaceId) as { count: number }).count
    );
    const contradictionCount = this.findContradictions(workspaceId).length;
    const unreviewedTrustedPathWrites = this.listAuditEvents(workspaceId, 1000).filter((event) => {
      if (event.event_type !== "file_write" || !event.actor.startsWith("agent:")) return false;
      const payload = parseJson<{ protected?: boolean }>(event.payload_json);
      return Boolean(payload.protected);
    }).length;
    const sourceCoverage = total === 0 ? 100 : Math.round((validSourceCount / total) * 100);
    const overallScore = clampScore(
      sourceCoverage -
        contradictionCount * 8 -
        unresolvedPromotionCount * 4 -
        staleNodeCount * 3 -
        rejectedNodeCount * 2 -
        lowConfidenceCount * 2 -
        orphanNodeCount * 12 -
        rawMissingCount * 10 -
        unreviewedTrustedPathWrites * 10
    );
    const report: MemoryHealthReport = {
      id: randomUUID(),
      workspace_id: workspaceId,
      source_coverage: sourceCoverage,
      contradiction_count: contradictionCount,
      unresolved_promotion_count: unresolvedPromotionCount,
      stale_node_count: staleNodeCount,
      rejected_node_count: rejectedNodeCount,
      low_confidence_count: lowConfidenceCount,
      orphan_node_count: orphanNodeCount,
      raw_missing_count: rawMissingCount,
      unreviewed_trusted_path_writes: unreviewedTrustedPathWrites,
      overall_score: overallScore,
      created_at: isoNow()
    };
    this.db
      .prepare("INSERT INTO memory_health_reports (id, workspace_id, report_json, overall_score, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(report.id, workspaceId, JSON.stringify(report), report.overall_score, report.created_at);
    this.audit(workspaceId, "system", "memory_health_recomputed", {
      report_id: report.id,
      overall_score: report.overall_score
    });
    return report;
  }

  getMemoryHealth(workspaceId: string): MemoryHealthReport {
    this.getWorkspace(workspaceId);
    const row = this.db
      .prepare("SELECT report_json FROM memory_health_reports WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(workspaceId) as { report_json: string } | undefined;
    return row ? parseJson<MemoryHealthReport>(row.report_json) : this.recomputeMemoryHealth(workspaceId);
  }

  private async insertExtractedMemoryNode(
    workspaceId: string,
    file: FileRecord,
    extractedNode: ExtractedMemoryNode,
    actor: string,
    sourceLocation?: Record<string, unknown>
  ): Promise<MemoryNode | null> {
    const summaryEmbedding = await embedText(extractedNode.summary, this.memoryOptions);
    const dedupe = this.classifyDedupe(workspaceId, extractedNode, summaryEmbedding);

    const now = isoNow();
    const nodeId = randomUUID();
    const rawRef = `memoryfs://${workspaceId}${file.path}#${file.current_blob_sha256}`;
    const trustLevel = trustLevelForPath(file.path);
    const ttlExpiresAt = ttlForPath(file.path);
    this.db
      .prepare(
        `INSERT INTO memory_nodes
         (id, workspace_id, source_file_id, source_blob_sha256, summary, trigger, detail, raw_excerpt, raw_ref, source_location_json, tags_json, memory_type, importance, confidence, trust_level, status, ttl_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nodeId,
        workspaceId,
        file.id,
        file.current_blob_sha256,
        extractedNode.summary,
        extractedNode.trigger,
        extractedNode.detail,
        extractedNode.raw_excerpt,
        rawRef,
        sourceLocation ? JSON.stringify(sourceLocation) : null,
        JSON.stringify(extractedNode.tags),
        extractedNode.memory_type,
        extractedNode.importance,
        extractedNode.confidence,
        trustLevel,
        "active",
        ttlExpiresAt,
        now,
        now
      );

    await this.storeEmbedding(workspaceId, nodeId, "summary", summaryEmbedding);
    await this.storeEmbedding(workspaceId, nodeId, "trigger", await embedText(extractedNode.trigger, this.memoryOptions));
    await this.storeEmbedding(workspaceId, nodeId, "detail", await embedText(extractedNode.detail, this.memoryOptions));
    await this.storeEmbedding(
      workspaceId,
      nodeId,
      "raw_excerpt",
      await embedText(extractedNode.raw_excerpt, this.memoryOptions)
    );

    if (dedupe.relation === "duplicate" && dedupe.nodeId) {
      this.linkMemoryNodes(workspaceId, nodeId, dedupe.nodeId, "duplicates", {
        confidence: dedupe.confidence,
        reason: dedupe.reason,
        actor
      });
    }

    if (dedupe.relation === "update" && dedupe.nodeId) {
      this.linkMemoryNodes(workspaceId, nodeId, dedupe.nodeId, "supersedes", {
        confidence: dedupe.confidence,
        reason: dedupe.reason,
        actor
      });
    }

    if (dedupe.relation === "contradiction" && dedupe.nodeId) {
      this.linkMemoryNodes(workspaceId, nodeId, dedupe.nodeId, "contradicts", {
        confidence: dedupe.confidence,
        reason: dedupe.reason,
        actor
      });
    }

    if (dedupe.relation === "new") {
      for (const link of this.inferMemoryLinksForNewNode(workspaceId, nodeId, actor)) {
        if (link.relation_type !== "related_to") continue;
      }
    }

    this.audit(workspaceId, actor, "memory_node_created", {
      node_id: nodeId,
      source_file_id: file.id,
      source_path: file.path,
      source_location: sourceLocation ?? null,
      memory_type: extractedNode.memory_type,
      importance: extractedNode.importance,
      trust_level: trustLevel,
      status: "active",
      dedupe_relation: dedupe.relation,
      matched_node_id: dedupe.nodeId ?? null
    });

    const createdNode = this.getMemoryNode(workspaceId, nodeId);
    this.recordSyncEvent(workspaceId, "memory_nodes", nodeId, "upsert", createdNode, actor, createdNode.updated_at);
    return createdNode;
  }

  private classifyDedupe(
    workspaceId: string,
    candidate: ExtractedMemoryNode,
    candidateEmbedding: number[]
  ): { relation: "new" | "duplicate" | "update" | "contradiction"; nodeId?: string; confidence: number; reason: string } {
    const existingNodes = this.listMemoryNodes(workspaceId);
    let best: { node: MemoryNode; similarity: number } | null = null;

    for (const node of existingNodes) {
      if (node.summary.trim().toLowerCase() === candidate.summary.trim().toLowerCase()) {
        return {
          relation: "duplicate",
          nodeId: node.id,
          confidence: 0.99,
          reason: "The memory summary exactly matches an existing memory."
        };
      }

      const embeddings = this.getNodeEmbeddings(node.id);
      const similarity = unitSimilarity(cosineSimilarity(candidateEmbedding, embeddings.summary ?? []));
      if (!best || similarity > best.similarity) {
        best = { node, similarity };
      }
    }

    if (!best || best.similarity < 0.9) {
      return { relation: "new", confidence: 0.6, reason: "No sufficiently similar existing memory was found." };
    }

    const relation = classifyNodeRelation(best.node, memoryNodeFromExtracted(candidate), best.similarity);
    if (relation.relation === "duplicates") {
      return { relation: "duplicate", nodeId: best.node.id, confidence: relation.confidence, reason: relation.reason };
    }

    if (relation.relation === "contradicts") {
      return { relation: "contradiction", nodeId: best.node.id, confidence: relation.confidence, reason: relation.reason };
    }

    if (relation.relation === "supersedes") {
      return { relation: "update", nodeId: best.node.id, confidence: relation.confidence, reason: relation.reason };
    }

    return {
      relation: "update",
      nodeId: best.node.id,
      confidence: Math.max(0.7, best.similarity),
      reason: "The memory is highly similar and appears to update an existing memory."
    };
  }

  private async insertCandidateMemoryNode(
    workspaceId: string,
    file: FileRecord,
    extractedNode: ExtractedMemoryNode,
    actor: string
  ): Promise<MemoryNode> {
    const now = isoNow();
    const nodeId = randomUUID();
    const rawRef = `memoryfs://${workspaceId}${file.path}#${file.current_blob_sha256}`;
    this.db
      .prepare(
        `INSERT INTO memory_nodes
         (id, workspace_id, source_file_id, source_blob_sha256, summary, trigger, detail, raw_excerpt, raw_ref, source_location_json, tags_json, memory_type, importance, confidence, trust_level, status, ttl_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nodeId,
        workspaceId,
        file.id,
        file.current_blob_sha256,
        extractedNode.summary,
        extractedNode.trigger,
        extractedNode.detail,
        extractedNode.raw_excerpt,
        rawRef,
        null,
        JSON.stringify(extractedNode.tags),
        extractedNode.memory_type,
        extractedNode.importance,
        extractedNode.confidence,
        "agent_generated",
        "pending",
        null,
        now,
        now
      );
    await this.storeEmbedding(workspaceId, nodeId, "summary", await embedText(extractedNode.summary, this.memoryOptions));
    await this.storeEmbedding(workspaceId, nodeId, "trigger", await embedText(extractedNode.trigger, this.memoryOptions));
    await this.storeEmbedding(workspaceId, nodeId, "detail", await embedText(extractedNode.detail, this.memoryOptions));
    await this.storeEmbedding(workspaceId, nodeId, "raw_excerpt", await embedText(extractedNode.raw_excerpt, this.memoryOptions));
    this.audit(workspaceId, actor, "memory_candidate_created", {
      node_id: nodeId,
      source_path: file.path,
      memory_type: extractedNode.memory_type
    });
    return this.getMemoryNode(workspaceId, nodeId);
  }

  private async insertRunCandidateMemoryNode(
    workspaceId: string,
    file: FileRecord,
    extractedNode: ExtractedMemoryNode,
    actor: string
  ): Promise<MemoryNode> {
    const now = isoNow();
    const nodeId = randomUUID();
    const rawRef = `memoryfs://${workspaceId}${file.path}#${file.current_blob_sha256}`;
    this.db
      .prepare(
        `INSERT INTO memory_nodes
         (id, workspace_id, source_file_id, source_blob_sha256, summary, trigger, detail, raw_excerpt, raw_ref, source_location_json, tags_json, memory_type, importance, confidence, trust_level, status, ttl_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nodeId,
        workspaceId,
        file.id,
        file.current_blob_sha256,
        extractedNode.summary,
        extractedNode.trigger,
        extractedNode.detail,
        extractedNode.raw_excerpt,
        rawRef,
        null,
        JSON.stringify(extractedNode.tags),
        extractedNode.memory_type,
        extractedNode.importance,
        extractedNode.confidence,
        "agent_generated",
        "active",
        null,
        now,
        now
      );
    await this.storeEmbedding(workspaceId, nodeId, "summary", await embedText(extractedNode.summary, this.memoryOptions));
    await this.storeEmbedding(workspaceId, nodeId, "trigger", await embedText(extractedNode.trigger, this.memoryOptions));
    await this.storeEmbedding(workspaceId, nodeId, "detail", await embedText(extractedNode.detail, this.memoryOptions));
    await this.storeEmbedding(workspaceId, nodeId, "raw_excerpt", await embedText(extractedNode.raw_excerpt, this.memoryOptions));
    this.inferMemoryLinksForNewNode(workspaceId, nodeId, actor);
    this.audit(workspaceId, actor, "run_candidate_memory_created", {
      node_id: nodeId,
      source_path: file.path,
      memory_type: extractedNode.memory_type
    });
    return this.getMemoryNode(workspaceId, nodeId);
  }

  private async ensureRunFolder(workspaceId: string, run: AgentRun): Promise<void> {
    const artifacts: Record<string, string> = {
      "prompt.md": run.task,
      "brief.md": "",
      "plan.md": "",
      "actions.md": "",
      "files-read.md": "",
      "memory-used.md": "",
      "result.md": "",
      "errors.md": "",
      "followups.md": "",
      "candidates.md": ""
    };
    for (const [name, content] of Object.entries(artifacts)) {
      await this.writeRunArtifact(workspaceId, run.id, name, content);
    }
  }

  private async writeRunArtifact(
    workspaceId: string,
    runId: string,
    artifactName: string,
    content: string
  ): Promise<FileRecord> {
    const run = this.getRun(workspaceId, runId);
    return this.writeFile(workspaceId, `${run.run_path}/${artifactName}`, content, {
      actor: run.actor,
      ingest: false,
      allow_protected_write: true
    });
  }

  private async appendRunArtifact(
    workspaceId: string,
    runId: string,
    artifactName: string,
    content: string
  ): Promise<void> {
    if (!content.trim()) return;
    const run = this.getRun(workspaceId, runId);
    const artifactPath = `${run.run_path}/${artifactName}`;
    let existing = "";
    try {
      existing = (await this.readFile(workspaceId, artifactPath)).content;
    } catch {
      existing = "";
    }
    await this.writeRunArtifact(workspaceId, runId, artifactName, `${existing.trimEnd()}\n${content}`.trimStart());
  }

  private async readRunArtifacts(workspaceId: string, run: AgentRun): Promise<Record<string, string>> {
    const artifacts: Record<string, string> = {};
    for (const name of runArtifactNames) {
      try {
        artifacts[name] = (await this.readFile(workspaceId, `${run.run_path}/${name}`)).content;
      } catch {
        artifacts[name] = "";
      }
    }
    return artifacts;
  }

  private nodeHasBeenUsed(nodeId: string): boolean {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM run_memory_usages WHERE memory_node_id = ?").get(nodeId) as
      | { count: number }
      | undefined;
    return Number(row?.count ?? 0) > 0;
  }

  private sourceExists(node: MemoryNode): boolean {
    try {
      this.getFileByPath(node.workspace_id, node.source_path);
      this.getBlob(node.source_blob_sha256);
      return true;
    } catch {
      return false;
    }
  }

  private markMemoryNodeTrust(
    workspaceId: string,
    nodeId: string,
    trustLevel: MemoryTrustLevel,
    status: MemoryNodeStatus
  ): void {
    this.getMemoryNode(workspaceId, nodeId);
    this.db
      .prepare("UPDATE memory_nodes SET trust_level = ?, status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?")
      .run(trustLevel, status, isoNow(), workspaceId, nodeId);
  }

  private updatePromotionStatus(
    workspaceId: string,
    promotionId: string,
    status: PromotionStatus,
    reviewer: string
  ): void {
    this.db
      .prepare("UPDATE memory_promotions SET status = ?, reviewer = ?, updated_at = ? WHERE workspace_id = ? AND id = ?")
      .run(status, reviewer, isoNow(), workspaceId, promotionId);
  }

  private insertReview(
    workspaceId: string,
    promotionId: string | null,
    nodeId: string | null,
    status: string,
    reviewer: string,
    comment?: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO memory_reviews
         (id, workspace_id, promotion_id, node_id, status, reviewer, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), workspaceId, promotionId, nodeId, status, reviewer, comment ?? null, isoNow());
  }

  private currentSnapshotItems(workspaceId: string, snapshotId: string): SnapshotItem[] {
    const items: SnapshotItem[] = [];
    const push = (itemType: SnapshotItemType, itemId: string, item: unknown) => {
      items.push({
        id: randomUUID(),
        snapshot_id: snapshotId,
        item_type: itemType,
        item_id: itemId,
        item_json: JSON.stringify(item)
      });
    };

    const files = this.db.prepare("SELECT * FROM files WHERE workspace_id = ?").all(workspaceId) as unknown as FileRecord[];
    for (const file of files) push("file", file.id, file);

    const extractedSources = this.db
      .prepare("SELECT * FROM extracted_sources WHERE workspace_id = ?")
      .all(workspaceId) as unknown as ExtractedSource[];
    for (const source of extractedSources) push("extracted_source", source.id, source);

    const fileArtifacts = this.db
      .prepare("SELECT * FROM file_artifacts WHERE workspace_id = ?")
      .all(workspaceId) as unknown as FileArtifact[];
    for (const artifact of fileArtifacts) push("file_artifact", artifact.id, artifact);

    const nodes = this.db.prepare("SELECT * FROM memory_nodes WHERE workspace_id = ?").all(workspaceId) as unknown as MemoryNodeRow[];
    for (const node of nodes) push("memory_node", node.id, node);

    const links = this.db.prepare("SELECT * FROM memory_links WHERE workspace_id = ?").all(workspaceId) as unknown as MemoryLink[];
    for (const link of links) push("memory_link", link.id, link);

    const protectedPaths = this.db
      .prepare("SELECT * FROM protected_paths WHERE workspace_id = ?")
      .all(workspaceId) as Array<Record<string, unknown> & { id: string }>;
    for (const protectedPath of protectedPaths) push("protected_path", protectedPath.id, protectedPath);

    const blobHashes = new Set<string>();
    for (const file of files) blobHashes.add(file.current_blob_sha256);
    for (const node of nodes) blobHashes.add(node.source_blob_sha256);
    for (const sha256 of blobHashes) {
      const blob = this.getBlob(sha256);
      const bytes = blob.content_text !== null
        ? Buffer.from(blob.content_text, "utf8")
        : existsSync(path.join(this.dataDir, blob.storage_path))
          ? readFileSync(path.join(this.dataDir, blob.storage_path))
          : Buffer.from("");
      push("blob", blob.sha256, {
        ...blob,
        content_base64: bytes.toString("base64")
      });
    }

    return items;
  }

  private async restoreSnapshotItems(workspaceId: string, items: SnapshotItem[]): Promise<void> {
    const grouped = groupSnapshotItems(items);
    this.db.prepare("DELETE FROM memory_links WHERE workspace_id = ?").run(workspaceId);
    this.db.prepare("DELETE FROM memory_embeddings WHERE workspace_id = ?").run(workspaceId);
    this.db.prepare("DELETE FROM memory_nodes WHERE workspace_id = ?").run(workspaceId);
    this.db.prepare("DELETE FROM file_artifacts WHERE workspace_id = ?").run(workspaceId);
    this.db.prepare("DELETE FROM extracted_sources WHERE workspace_id = ?").run(workspaceId);
    this.db.prepare("DELETE FROM files WHERE workspace_id = ?").run(workspaceId);
    this.db.prepare("DELETE FROM protected_paths WHERE workspace_id = ?").run(workspaceId);

    for (const item of grouped.blob) {
      const blob = parseJson<BlobRecord & { content_base64?: string }>(item.item_json);
      this.db
        .prepare(
          "INSERT OR REPLACE INTO blobs (sha256, storage_path, content_text, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(blob.sha256, blob.storage_path, blob.content_text, blob.mime_type, blob.size_bytes, blob.created_at);
      const bytes = blob.content_base64 ? Buffer.from(blob.content_base64, "base64") : Buffer.from(blob.content_text ?? "", "utf8");
      const absoluteStoragePath = path.join(this.dataDir, blob.storage_path);
      await mkdir(path.dirname(absoluteStoragePath), { recursive: true });
      await writeFile(absoluteStoragePath, bytes);
    }

    await rm(path.join(this.workspacesDir, workspaceId), { recursive: true, force: true });
    for (const item of grouped.file) {
      const file = parseJson<FileRecord>(item.item_json);
      this.db
        .prepare(
          "INSERT INTO files (id, workspace_id, path, current_blob_sha256, mime_type, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
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
      const blob = this.getBlob(file.current_blob_sha256);
      const content = await this.readBlobContent(blob);
      await this.writeWorkspaceFile(workspaceId, file.path, Buffer.from(content, "utf8"));
    }

    for (const item of grouped.protected_path) {
      const protectedPath = parseJson<{ id: string; workspace_id: string; path_glob: string; rule_type: string; created_at: string }>(
        item.item_json
      );
      this.db
        .prepare("INSERT INTO protected_paths (id, workspace_id, path_glob, rule_type, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(protectedPath.id, protectedPath.workspace_id, protectedPath.path_glob, protectedPath.rule_type, protectedPath.created_at);
    }

    for (const item of grouped.extracted_source) {
      const source = parseJson<ExtractedSource>(item.item_json);
      this.db
        .prepare(
          `INSERT INTO extracted_sources
           (id, workspace_id, file_id, blob_sha256, extractor_name, extractor_version, content_text, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          source.id,
          source.workspace_id,
          source.file_id,
          source.blob_sha256,
          source.extractor_name,
          source.extractor_version,
          source.content_text,
          source.metadata_json,
          source.created_at
        );
    }

    for (const item of grouped.file_artifact) {
      const artifact = parseJson<FileArtifact>(item.item_json);
      this.db
        .prepare(
          `INSERT INTO file_artifacts
           (id, workspace_id, file_id, blob_sha256, artifact_type, storage_path, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          artifact.id,
          artifact.workspace_id,
          artifact.file_id,
          artifact.blob_sha256,
          artifact.artifact_type,
          artifact.storage_path,
          artifact.metadata_json,
          artifact.created_at
        );
    }

    for (const item of grouped.memory_node) {
      const node = parseJson<MemoryNodeRow>(item.item_json);
      this.db
        .prepare(
          `INSERT INTO memory_nodes
           (id, workspace_id, source_file_id, source_blob_sha256, summary, trigger, detail, raw_excerpt, raw_ref, source_location_json, tags_json, memory_type, importance, confidence, trust_level, status, ttl_expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
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
          node.created_at,
          node.updated_at
        );
      await this.storeEmbedding(workspaceId, node.id, "summary", await embedText(node.summary, this.memoryOptions));
      await this.storeEmbedding(workspaceId, node.id, "trigger", await embedText(node.trigger, this.memoryOptions));
      await this.storeEmbedding(workspaceId, node.id, "detail", await embedText(node.detail ?? "", this.memoryOptions));
      await this.storeEmbedding(workspaceId, node.id, "raw_excerpt", await embedText(node.raw_excerpt ?? "", this.memoryOptions));
    }

    for (const item of grouped.memory_link) {
      const link = parseJson<MemoryLink>(item.item_json);
      this.db
        .prepare(
          "INSERT INTO memory_links (id, workspace_id, from_node_id, to_node_id, relation_type, confidence, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          link.id,
          link.workspace_id,
          link.from_node_id,
          link.to_node_id,
          link.relation_type,
          link.confidence,
          link.reason,
          link.created_at
        );
    }
  }

  private async storeEmbedding(
    workspaceId: string,
    nodeId: string,
    embeddingType: string,
    embedding: number[]
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memory_embeddings
         (id, workspace_id, memory_node_id, embedding_type, embedding_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(memory_node_id, embedding_type) DO UPDATE SET embedding_json = excluded.embedding_json`
      )
      .run(randomUUID(), workspaceId, nodeId, embeddingType, JSON.stringify(embedding), isoNow());
  }

  private getNodeEmbeddings(nodeId: string): Record<string, number[]> {
    const rows = this.db
      .prepare("SELECT embedding_type, embedding_json FROM memory_embeddings WHERE memory_node_id = ?")
      .all(nodeId) as unknown as EmbeddingRow[];
    return Object.fromEntries(
      rows.map((row) => {
        try {
          return [row.embedding_type, JSON.parse(row.embedding_json) as number[]] as const;
        } catch {
          return [row.embedding_type, []] as const;
        }
      })
    );
  }

  private graphScoreForNode(query: string, links: MemoryLinkPacket[]): number {
    if (links.length === 0) return 0;
    const strongest = links.reduce((max, link) => {
      const relationBoost =
        link.relation_type === "supports" || link.relation_type === "supersedes"
          ? 0.18
          : link.relation_type === "contradicts"
            ? 0.12
            : link.relation_type === "duplicates"
              ? 0.08
              : 0.1;
      const textScore = keywordScore(query, `${link.reason} ${link.other_summary ?? ""} ${link.other_source_path ?? ""}`);
      return Math.max(max, Math.min(1, relationBoost + textScore * 0.7 + link.confidence * 0.15));
    }, 0);
    return strongest;
  }

  private insertRecallTrace(
    workspaceId: string,
    query: string,
    plan: RecallQueryPlan,
    resultNodeIds: string[]
  ): string {
    const traceId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO recall_traces
         (id, workspace_id, query, plan_json, result_node_ids_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(traceId, workspaceId, query, JSON.stringify(plan), JSON.stringify(resultNodeIds), isoNow());
    return traceId;
  }

  private linksByRelation(workspaceId: string, relationType: MemoryRelationType): MemoryLinkPacket[] {
    const rows = this.db
      .prepare(
        `SELECT memory_links.*,
                memory_links.to_node_id AS other_node_id,
                other.summary AS other_summary,
                files.path AS other_source_path
         FROM memory_links
         JOIN memory_nodes other ON other.id = memory_links.to_node_id
         JOIN files ON files.id = other.source_file_id
         WHERE memory_links.workspace_id = ? AND memory_links.relation_type = ?
         ORDER BY memory_links.created_at DESC`
      )
      .all(workspaceId, relationType) as unknown as Array<MemoryLink & {
      other_node_id: string;
      other_summary: string;
      other_source_path: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      from_node_id: row.from_node_id,
      to_node_id: row.to_node_id,
      other_node_id: row.other_node_id,
      relation_type: row.relation_type,
      confidence: row.confidence,
      reason: row.reason,
      created_at: row.created_at,
      other_summary: row.other_summary,
      other_source_path: row.other_source_path
    }));
  }

  private insertMemoryLink(
    workspaceId: string,
    fromNodeId: string,
    toNodeId: string,
    relationType: MemoryRelationType
  ): void {
    this.linkMemoryNodes(workspaceId, fromNodeId, toNodeId, relationType, {
      confidence: 0.7,
      reason: "Legacy internal link creation."
    });
  }

  private getRelatedNodes(nodeId: string): Array<{
    node_id: string;
    relation_type: MemoryRelationType;
    summary: string;
  }> {
    return this.db
      .prepare(
        `SELECT other.id AS node_id, memory_links.relation_type, other.summary
         FROM memory_links
         JOIN memory_nodes current ON current.id = ?
         JOIN memory_nodes other ON other.id =
           CASE
             WHEN memory_links.from_node_id = current.id THEN memory_links.to_node_id
             ELSE memory_links.from_node_id
           END
         WHERE memory_links.from_node_id = current.id OR memory_links.to_node_id = current.id
         ORDER BY memory_links.created_at DESC
         LIMIT 8`
      )
      .all(nodeId) as unknown as Array<{
      node_id: string;
      relation_type: MemoryRelationType;
      summary: string;
      }>;
  }

  private async persistFileBytes(
    workspaceId: string,
    normalizedPath: string,
    bytes: Buffer,
    input: {
      mimeType: string;
      actor: string;
      protected: boolean;
      eventType: "write" | "upload";
      auditType: "file_write" | "file_upload";
      runId?: string;
    }
  ): Promise<FileRecord> {
    const blob = await this.storeBlob(bytes, input.mimeType);
    const now = isoNow();
    await this.writeWorkspaceFile(workspaceId, normalizedPath, bytes);

    const existing = this.db
      .prepare("SELECT * FROM files WHERE workspace_id = ? AND path = ?")
      .get(workspaceId, normalizedPath) as FileRecord | undefined;
    const file: FileRecord = existing
      ? {
          ...existing,
          current_blob_sha256: blob.sha256,
          mime_type: blob.mime_type,
          size_bytes: blob.size_bytes,
          updated_at: now
        }
      : {
          id: randomUUID(),
          workspace_id: workspaceId,
          path: normalizedPath,
          current_blob_sha256: blob.sha256,
          mime_type: blob.mime_type,
          size_bytes: blob.size_bytes,
          created_at: now,
          updated_at: now
        };

    if (existing) {
      this.db
        .prepare(
          "UPDATE files SET current_blob_sha256 = ?, mime_type = ?, size_bytes = ?, updated_at = ? WHERE id = ?"
        )
        .run(file.current_blob_sha256, file.mime_type, file.size_bytes, file.updated_at, file.id);
    } else {
      this.db
        .prepare(
          "INSERT INTO files (id, workspace_id, path, current_blob_sha256, mime_type, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
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

    this.insertFileEvent({
      workspaceId,
      fileId: file.id,
      eventType: input.eventType,
      path: normalizedPath,
      blobSha256: blob.sha256,
      actor: input.actor
    });
    this.audit(workspaceId, input.actor, input.auditType, {
      path: normalizedPath,
      blob_sha256: blob.sha256,
      mime_type: blob.mime_type,
      size_bytes: blob.size_bytes,
      protected: input.protected,
      memory_zone: memoryZoneForPath(normalizedPath)
    });

    if (input.runId) {
      this.logRunEvent(workspaceId, input.runId, input.auditType, {
        path: normalizedPath,
        actor: input.actor,
        blob_sha256: blob.sha256,
        mime_type: blob.mime_type
      });
      await this.appendRunArtifact(workspaceId, input.runId, "actions.md", `- ${input.eventType === "upload" ? "uploaded" : "wrote"} ${normalizedPath}`);
    }

    this.recordSyncEvent(workspaceId, "blobs", blob.sha256, "upsert", blob, input.actor, blob.created_at);
    this.recordSyncEvent(
      workspaceId,
      "files",
      file.id,
      "upsert",
      {
        ...file,
        content_base64: bytes.toString("base64")
      },
      input.actor,
      file.updated_at
    );

    return file;
  }

  private async extractAndStoreSource(
    workspaceId: string,
    normalizedPath: string
  ): Promise<{
    file: FileRecord;
    blob: BlobRecord;
    source: ExtractedSource;
    document: { text: string; sections: ExtractedSection[]; metadata: Record<string, unknown> };
    extractor: { name: string; version: string };
  }> {
    const file = this.getFileByPath(workspaceId, normalizedPath);
    const blob = this.getBlob(file.current_blob_sha256);
    const bytes = await this.readBlobBytes(blob);
    const { document, extractor } = await extractDocument({
      path: normalizedPath,
      mimeType: file.mime_type,
      bytes,
      text: blob.content_text ?? bytes.toString("utf8")
    });
    const source = this.insertExtractedSource(workspaceId, file, blob, extractor.name, extractor.version, document);
    return { file, blob, source, document, extractor };
  }

  private insertExtractedSource(
    workspaceId: string,
    file: FileRecord,
    blob: BlobRecord,
    extractorName: string,
    extractorVersion: string,
    document: { text: string; sections: ExtractedSection[]; metadata: Record<string, unknown> }
  ): ExtractedSource {
    this.db
      .prepare(
        "DELETE FROM file_artifacts WHERE workspace_id = ? AND file_id = ? AND blob_sha256 = ? AND artifact_type = ?"
      )
      .run(workspaceId, file.id, blob.sha256, "extracted_text");
    this.db
      .prepare(
        "DELETE FROM extracted_sources WHERE workspace_id = ? AND file_id = ? AND blob_sha256 = ? AND extractor_name = ?"
      )
      .run(workspaceId, file.id, blob.sha256, extractorName);

    const now = isoNow();
    const source: ExtractedSource = {
      id: randomUUID(),
      workspace_id: workspaceId,
      file_id: file.id,
      blob_sha256: blob.sha256,
      extractor_name: extractorName,
      extractor_version: extractorVersion,
      content_text: document.text,
      metadata_json: JSON.stringify({
        ...document.metadata,
        sections: document.sections.map((section) => ({
          id: section.id,
          title: section.title ?? null,
          sourceLocation: section.sourceLocation ?? null,
          importanceHint: section.importanceHint ?? null,
          text_length: section.text.length
        }))
      }),
      created_at: now
    };
    this.db
      .prepare(
        `INSERT INTO extracted_sources
         (id, workspace_id, file_id, blob_sha256, extractor_name, extractor_version, content_text, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        source.id,
        source.workspace_id,
        source.file_id,
        source.blob_sha256,
        source.extractor_name,
        source.extractor_version,
        source.content_text,
        source.metadata_json,
        source.created_at
      );
    this.db
      .prepare(
        `INSERT INTO file_artifacts
         (id, workspace_id, file_id, blob_sha256, artifact_type, storage_path, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        workspaceId,
        file.id,
        blob.sha256,
        "extracted_text",
        null,
        JSON.stringify({
          extracted_source_id: source.id,
          extractor_name: extractorName,
          extractor_version: extractorVersion,
          derived_from_blob: blob.sha256
        }),
        now
      );
    return source;
  }

  private sourceInfoForNode(node: MemoryNode): {
    source_location: Record<string, unknown> | null;
    source_kind: string | null;
    extractor_name: string | null;
  } {
    const sourceFile = this.getFileById(node.workspace_id, node.source_file_id);
    const extracted = this.db
      .prepare(
        `SELECT extractor_name
         FROM extracted_sources
         WHERE workspace_id = ? AND file_id = ? AND blob_sha256 = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(node.workspace_id, node.source_file_id, node.source_blob_sha256) as
      | { extractor_name: string }
      | undefined;
    const sourceLocation = parseSourceLocation(node.source_location_json);
    return {
      source_location: sourceLocation,
      source_kind: sourceLocation?.type ? String(sourceLocation.type) : sourceKindForNode(node, sourceFile),
      extractor_name: extracted?.extractor_name ?? null
    };
  }

  private async storeBlob(bytes: Buffer, mimeType: string): Promise<BlobRecord> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storagePath = path.join("blobs", sha256.slice(0, 2), sha256);
    const absoluteStoragePath = path.join(this.dataDir, storagePath);
    const existing = this.db.prepare("SELECT * FROM blobs WHERE sha256 = ?").get(sha256) as
      | BlobRecord
      | undefined;

    if (!existsSync(absoluteStoragePath)) {
      await mkdir(path.dirname(absoluteStoragePath), { recursive: true });
      await writeFile(absoluteStoragePath, bytes);
    }

    if (existing) {
      return existing;
    }

    const blob: BlobRecord = {
      sha256,
      storage_path: storagePath,
      content_text: isTextMime(mimeType) ? bytes.toString("utf8") : null,
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      created_at: isoNow()
    };
    this.db
      .prepare(
        "INSERT INTO blobs (sha256, storage_path, content_text, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        blob.sha256,
        blob.storage_path,
        blob.content_text,
        blob.mime_type,
        blob.size_bytes,
        blob.created_at
      );
    return blob;
  }

  private getBlob(sha256: string): BlobRecord {
    const blob = this.db.prepare("SELECT * FROM blobs WHERE sha256 = ?").get(sha256) as
      | BlobRecord
      | undefined;
    if (!blob) {
      throw new MemoryFSError("Blob not found.", 404);
    }
    return blob;
  }

  private async readBlobContent(blob: BlobRecord): Promise<string> {
    if (blob.content_text !== null) {
      return blob.content_text;
    }
    return readFile(path.join(this.dataDir, blob.storage_path), "utf8");
  }

  private async readBlobBytes(blob: BlobRecord): Promise<Buffer> {
    const absolutePath = path.join(this.dataDir, blob.storage_path);
    if (existsSync(absolutePath)) {
      return readFile(absolutePath);
    }
    return Buffer.from(blob.content_text ?? "", "utf8");
  }

  private async writeWorkspaceFile(workspaceId: string, filePath: string, bytes: Buffer): Promise<void> {
    const absolutePath = this.workspaceFilePath(workspaceId, filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }

  private workspaceFilePath(workspaceId: string, filePath: string): string {
    const root = path.resolve(this.workspacesDir, workspaceId);
    const absolutePath = path.resolve(root, filePath.replace(/^\/+/, ""));
    if (!absolutePath.startsWith(`${root}${path.sep}`) && absolutePath !== root) {
      throw new MemoryFSError("Path escapes workspace root.");
    }
    return absolutePath;
  }

  private getFileByPath(workspaceId: string, inputPath: string): FileRecord {
    const normalizedPath = normalizeMemoryPath(inputPath);
    const file = this.db
      .prepare("SELECT * FROM files WHERE workspace_id = ? AND path = ?")
      .get(workspaceId, normalizedPath) as FileRecord | undefined;
    if (!file) {
      throw new MemoryFSError("File not found.", 404);
    }
    return file;
  }

  private tryGetFileByPath(workspaceId: string, inputPath: string): FileRecord | null {
    try {
      return this.getFileByPath(workspaceId, inputPath);
    } catch {
      return null;
    }
  }

  private getFileById(workspaceId: string, fileId: string): FileRecord {
    const file = this.db
      .prepare("SELECT * FROM files WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, fileId) as FileRecord | undefined;
    if (!file) {
      throw new MemoryFSError("File not found.", 404);
    }
    return file;
  }

  private insertFileEvent(input: {
    workspaceId: string;
    fileId: string;
    eventType: FileEventType;
    path: string;
    blobSha256: string | null;
    actor: string;
  }): void {
    const id = randomUUID();
    const createdAt = isoNow();
    this.db
      .prepare(
        "INSERT INTO file_events (id, workspace_id, file_id, event_type, path, blob_sha256, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        input.workspaceId,
        input.fileId,
        input.eventType,
        input.path,
        input.blobSha256,
        input.actor,
        createdAt
      );
    this.recordSyncEvent(input.workspaceId, "file_events", id, "insert", {
      id,
      workspace_id: input.workspaceId,
      file_id: input.fileId,
      event_type: input.eventType,
      path: input.path,
      blob_sha256: input.blobSha256,
      actor: input.actor,
      created_at: createdAt
    }, input.actor, createdAt);
  }

  private audit(workspaceId: string | null, actor: string, eventType: string, payload: unknown): void {
    const id = randomUUID();
    const createdAt = isoNow();
    this.db
      .prepare(
        "INSERT INTO audit_events (id, workspace_id, actor, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, workspaceId, actor, eventType, JSON.stringify(payload), createdAt);
    if (workspaceId) {
      this.recordSyncEvent(workspaceId, "audit_events", id, "insert", {
        id,
        workspace_id: workspaceId,
        actor,
        event_type: eventType,
        payload_json: JSON.stringify(payload),
        created_at: createdAt
      }, actor, createdAt);
    }
  }

  private recordSyncEvent(
    workspaceId: string,
    objectType: string,
    objectId: string,
    operation: string,
    payload: unknown,
    actor: string,
    objectVersion = isoNow()
  ): SyncEvent {
    const event: SyncEvent = {
      id: randomUUID(),
      workspace_id: workspaceId,
      object_type: objectType,
      object_id: objectId,
      operation,
      object_version: objectVersion,
      payload_json: JSON.stringify(payload),
      actor,
      created_at: isoNow()
    };
    this.db
      .prepare(
        `INSERT INTO sync_events
         (id, workspace_id, object_type, object_id, operation, object_version, payload_json, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.workspace_id,
        event.object_type,
        event.object_id,
        event.operation,
        event.object_version,
        event.payload_json,
        event.actor,
        event.created_at
      );
    return event;
  }

  private ensureDefaultRoles(): void {
    const now = isoNow();
    for (const [role, actions] of Object.entries(defaultRolePermissions) as Array<[TeamRole, PermissionAction[]]>) {
      const roleId = `role:${role}`;
      this.db
        .prepare("INSERT OR IGNORE INTO roles (id, name, created_at) VALUES (?, ?, ?)")
        .run(roleId, role, now);
      for (const action of actions) {
        this.db
          .prepare("INSERT OR IGNORE INTO permissions (id, role_id, action, created_at) VALUES (?, ?, ?, ?)")
          .run(`permission:${role}:${action}`, roleId, action, now);
      }
    }
  }

  private upsertUser(handle: string, displayName: string | null): { id: string; handle: string; display_name: string | null } {
    const normalized = handle.trim();
    if (!normalized) {
      throw new MemoryFSError("User handle is required.");
    }
    const existing = this.db.prepare("SELECT * FROM users WHERE handle = ?").get(normalized) as
      | { id: string; handle: string; display_name: string | null }
      | undefined;
    if (existing) {
      if (displayName !== null && displayName !== existing.display_name) {
        this.db.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(displayName, isoNow(), existing.id);
        return { ...existing, display_name: displayName };
      }
      return existing;
    }
    const now = isoNow();
    const user = {
      id: randomUUID(),
      handle: normalized,
      display_name: displayName
    };
    this.db
      .prepare("INSERT INTO users (id, handle, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, user.handle, user.display_name, now, now);
    return user;
  }

  private roleId(role: TeamRole): string {
    const row = this.db.prepare("SELECT id FROM roles WHERE name = ?").get(role) as { id: string } | undefined;
    if (!row) {
      throw new MemoryFSError(`Unknown role: ${role}`);
    }
    return row.id;
  }

  private getWorkspaceMember(workspaceId: string, handle: string): TeamMember {
    const member = this.db
      .prepare(
        `SELECT workspace_members.id,
                workspace_members.workspace_id,
                users.id AS user_id,
                users.handle,
                users.display_name,
                roles.name AS role,
                workspace_members.created_at,
                workspace_members.updated_at
         FROM workspace_members
         JOIN users ON users.id = workspace_members.user_id
         JOIN roles ON roles.id = workspace_members.role_id
         WHERE workspace_members.workspace_id = ? AND users.handle = ?`
      )
      .get(workspaceId, handle) as TeamMember | undefined;
    if (!member) {
      throw new MemoryFSError("Workspace member not found.", 404);
    }
    return member;
  }

  private actorRole(workspaceId: string, actor: string): TeamRole | null {
    const member = this.db
      .prepare(
        `SELECT roles.name AS role
         FROM workspace_members
         JOIN users ON users.id = workspace_members.user_id
         JOIN roles ON roles.id = workspace_members.role_id
         WHERE workspace_members.workspace_id = ? AND users.handle = ?`
      )
      .get(workspaceId, actor) as { role: TeamRole } | undefined;
    return member?.role ?? null;
  }

  private ensureAuthorized(
    workspaceId: string,
    actor: string,
    action: PermissionAction,
    filePath?: string
  ): void {
    if (!this.authRequired) return;
    if (this.authzProvider) {
      const allowed = this.authzProvider.can({ actor, action, workspaceId, path: filePath });
      if (typeof allowed === "boolean" && allowed) return;
      if (typeof allowed === "boolean" && !allowed) {
        throw new MemoryFSError(`Actor ${actor} is not allowed to perform ${action}.`, 403);
      }
    }
    const memberCount = Number(
      (this.db.prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ?").get(workspaceId) as { count: number }).count
    );
    if (memberCount === 0 && (action === "workspace.read" || action === "snapshot.create")) return;
    const role = this.actorRole(workspaceId, actor);
    if (!role || !roleCan(role, action, filePath, Boolean(filePath && this.matchProtectedPath(workspaceId, filePath)))) {
      throw new MemoryFSError(`Actor ${actor} is not allowed to perform ${action}.`, 403);
    }
  }

  private ensureCanManageMembers(workspaceId: string, actor: string): void {
    if (!this.authRequired) return;
    const memberCount = Number(
      (this.db.prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ?").get(workspaceId) as { count: number }).count
    );
    if (memberCount === 0) return;
    const role = this.actorRole(workspaceId, actor);
    if (role !== "owner" && role !== "admin") {
      throw new MemoryFSError(`Actor ${actor} is not allowed to manage workspace members.`, 403);
    }
  }

  private countRows(tableName: string, workspaceId: string): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE workspace_id = ?`).get(workspaceId) as { count: number }).count);
  }

  private upsertSyncCursor(workspaceId: string, peerId: string, input: { pulled?: boolean; pushed?: boolean }): void {
    const now = isoNow();
    const existing = this.db
      .prepare("SELECT id FROM sync_cursors WHERE workspace_id = ? AND peer_id = ?")
      .get(workspaceId, peerId) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare(
          `UPDATE sync_cursors
           SET last_pulled_at = COALESCE(?, last_pulled_at),
               last_pushed_at = COALESCE(?, last_pushed_at),
               updated_at = ?
           WHERE id = ?`
        )
        .run(input.pulled ? now : null, input.pushed ? now : null, now, existing.id);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO sync_cursors
         (id, workspace_id, peer_id, last_pulled_at, last_pushed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), workspaceId, peerId, input.pulled ? now : null, input.pushed ? now : null, now, now);
  }

  private async conflictForRemoteFile(
    workspaceId: string,
    event: SyncEvent,
    payload: FileRecord & { content_base64?: string }
  ): Promise<ConflictRecord | null> {
    const local = this.tryGetFileByPath(workspaceId, payload.path);
    const protectedPath = this.matchProtectedPath(workspaceId, payload.path);
    if (protectedPath) {
      return this.createConflict(workspaceId, event, local?.updated_at ?? "missing", "protected_path_conflict", payload);
    }
    if (local && local.current_blob_sha256 !== payload.current_blob_sha256) {
      return this.createConflict(workspaceId, event, local.updated_at, "same_file_changed", payload);
    }
    return null;
  }

  private createConflict(
    workspaceId: string,
    event: SyncEvent,
    localVersion: string,
    conflictType: string,
    payload?: unknown
  ): ConflictRecord {
    const existing = this.db
      .prepare(
        `SELECT * FROM conflict_records
         WHERE workspace_id = ? AND object_type = ? AND object_id = ? AND status = 'unresolved'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(workspaceId, event.object_type, event.object_id) as ConflictRecord | undefined;
    if (existing) return existing;
    const conflict: ConflictRecord = {
      id: randomUUID(),
      workspace_id: workspaceId,
      object_type: event.object_type,
      object_id: event.object_id,
      local_version: localVersion,
      remote_version: event.object_version,
      conflict_type: conflictType,
      status: "unresolved",
      payload_json: JSON.stringify({ remote_event: event, payload: payload ?? parseJson(event.payload_json) }),
      created_at: isoNow(),
      resolved_at: null
    };
    this.db
      .prepare(
        `INSERT INTO conflict_records
         (id, workspace_id, object_type, object_id, local_version, remote_version, conflict_type, status, payload_json, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        conflict.id,
        conflict.workspace_id,
        conflict.object_type,
        conflict.object_id,
        conflict.local_version,
        conflict.remote_version,
        conflict.conflict_type,
        conflict.status,
        conflict.payload_json,
        conflict.created_at,
        conflict.resolved_at
      );
    this.audit(workspaceId, event.actor, "sync_conflict_detected", {
      conflict_id: conflict.id,
      object_type: event.object_type,
      object_id: event.object_id,
      conflict_type: conflictType
    });
    return conflict;
  }

  private getConflict(workspaceId: string, conflictId: string): ConflictRecord {
    const conflict = this.db
      .prepare("SELECT * FROM conflict_records WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, conflictId) as ConflictRecord | undefined;
    if (!conflict) {
      throw new MemoryFSError("Conflict not found.", 404);
    }
    return conflict;
  }

  private async applyRemoteFileEvent(
    workspaceId: string,
    event: SyncEvent,
    payload: FileRecord & { content_base64?: string },
    actor: string,
    allowProtectedWrite = false
  ): Promise<void> {
    const bytes = payload.content_base64 ? Buffer.from(payload.content_base64, "base64") : Buffer.from(payload.current_blob_sha256, "utf8");
    await this.uploadFile(workspaceId, payload.path, bytes, {
      actor,
      mime_type: payload.mime_type,
      ingest: false,
      allow_protected_write: allowProtectedWrite
    });
    this.recordSyncEvent(workspaceId, event.object_type, event.object_id, "remote_applied", payload, actor, event.object_version);
  }

  private async writeConflictCopy(
    workspaceId: string,
    payload: FileRecord & { content_base64?: string },
    actor: string
  ): Promise<void> {
    const safePath = payload.path.replace(/^\/+/, "");
    const conflictPath = `/conflicts/${timestampSlug()}/${safePath}`;
    const bytes = payload.content_base64 ? Buffer.from(payload.content_base64, "base64") : Buffer.from(payload.current_blob_sha256, "utf8");
    await this.uploadFile(workspaceId, conflictPath, bytes, {
      actor,
      mime_type: payload.mime_type,
      ingest: false,
      allow_protected_write: false
    });
  }

  private ensureDefaultProtectedPaths(workspaceId: string): void {
    const now = isoNow();
    for (const pathGlob of defaultProtectedPathGlobs) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO protected_paths
           (id, workspace_id, path_glob, rule_type, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), workspaceId, pathGlob, "require_allow_flag", now);
    }
  }

  private matchProtectedPath(workspaceId: string, filePath: string): string | null {
    const rows = this.listProtectedPaths(workspaceId);
    const match = rows.find((row) => globMatchesPath(row.path_glob, filePath));
    return match?.path_glob ?? null;
  }
}

export function normalizeMemoryPath(inputPath: string): string {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new MemoryFSError("Path is required.");
  }

  if (inputPath.includes("\0")) {
    throw new MemoryFSError("Path cannot include null bytes.");
  }

  if (!inputPath.startsWith("/")) {
    throw new MemoryFSError("MemoryFS paths must start with '/'.");
  }

  const parts = inputPath.split(/[\\/]+/);
  if (parts.includes("..")) {
    throw new MemoryFSError("Path traversal is not allowed.");
  }

  const normalized = path.posix.normalize(inputPath.replace(/\\/g, "/"));
  if (!normalized.startsWith("/")) {
    throw new MemoryFSError("MemoryFS paths must stay absolute.");
  }

  return normalized;
}

function rowToMemoryNode(row: MemoryNodeRow): MemoryNode {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    source_file_id: row.source_file_id,
    source_blob_sha256: row.source_blob_sha256,
    source_path: row.source_path,
    summary: row.summary,
    trigger: row.trigger,
    detail: row.detail,
    raw_excerpt: row.raw_excerpt,
    raw_ref: row.raw_ref,
    source_location_json: row.source_location_json ?? null,
    tags: parseTags(row.tags_json),
    memory_type: row.memory_type,
    importance: row.importance,
    confidence: row.confidence,
    trust_level: row.trust_level ?? "source_backed",
    status: row.status ?? "active",
    ttl_expires_at: row.ttl_expires_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function sourceSections(document: { text: string; sections: ExtractedSection[] }): ExtractedSection[] {
  const sections = document.sections.filter((section) => section.text.trim());
  if (sections.length > 0) {
    return sections;
  }
  const text = document.text.trim();
  return text
    ? [
        {
          id: "document",
          text,
          sourceLocation: { type: "document" }
        }
      ]
    : [];
}

function parseSourceLocation(sourceLocationJson: string | null | undefined): Record<string, unknown> | null {
  if (!sourceLocationJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(sourceLocationJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sourceKindForNode(node: MemoryNode, file: FileRecord): string | null {
  const parsed = parseSourceLocation(node.source_location_json);
  if (parsed?.type) {
    return String(parsed.type);
  }
  const mime = file.mime_type.toLowerCase();
  if (mime.includes("markdown")) return "markdown";
  if (mime.includes("json")) return "json";
  if (mime.includes("csv")) return "csv";
  if (mime.includes("html")) return "html";
  if (mime.startsWith("text/")) return "text";
  const ext = file.path.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "css", "sql", "sh", "yaml", "yml"].includes(ext)) {
    return "code";
  }
  return ext;
}

function inferMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
    case "markdown":
    case "mdx":
      return "text/markdown";
    case "txt":
    case "text":
      return "text/plain";
    case "json":
      return "application/json";
    case "csv":
      return "text/csv";
    case "html":
    case "htm":
      return "text/html";
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "log":
      return "text/plain";
    default:
      if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "css", "sql", "sh", "bash", "zsh", "yaml", "yml"].includes(ext ?? "")) {
        return "text/plain";
      }
      return "application/octet-stream";
  }
}

function isTextMime(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.endsWith("+json") ||
    mimeType === "application/javascript" ||
    mimeType === "application/xml"
  );
}

const defaultRolePermissions: Record<TeamRole, PermissionAction[]> = {
  owner: [
    "workspace.read",
    "file.read",
    "file.write",
    "file.delete",
    "memory.recall",
    "memory.raw.read",
    "memory.promote",
    "memory.review",
    "snapshot.create",
    "snapshot.rollback",
    "audit.read",
    "sync.pull",
    "sync.push"
  ],
  admin: [
    "workspace.read",
    "file.read",
    "file.write",
    "file.delete",
    "memory.recall",
    "memory.raw.read",
    "memory.promote",
    "memory.review",
    "snapshot.create",
    "audit.read",
    "sync.pull",
    "sync.push"
  ],
  editor: [
    "workspace.read",
    "file.read",
    "file.write",
    "file.delete",
    "memory.recall",
    "memory.promote",
    "snapshot.create",
    "sync.pull",
    "sync.push"
  ],
  agent: ["workspace.read", "file.read", "file.write", "file.delete", "memory.recall", "memory.promote", "sync.pull", "sync.push"],
  viewer: ["workspace.read", "file.read", "memory.recall", "sync.pull"]
};

function roleCan(role: TeamRole, action: PermissionAction, filePath?: string, protectedPath = false): boolean {
  if (role === "owner") return true;
  if (!defaultRolePermissions[role].includes(action)) return false;
  if ((action === "file.write" || action === "file.delete") && protectedPath) {
    return role === "admin";
  }
  if (role === "agent" && (action === "file.write" || action === "file.delete")) {
    return Boolean(filePath && (filePath.startsWith("/scratch/") || filePath.startsWith("/runs/")));
  }
  if (role === "editor" && (action === "file.write" || action === "file.delete")) {
    return !protectedPath;
  }
  if (role === "viewer" && action === "file.read" && protectedPath) {
    return false;
  }
  return true;
}

function parseTags(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function globMatchesPath(glob: string, filePath: string): boolean {
  const escaped = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  return new RegExp(`^${escaped}$`).test(filePath);
}

function isoNow(): string {
  return new Date().toISOString();
}

function unitSimilarity(similarity: number): number {
  if (!Number.isFinite(similarity)) {
    return 0;
  }
  return Math.max(0, Math.min(1, (similarity + 1) / 2));
}

function recencyScore(updatedAt: string): number {
  const updated = new Date(updatedAt).getTime();
  if (!Number.isFinite(updated)) {
    return 0;
  }
  const ageDays = Math.max(0, Date.now() - updated) / (1000 * 60 * 60 * 24);
  return 1 / (1 + ageDays / 30);
}

function pathOrProjectMatch(query: string, sourcePath: string, projectHint?: string): number {
  const source = sourcePath.toLowerCase();
  if (projectHint && source.includes(projectHint.toLowerCase())) {
    return 1;
  }

  const pathTokens = new Set(tokenize(sourcePath));
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const matches = queryTokens.filter((token) => pathTokens.has(token)).length;
  return matches / queryTokens.length;
}

const runArtifactNames = [
  "prompt.md",
  "brief.md",
  "plan.md",
  "actions.md",
  "files-read.md",
  "memory-used.md",
  "result.md",
  "errors.md",
  "followups.md",
  "candidates.md"
] as const;

const durableCandidateTypes = new Set<MemoryType>(["decision", "constraint", "preference", "research_finding"]);

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").toLowerCase();
}

function runIdFromDate(date: Date): string {
  return `${timestampSlug(date)}-${randomUUID().slice(0, 8)}`;
}

function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "workspace";
}

function titleFromTask(task: string): string {
  return task.trim().split(/\s+/).slice(0, 8).join(" ").slice(0, 80) || "Agent run";
}

function sectionBriefResults(
  results: RecallResult[],
  includeOpenQuestions: boolean
): BriefResponse["sections"] {
  const decisions = results.filter((result) => result.memory_type === "decision");
  const constraints = results.filter((result) => result.memory_type === "constraint");
  const preferences = results.filter((result) => result.memory_type === "preference");
  const previousErrors = results.filter((result) => result.memory_type === "error");
  const openQuestions = includeOpenQuestions
    ? results.filter((result) => result.memory_type === "unresolved_question")
    : [];
  const suggestedFiles = [...new Set(results.map((result) => result.source_path))].slice(0, 12);
  const warnings = [...new Set(results.flatMap((result) => result.warnings ?? []))];
  return {
    decisions,
    constraints,
    preferences,
    previous_errors: previousErrors,
    open_questions: openQuestions,
    suggested_files: suggestedFiles,
    warnings
  };
}

function renderBriefMarkdown(
  task: string,
  projectHint: string | undefined,
  sections: BriefResponse["sections"],
  results: RecallResult[]
): string {
  return [
    `# Memory Brief`,
    "",
    `Task: ${task}`,
    projectHint ? `Project: ${projectHint}` : "",
    "",
    renderRecallSection("Decisions", sections.decisions),
    renderRecallSection("Constraints", sections.constraints),
    renderRecallSection("Preferences", sections.preferences),
    renderRecallSection("Previous Errors", sections.previous_errors),
    renderRecallSection("Open Questions", sections.open_questions),
    "## Suggested Files",
    sections.suggested_files.map((file) => `- ${file}`).join("\n") || "- None",
    "",
    "## Warnings",
    sections.warnings.map((warning) => `- ${warning}`).join("\n") || "- None",
    "",
    "## Recall Results",
    results.map((result) => `- ${result.summary} (${result.source_path})`).join("\n") || "- None"
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function renderRecallSection(title: string, results: RecallResult[]): string {
  return [
    `## ${title}`,
    results.map((result) => `- ${result.summary}\n  - Source: ${result.source_path}`).join("\n") || "- None",
    ""
  ].join("\n");
}

function renderCandidatesMarkdown(candidates: ExtractedMemoryNode[], run: AgentRun): string {
  return [
    `# Candidate Memories`,
    "",
    `Run: ${run.id}`,
    `Task: ${run.task}`,
    "",
    ...candidates.map((candidate, index) =>
      [
        `## Candidate ${index + 1}`,
        "",
        `Type: ${candidate.memory_type}`,
        `Importance: ${candidate.importance}`,
        `Summary: ${candidate.summary}`,
        `Trigger: ${candidate.trigger}`,
        `Detail: ${candidate.detail}`,
        `Excerpt: ${candidate.raw_excerpt}`,
        `Tags: ${candidate.tags.join(", ")}`
      ].join("\n")
    )
  ].join("\n");
}

function targetPathForCandidate(node: MemoryNode, run: AgentRun): string {
  if (node.source_path.startsWith("/projects/")) {
    const [, , project] = node.source_path.split("/");
    if (project && node.memory_type === "decision") return `/projects/${project}/decisions.md`;
    if (project && node.memory_type === "constraint") return `/projects/${project}/constraints.md`;
  }
  if (node.memory_type === "preference") return "/preferences.md";
  return `/memory/run-candidates/${run.id}.md`;
}

function extractFollowups(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => /\b(todo|follow|next|should|need)\b/i.test(line))
    .slice(0, 12);
}

function handoffSummaryText(run: AgentRun | null, projectHint: string | undefined, results: RecallResult[]): string {
  const scope = projectHint ? `project ${projectHint}` : run ? `run ${run.id}` : "workspace";
  const top = results[0]?.summary ?? "No strong source-backed memories were found.";
  return `Handoff for ${scope}. Current state: ${top}`;
}

function renderHandoffMarkdown(
  summary: string,
  decisions: string[],
  openQuestions: string[],
  nextActions: string[],
  warnings: string[]
): string {
  return [
    "# Handoff",
    "",
    summary,
    "",
    "## Decisions",
    decisions.map((item) => `- ${item}`).join("\n") || "- None",
    "",
    "## Open Questions",
    openQuestions.map((item) => `- ${item}`).join("\n") || "- None",
    "",
    "## Next Actions",
    nextActions.map((item) => `- ${item}`).join("\n") || "- None",
    "",
    "## Warnings",
    warnings.map((item) => `- ${item}`).join("\n") || "- None"
  ].join("\n");
}

function staleReasonsForNode(node: MemoryNode, hasBeenUsed: boolean, sourceExists: boolean): string[] {
  const reasons: string[] = [];
  const age = ageDays(node.updated_at);
  if (node.status === "rejected" || node.trust_level === "rejected") reasons.push("rejected");
  if (node.trust_level === "superseded") reasons.push("superseded");
  if (node.ttl_expires_at && new Date(node.ttl_expires_at).getTime() < Date.now()) reasons.push("expired_ttl");
  if (!sourceExists) reasons.push("source_missing");
  if (node.confidence < 0.55) reasons.push("low_confidence");
  if (node.importance <= 2 && age > 30) reasons.push("low_importance_old");
  if (!hasBeenUsed && age > 30 && node.trust_level !== "trusted" && node.trust_level !== "reviewed") {
    reasons.push("never_recalled");
  }
  return reasons;
}

function ageDays(updatedAt: string): number {
  const updated = new Date(updatedAt).getTime();
  if (!Number.isFinite(updated)) return 0;
  return Math.max(0, Date.now() - updated) / (1000 * 60 * 60 * 24);
}

function memoryZoneForPath(filePath: string): "scratch" | "runs" | "projects" | "memory" | "profile" | "preferences" | "other" {
  if (filePath.startsWith("/scratch/")) return "scratch";
  if (filePath.startsWith("/runs/")) return "runs";
  if (filePath.startsWith("/projects/")) return "projects";
  if (filePath.startsWith("/memory/")) return "memory";
  if (filePath === "/profile.md") return "profile";
  if (filePath === "/preferences.md") return "preferences";
  return "other";
}

function trustLevelForPath(filePath: string): MemoryTrustLevel {
  const zone = memoryZoneForPath(filePath);
  if (zone === "scratch") return "ephemeral";
  if (zone === "runs") return "agent_generated";
  return "source_backed";
}

function ttlForPath(filePath: string): string | null {
  if (!filePath.startsWith("/scratch/")) return null;
  const ttl = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  return ttl.toISOString();
}

function trustScoreMultiplier(node: MemoryNode): number {
  if (node.status === "pending") return 0.25;
  if (node.status === "rejected" || node.trust_level === "rejected") return 0;
  if (node.trust_level === "trusted") return 1.08;
  if (node.trust_level === "reviewed") return 1.04;
  if (node.trust_level === "superseded") return 0.45;
  if (node.trust_level === "ephemeral") return 0.86;
  if (node.trust_level === "agent_generated") return 0.94;
  return 1;
}

function proposedNodeFromContent(content: string, sourcePath: string, memoryType?: MemoryType): ExtractedMemoryNode {
  const excerpt = shortestExcerpt(content);
  const topic = sourcePath.split("/").filter(Boolean).slice(-2).join("/") || "memory";
  return {
    summary: firstDurableSentence(content) || `Promoted memory candidate from ${sourcePath}.`,
    trigger: `Recall when working with ${topic}.`,
    detail: excerpt.length > 0
      ? `This candidate was proposed from ${sourcePath}. Review the source excerpt before trusting it. ${excerpt}`
      : `This candidate was proposed from ${sourcePath}. Review the source before trusting it.`,
    raw_excerpt: excerpt,
    tags: tagsFromPath(sourcePath),
    memory_type: memoryType ?? inferMemoryType(content),
    importance: importanceFromContent(content),
    confidence: 0.72
  };
}

function extractedFromMemoryNode(node: MemoryNode, memoryType?: MemoryType): ExtractedMemoryNode {
  return {
    summary: node.summary,
    trigger: node.trigger,
    detail: node.detail ?? node.summary,
    raw_excerpt: node.raw_excerpt ?? node.summary,
    tags: node.tags,
    memory_type: memoryType ?? node.memory_type,
    importance: node.importance,
    confidence: node.confidence
  };
}

function shortestExcerpt(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 500);
}

function firstDurableSentence(content: string): string {
  const cleaned = content
    .split(/\n+/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .find((line) => /\b(decision|constraint|preference|task|error|finding|remember|must|should)\b/i.test(line));
  return cleaned ? cleaned.slice(0, 220) : "";
}

function tagsFromPath(sourcePath: string): string[] {
  const tokens = tokenize(sourcePath).filter((token) => token !== "md" && token.length > 1);
  return [...new Set(["promotion", "review", ...tokens])].slice(0, 8);
}

function inferMemoryType(content: string): MemoryType {
  if (/\bpreference\b/i.test(content)) return "preference";
  if (/\bdecision\b/i.test(content)) return "decision";
  if (/\bconstraint|must|never|cannot|should not\b/i.test(content)) return "constraint";
  if (/\berror|failed|bug\b/i.test(content)) return "error";
  if (/\btask|todo|follow up\b/i.test(content)) return "task";
  if (/\bfinding|research\b/i.test(content)) return "research_finding";
  if (/\bquestion|unknown|unresolved\b/i.test(content)) return "unresolved_question";
  return "other";
}

function importanceFromContent(content: string): 1 | 2 | 3 | 4 | 5 {
  if (/\b(critical|must|never|security|protected|decision)\b/i.test(content)) return 4;
  if (/\b(preference|constraint|important|should)\b/i.test(content)) return 3;
  return 2;
}

function promotionBlock(promotion: MemoryPromotion, proposed: ExtractedMemoryNode): string {
  return [
    `## Promoted from ${promotion.source_path}`,
    "",
    `Summary: ${proposed.summary}`,
    `Trigger: ${proposed.trigger}`,
    proposed.detail ? `Detail: ${proposed.detail}` : "",
    `Source: ${promotion.source_path}`,
    promotion.source_node_id ? `Source node: ${promotion.source_node_id}` : "",
    promotion.reason ? `Reason: ${promotion.reason}` : "",
    proposed.raw_excerpt ? `Excerpt: ${proposed.raw_excerpt}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function groupSnapshotItems(items: SnapshotItem[]): Record<SnapshotItemType, SnapshotItem[]> {
  return {
    file: items.filter((item) => item.item_type === "file"),
    blob: items.filter((item) => item.item_type === "blob"),
    memory_node: items.filter((item) => item.item_type === "memory_node"),
    memory_link: items.filter((item) => item.item_type === "memory_link"),
    protected_path: items.filter((item) => item.item_type === "protected_path"),
    extracted_source: items.filter((item) => item.item_type === "extracted_source"),
    file_artifact: items.filter((item) => item.item_type === "file_artifact")
  };
}

function diffSnapshotItems(snapshotId: string, snapshotItems: SnapshotItem[], currentItems: SnapshotItem[]): SnapshotDiff {
  const key = (item: SnapshotItem) => `${item.item_type}:${item.item_id}`;
  const snapshotMap = new Map(snapshotItems.map((item) => [key(item), item]));
  const currentMap = new Map(currentItems.map((item) => [key(item), item]));
  const added: SnapshotDiff["added"] = [];
  const removed: SnapshotDiff["removed"] = [];
  const changed: SnapshotDiff["changed"] = [];

  for (const [itemKey, current] of currentMap) {
    const previous = snapshotMap.get(itemKey);
    if (!previous) {
      added.push({ item_type: current.item_type, item_id: current.item_id });
    } else if (previous.item_json !== current.item_json) {
      changed.push({ item_type: current.item_type, item_id: current.item_id });
    }
  }

  for (const [itemKey, previous] of snapshotMap) {
    if (!currentMap.has(itemKey)) {
      removed.push({ item_type: previous.item_type, item_id: previous.item_id });
    }
  }

  return { snapshot_id: snapshotId, added, removed, changed };
}

function looksContradictory(existing: string, candidate: string): boolean {
  const existingNegative = /\b(no|not|never|avoid|without|forbid|forbidden|cannot|can't|should not)\b/i.test(
    existing
  );
  const candidateNegative = /\b(no|not|never|avoid|without|forbid|forbidden|cannot|can't|should not)\b/i.test(
    candidate
  );
  return existingNegative !== candidateNegative;
}

function classifyNodeRelation(
  existing: Pick<MemoryNode, "summary" | "trigger" | "detail" | "tags" | "memory_type" | "source_path">,
  candidate: Pick<MemoryNode, "summary" | "trigger" | "detail" | "tags" | "memory_type" | "source_path">,
  similarity: number
): { relation: MemoryRelationType | "new"; confidence: number; reason: string } {
  const existingText = nodeText(existing);
  const candidateText = nodeText(candidate);
  const overlap = tokenOverlap(existingText, candidateText);

  if (looksContradictory(existingText, candidateText) && overlap > 0.35) {
    return {
      relation: "contradicts",
      confidence: Math.max(0.72, Math.min(0.95, similarity + overlap / 4)),
      reason: "The memories discuss overlapping terms but one contains a negating constraint or decision."
    };
  }

  if (normalizedSentence(existing.summary) === normalizedSentence(candidate.summary) || similarity > 0.97) {
    return {
      relation: "duplicates",
      confidence: Math.max(0.9, similarity),
      reason: "The memory is substantially identical to an existing memory."
    };
  }

  if (/\b(now|instead|changed|updated|replace|replaces|supersede|supersedes|no longer)\b/i.test(candidateText) && overlap > 0.35) {
    return {
      relation: "supersedes",
      confidence: Math.max(0.72, Math.min(0.94, similarity + overlap / 5)),
      reason: "The newer memory appears to update or replace an older overlapping memory."
    };
  }

  if (similarity > 0.9) {
    return {
      relation: "supersedes",
      confidence: Math.max(0.72, similarity),
      reason: "The memory is highly similar and may refine an existing memory."
    };
  }

  if (similarity > 0.72 || overlap > 0.45 || sharesProjectPath(existing.source_path, candidate.source_path)) {
    return {
      relation: "related_to",
      confidence: Math.max(0.58, Math.min(0.88, Math.max(similarity, overlap))),
      reason: "The memories share topic, path, or project context."
    };
  }

  return {
    relation: "new",
    confidence: 0.5,
    reason: "No strong graph relation was inferred."
  };
}

function memoryNodeFromExtracted(extracted: ExtractedMemoryNode): Pick<MemoryNode, "summary" | "trigger" | "detail" | "tags" | "memory_type" | "source_path"> {
  return {
    summary: extracted.summary,
    trigger: extracted.trigger,
    detail: extracted.detail,
    tags: extracted.tags,
    memory_type: extracted.memory_type,
    source_path: ""
  };
}

function nodeText(node: Pick<MemoryNode, "summary" | "trigger" | "detail" | "tags">): string {
  return `${node.summary} ${node.trigger} ${node.detail ?? ""} ${node.tags.join(" ")}`;
}

function normalizedSentence(text: string): string {
  return tokenize(text).join(" ");
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const matches = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return matches / Math.min(leftTokens.size, rightTokens.size);
}

function sharesProjectPath(left: string, right: string): boolean {
  const leftParts = left.split("/").filter(Boolean);
  const rightParts = right.split("/").filter(Boolean);
  return leftParts.length >= 2 && rightParts.length >= 2 && leftParts[0] === "projects" && leftParts[1] === rightParts[1];
}

function matchedTerms(query: string, text: string): string[] {
  const textTokens = new Set(tokenize(text));
  return [...new Set(tokenize(query))].filter((term) => textTokens.has(term));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function warningsForNode(links: MemoryLinkPacket[]): string[] {
  const warnings: string[] = [];
  if (links.some((link) => link.relation_type === "contradicts")) warnings.push("Linked contradiction exists.");
  if (links.some((link) => link.relation_type === "supersedes")) warnings.push("Supersession link exists.");
  if (links.some((link) => link.relation_type === "duplicates")) warnings.push("Possible duplicate memory.");
  return warnings;
}

function explainRecall(
  node: MemoryNode,
  input: {
    matchedTerms: string[];
    triggerSimilarity: number;
    summarySimilarity: number;
    keyword: number;
    importance: number;
    pathProject: number;
    graphScore: number;
    mode: RecallMode;
  }
): string {
  const reasons: string[] = [];
  if (input.triggerSimilarity > 0.62) reasons.push(`its trigger fits ${input.mode.replace("_", " ")} recall`);
  if (input.summarySimilarity > 0.62) reasons.push("its summary is close to the query");
  if (input.keyword > 0.2 && input.matchedTerms.length > 0) reasons.push(`it matches ${input.matchedTerms.slice(0, 4).join(", ")}`);
  if (input.importance > 0.75) reasons.push(`it is an important ${node.memory_type}`);
  if (input.pathProject > 0.5) reasons.push(`it belongs to ${node.source_path}`);
  if (input.graphScore > 0.2) reasons.push("linked memories add supporting context");

  return `This was recalled because ${reasons.slice(0, 3).join(", ") || "it is the best available source-backed memory for the query"}.`;
}

function briefForRecall(plan: RecallQueryPlan, results: RecallResult[]): string {
  if (results.length === 0) {
    return `No source-backed memories matched the ${plan.mode.replace("_", " ")} query.`;
  }
  const top = results[0];
  return `Found ${results.length} source-backed ${results.length === 1 ? "memory" : "memories"} for ${plan.mode.replace("_", " ")}. Top result: ${top.summary}`;
}
