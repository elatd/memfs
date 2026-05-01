import { openMemoryDatabase, type SqliteDatabase } from "@memoryfs/db";
import {
  cosineSimilarity,
  embedText,
  extractMemoryNodesFromContent,
  extractReasoningMemoriesFromRun,
  keywordScore,
  planRecallQuery,
  riskFlagsForText,
  tokenize,
  type ExtractedMemoryNode,
  type ExtractedReasoningMemory,
  type CandidateSourceKind,
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
  | "implemented_in"
  | "observed_in"
  | "applies_to"
  | "blocked_by"
  | "belongs_to_project"
  | "used_in_run"
  | "promoted_from";
export type MemoryGraphObjectType = "memory_node" | "file" | "run" | "candidate" | "reasoning_memory";
export type MemoryTrustLevel =
  | "ephemeral"
  | "agent_generated"
  | "source_backed"
  | "reviewed"
  | "trusted"
  | "superseded"
  | "rejected";
export type MemoryCandidateStatus =
  | "observed"
  | "candidate"
  | "duplicate"
  | "approved"
  | "rejected"
  | "superseded"
  | "stale"
  | "conflicted";
export type MemoryNodeStatus = MemoryCandidateStatus | "active" | "pending";
export type PromotionStatus = "pending" | "approved" | "rejected" | "applied";
export type SnapshotItemType =
  | "file"
  | "blob"
  | "memory_node"
  | "memory_link"
  | "memory_graph_edge"
  | "protected_path"
  | "extracted_source"
  | "file_artifact";
export type AgentRunStatus = "created" | "running" | "completed" | "failed" | "compiled";
export type RunMemoryUsageType = "recalled" | "opened" | "cited" | "ignored" | "promoted";
export type ArchiveEntryType = "conversation" | "transcript" | "imported" | "agent-run" | "raw";
export type MemoryScope = "global" | "workspace" | "project" | "repo" | "session" | "agent" | "contact" | "run";
export type MemfsMode = "local" | "team" | "cloud";
export type TeamRole = "owner" | "admin" | "editor" | "agent" | "viewer";
export type ConflictStatus = "unresolved" | "resolved_local" | "resolved_remote" | "resolved_manual";
export type ConflictResolutionMode = "keep_local" | "keep_remote" | "manual_merge" | "keep_both";
export type CandidateConflictResolutionMode = "keep_new" | "keep_old" | "keep_both" | "mark_superseded";

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
  valid_from: string | null;
  valid_until: string | null;
  last_confirmed_at: string | null;
  last_used_at: string | null;
  supersedes: string[];
  superseded_by: string[];
  stale_reason: string | null;
  duplicate_of: string | null;
  conflicts_with: string[];
  conflict_reason: string | null;
  scope: MemoryScope;
  project_id: string | null;
  project_slug: string | null;
  repo_id: string | null;
  repo_path: string | null;
  session_id: string | null;
  agent_id: string | null;
  contact_id: string | null;
  run_id: string | null;
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

export interface ArchiveEntry {
  id: string;
  workspace_id: string;
  archive_type: ArchiveEntryType;
  title: string;
  path: string;
  source_file_id: string;
  source_blob_sha256: string;
  raw_ref: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
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

export interface MemoryGraphEdge {
  id: string;
  workspace_id: string;
  from_type: MemoryGraphObjectType;
  from_id: string;
  to_type: MemoryGraphObjectType;
  to_id: string;
  relation_type: MemoryRelationType;
  confidence: number;
  reason: string;
  source_ref: string | null;
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
  scope?: MemoryScope | MemoryScope[];
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  mode?: RecallMode;
  memory_types?: string[];
  trust_levels?: string[];
  include_why?: boolean;
  include_contradictions?: boolean;
  include_links?: boolean;
  include_related?: boolean;
  include_trust?: boolean;
  include_rejected?: boolean;
  include_stale?: boolean;
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
  valid_from?: string | null;
  valid_until?: string | null;
  last_confirmed_at?: string | null;
  last_used_at?: string | null;
  supersedes?: string[];
  superseded_by?: string[];
  stale_reason?: string | null;
  scope: MemoryScope;
  project_id?: string | null;
  project_slug?: string | null;
  repo_id?: string | null;
  repo_path?: string | null;
  session_id?: string | null;
  agent_id?: string | null;
  contact_id?: string | null;
  run_id?: string | null;
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
  graph_edges?: MemoryGraphEdgePacket[];
  warnings?: string[];
  related_nodes?: Array<{
    node_id: string;
    relation_type: MemoryRelationType;
    summary: string;
    source_path?: string;
    raw_ref?: string;
    depth?: number;
    score?: number;
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

export type MemoryGrepMode = "literal" | "semantic" | "hybrid";
export type MemoryGrepMatchType = "literal" | "lexical" | "extracted" | "archive" | "memory" | "run" | "handoff";

export interface MemoryGrepOptions {
  mode?: MemoryGrepMode;
  scope?: string | string[];
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
  trust_min?: MemoryTrustLevel;
  include_runs?: boolean;
  include_sources?: boolean;
  include_stale?: boolean;
  limit?: number;
  project_hint?: string;
}

export interface MemoryGrepResult {
  path: string;
  source_path: string;
  raw_ref: string | null;
  line: number | null;
  source_location?: Record<string, unknown> | null;
  snippet: string;
  score: number;
  trust: MemoryTrustLevel | null;
  scope: MemoryScope;
  project_id?: string | null;
  project_slug?: string | null;
  repo_id?: string | null;
  repo_path?: string | null;
  session_id?: string | null;
  agent_id?: string | null;
  contact_id?: string | null;
  run_id?: string | null;
  node_id: string | null;
  match_type: MemoryGrepMatchType;
}

export interface MemoryGrepResponse {
  query: string;
  mode: MemoryGrepMode;
  workspace_id: string;
  results: MemoryGrepResult[];
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
  direction?: "outgoing" | "incoming";
}

export interface MemoryGraphEdgePacket {
  id: string;
  edge_kind: "memory_link" | "graph_edge";
  workspace_id: string;
  from_type: MemoryGraphObjectType;
  from_id: string;
  to_type: MemoryGraphObjectType;
  to_id: string;
  relation_type: MemoryRelationType;
  confidence: number;
  reason: string;
  source_ref: string | null;
  created_at: string;
  direction?: "outgoing" | "incoming";
  other_type?: MemoryGraphObjectType;
  other_id?: string;
  from_summary?: string | null;
  to_summary?: string | null;
  from_source_path?: string | null;
  to_source_path?: string | null;
}

export interface MemoryGraphNodeResponse {
  node: MemoryNode;
  edges: MemoryGraphEdgePacket[];
}

export interface RelatedMemoryResult {
  node: MemoryNode;
  depth: number;
  score: number;
  path: MemoryGraphEdgePacket[];
}

export interface RelationshipPathResponse {
  from_node: MemoryNode;
  to_node: MemoryNode;
  found: boolean;
  path: MemoryGraphEdgePacket[];
  explanation: string;
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
  scope?: MemoryScope;
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
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
  scope: MemoryScope;
  project_id: string | null;
  project_slug: string | null;
  repo_id: string | null;
  repo_path: string | null;
  session_id: string | null;
  agent_id: string | null;
  contact_id: string | null;
  run_id: string | null;
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

export interface MemoryCandidateSourceRef {
  source_path: string;
  raw_ref: string;
  source_location: Record<string, unknown> | null;
}

export interface MemoryCandidate {
  id: string;
  node_id: string;
  memory_text: string;
  type: MemoryType;
  scope: MemoryScope;
  source_refs: MemoryCandidateSourceRef[];
  confidence: number;
  risk_flags: string[];
  status: MemoryCandidateStatus;
  valid_from: string | null;
  valid_until: string | null;
  last_confirmed_at: string | null;
  last_used_at: string | null;
  supersedes: string[];
  superseded_by: string[];
  stale_reason: string | null;
  duplicate_of: string | null;
  conflicts_with: string[];
  conflict_reason: string | null;
  created_by: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  promotion_id: string | null;
  promotion_target_path: string | null;
  reason: string | null;
  node: MemoryNode;
}

export interface MemoryCandidateListOptions {
  status?: MemoryCandidateStatus | MemoryCandidateStatus[];
  duplicates?: boolean;
  conflicts?: boolean;
  scope?: MemoryScope | MemoryScope[];
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
}

export interface ProposeMemoryCandidateInput {
  memory_text?: string;
  memory?: string;
  summary?: string;
  trigger?: string;
  detail?: string;
  type?: MemoryType;
  memory_type?: MemoryType;
  source_path?: string;
  promotion_target_path?: string;
  target_path?: string;
  confidence?: number;
  risk_flags?: string[];
  reason?: string;
  actor?: string;
  scope?: MemoryScope;
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
}

export interface UpdateMemoryCandidateInput {
  memory_text?: string;
  summary?: string;
  trigger?: string;
  detail?: string;
  type?: MemoryType;
  memory_type?: MemoryType;
  confidence?: number;
  tags?: string[];
  status?: Exclude<MemoryCandidateStatus, "approved" | "rejected">;
  promotion_target_path?: string;
  target_path?: string;
  reason?: string;
  actor?: string;
  reviewer?: string;
  scope?: MemoryScope;
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
}

export interface ApproveMemoryCandidateInput {
  reviewer?: string;
  comment?: string;
  apply?: boolean;
  promotion_target_path?: string;
  target_path?: string;
}

export interface RejectMemoryCandidateInput {
  reviewer?: string;
  comment?: string;
}

export interface ResolveCandidateConflictInput {
  mode: CandidateConflictResolutionMode;
  actor?: string;
  reviewer?: string;
  reason?: string;
  target_path?: string;
  promotion_target_path?: string;
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
  old_node_count: number;
  unconfirmed_node_count: number;
  superseded_node_count: number;
  conflicted_node_count: number;
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
  scope?: MemoryScope | MemoryScope[];
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
  files?: string[];
  actor?: string;
  mode?: RecallMode;
  include_recent_runs?: boolean;
  include_open_questions?: boolean;
  include_contradictions?: boolean;
  include_raw?: boolean;
  include_candidates?: boolean;
  limit?: number;
  create_run?: boolean;
}

export interface BriefSourceRef {
  node_id: string;
  source_path: string;
  raw_ref: string;
  trust_level: MemoryTrustLevel | null;
  status: MemoryNodeStatus | null;
  score: number;
  scope: MemoryScope | null;
  project_slug?: string | null;
  repo_path?: string | null;
  run_id?: string | null;
}

export interface BriefItem {
  title: string;
  summary: string;
  detail: string | null;
  memory_type: MemoryType;
  trust_level: MemoryTrustLevel | null;
  status: MemoryNodeStatus | null;
  score: number;
  source: BriefSourceRef;
  tags: string[];
  warnings: string[];
}

export interface BriefSections {
  facts: BriefItem[];
  decisions: BriefItem[];
  constraints: BriefItem[];
  preferences: BriefItem[];
  previous_failures: BriefItem[];
  previous_errors: BriefItem[];
  successful_patterns: BriefItem[];
  reasoning_memories: BriefItem[];
  stale_or_conflicted: BriefItem[];
  open_questions: BriefItem[];
  suggested_files: string[];
  likely_paths: string[];
  suggested_actions: string[];
  warnings: string[];
}

export interface BriefResponse {
  brief_markdown: string;
  sections: BriefSections;
  memory_results: RecallResult[];
  run_id?: string;
}

export interface CompileRunResponse {
  candidate_nodes: MemoryNode[];
  reasoning_candidates: ReasoningMemoryCandidate[];
  suggested_promotions: MemoryPromotion[];
  contradictions: ContradictionRecord[];
  followups: string[];
  summary: string;
}

export interface ReasoningMemorySourceRef {
  path: string;
  raw_ref: string | null;
}

export interface ReasoningMemoryCandidate {
  id: string;
  node_id: string;
  type: "reasoning_memory";
  title: string;
  trigger: string;
  context: string;
  strategy: string;
  failure_pattern: string;
  success_pattern: string;
  applies_to: string[];
  preconditions: string[];
  anti_patterns: string[];
  source_run: string;
  source_refs: ReasoningMemorySourceRef[];
  confidence: number;
  status: MemoryCandidateStatus;
  reason: string;
  raw_ref: string;
  node: MemoryNode;
}

export interface ArchiveWriteInput {
  title?: string;
  content: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export interface ArchiveImportInput extends ArchiveWriteInput {
  archive_type?: ArchiveEntryType;
}

export interface ArchiveReadResponse {
  entry: ArchiveEntry;
  content: string;
}

export interface ArchiveExtractResponse {
  archive: ArchiveEntry;
  candidate_nodes: MemoryNode[];
  summary: string;
}

export interface ArchiveApi {
  writeConversation(workspaceId: string, input: ArchiveWriteInput): Promise<ArchiveEntry>;
  writeTranscript(workspaceId: string, input: ArchiveWriteInput): Promise<ArchiveEntry>;
  importText(workspaceId: string, input: ArchiveImportInput): Promise<ArchiveEntry>;
  list(workspaceId: string): ArchiveEntry[];
  read(workspaceId: string, archiveId: string): Promise<ArchiveReadResponse>;
  extractToMemoryCandidates(
    workspaceId: string,
    archiveId: string,
    input?: { actor?: string; limit?: number }
  ): Promise<ArchiveExtractResponse>;
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
  valid_from: string | null;
  valid_until: string | null;
  last_confirmed_at: string | null;
  last_used_at: string | null;
  stale_reason: string | null;
  duplicate_of: string | null;
  conflicts_with_json: string | null;
  conflict_reason: string | null;
  scope: MemoryScope | null;
  project_id: string | null;
  project_slug: string | null;
  repo_id: string | null;
  repo_path: string | null;
  session_id: string | null;
  agent_id: string | null;
  contact_id: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CandidateReviewDetection {
  status: Extract<MemoryCandidateStatus, "candidate" | "duplicate" | "conflicted">;
  duplicate_of: string | null;
  conflicts_with: string[];
  conflict_reason: string | null;
  duplicate_reason?: string;
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
  readonly archive: ArchiveApi;
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
    this.archive = {
      writeConversation: (workspaceId, input) => this.writeArchiveConversation(workspaceId, input),
      writeTranscript: (workspaceId, input) => this.writeArchiveTranscript(workspaceId, input),
      importText: (workspaceId, input) => this.importArchiveText(workspaceId, input),
      list: (workspaceId) => this.listArchive(workspaceId),
      read: (workspaceId, archiveId) => this.readArchive(workspaceId, archiveId),
      extractToMemoryCandidates: (workspaceId, archiveId, input) =>
        this.extractArchiveToMemoryCandidates(workspaceId, archiveId, input)
    };
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

  async writeArchiveConversation(workspaceId: string, input: ArchiveWriteInput): Promise<ArchiveEntry> {
    return this.writeArchiveEntry(workspaceId, "conversation", input);
  }

  async writeArchiveTranscript(workspaceId: string, input: ArchiveWriteInput): Promise<ArchiveEntry> {
    return this.writeArchiveEntry(workspaceId, "transcript", input);
  }

  async importArchiveText(workspaceId: string, input: ArchiveImportInput): Promise<ArchiveEntry> {
    return this.writeArchiveEntry(workspaceId, input.archive_type ?? "imported", input);
  }

  listArchive(workspaceId: string): ArchiveEntry[] {
    this.getWorkspace(workspaceId);
    return this.db
      .prepare("SELECT * FROM archive_entries WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as unknown as ArchiveEntry[];
  }

  getArchiveEntry(workspaceId: string, archiveId: string): ArchiveEntry {
    this.getWorkspace(workspaceId);
    const entry = this.db
      .prepare("SELECT * FROM archive_entries WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, archiveId) as ArchiveEntry | undefined;
    if (!entry) {
      throw new MemoryFSError("Archive entry not found.", 404);
    }
    return entry;
  }

  async readArchive(workspaceId: string, archiveId: string): Promise<ArchiveReadResponse> {
    const entry = this.getArchiveEntry(workspaceId, archiveId);
    const read = await this.readFile(workspaceId, entry.path);
    return { entry, content: read.content };
  }

  async extractArchiveToMemoryCandidates(
    workspaceId: string,
    archiveId: string,
    input: { actor?: string; limit?: number } = {}
  ): Promise<ArchiveExtractResponse> {
    const { entry, content } = await this.readArchive(workspaceId, archiveId);
    const actor = input.actor ?? "agent:archive";
    const extracted = await extractMemoryNodesFromContent({
      content,
      path: entry.path,
      options: this.memoryOptions
    });
    const limit = clampLimit(input.limit ?? extracted.length, 0, 100);
    const candidateNodes: MemoryNode[] = [];

    for (const extractedNode of extracted.slice(0, limit)) {
      const file = this.getFileByPath(workspaceId, entry.path);
      const node = await this.insertCandidateMemoryNode(workspaceId, file, extractedNode, actor, {
        type: "archive",
        archive_id: entry.id,
        archive_type: entry.archive_type,
        title: entry.title,
        source_path: entry.path
      });
      candidateNodes.push(node);
    }

    this.audit(workspaceId, actor, "archive_memory_candidates_extracted", {
      archive_id: entry.id,
      archive_path: entry.path,
      archive_type: entry.archive_type,
      candidate_count: candidateNodes.length
    });

    return {
      archive: entry,
      candidate_nodes: candidateNodes,
      summary: `Extracted ${candidateNodes.length} candidate memories from ${entry.title}.`
    };
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
      if (!memoryScopeMatches(node, recallScopeFilterOptions(options))) return false;
      const trustRequested = options.trust_levels?.length
        ? options.trust_levels.includes(node.trust_level)
        : true;
      if (!trustRequested) return false;
      if (isRejectedMemory(node)) return Boolean(options.include_rejected);
      if (!options.include_rejected && isCandidateLikeStatus(node.status)) return false;
      if (!options.include_stale && isStaleLikeMemory(node)) return false;
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
        scope: entry.node.scope,
        project_id: entry.node.project_id,
        project_slug: entry.node.project_slug,
        repo_id: entry.node.repo_id,
        repo_path: entry.node.repo_path,
        session_id: entry.node.session_id,
        agent_id: entry.node.agent_id,
        contact_id: entry.node.contact_id,
        run_id: entry.node.run_id,
        ...(options.include_trust
          ? {
              trust_level: entry.node.trust_level,
              status: entry.node.status,
              valid_from: entry.node.valid_from,
              valid_until: entry.node.valid_until,
              last_confirmed_at: entry.node.last_confirmed_at,
              last_used_at: entry.node.last_used_at,
              supersedes: entry.node.supersedes,
              superseded_by: entry.node.superseded_by,
              stale_reason: entry.node.stale_reason
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
      }

      if (options.include_detail || options.include_related) {
        result.related_nodes = this.getRelatedNodes(workspaceId, entry.node.id, {
          include_stale: options.include_stale
        });
      }

      if (options.include_why) {
        result.why = entry.why;
      }

      if (options.include_links) {
        result.links = entry.links;
        result.graph_edges = this.listGraphEdgesForNode(workspaceId, entry.node.id);
      }

      if (options.include_raw) {
        result.raw_content = await this.readRawForNode(workspaceId, entry.node.id);
      }

      results.push(result);
    }

    this.markMemoryNodesUsed(workspaceId, results.map((result) => result.node_id));

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
      include_related: Boolean(options.include_related),
      include_trust: Boolean(options.include_trust),
      include_rejected: Boolean(options.include_rejected),
      include_stale: Boolean(options.include_stale),
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

  async grepMemory(workspaceId: string, query: string, options: MemoryGrepOptions = {}): Promise<MemoryGrepResponse> {
    this.getWorkspace(workspaceId);
    const queryText = query.trim();
    if (!queryText) {
      throw new MemoryFSError("Memory grep query is required.");
    }

    const mode = options.mode ?? "hybrid";
    const limit = clampLimit(options.limit ?? 20, 1, 100);
    const includeSources = options.include_sources ?? true;
    const includeRuns = options.include_runs ?? true;
    const results: MemoryGrepResult[] = [];

    if (includeSources && (mode === "literal" || mode === "hybrid")) {
      const queryLower = queryText.toLowerCase();
      for (const file of this.listFiles(workspaceId)) {
        if (!grepPathAllowed(file.path, { ...options, include_runs: includeRuns })) continue;
        if (!options.include_stale && this.pathHasOnlyStaleMemory(workspaceId, file.id)) continue;
        const trust = trustLevelForPath(file.path);
        if (!trustMeetsMinimum(trust, options.trust_min)) continue;
        const rawRef = rawRefForFile(workspaceId, file);
        const scope = scopeMetadataForPath(file.path);

        if (file.path.toLowerCase().includes(queryLower)) {
          results.push({
            path: file.path,
            source_path: file.path,
            raw_ref: rawRef,
            line: null,
            snippet: "(path match)",
            score: grepScore(0.76, trust),
            trust,
            ...scope,
            node_id: null,
            match_type: grepSourceMatchType(file.path, "literal")
          });
        }

        if (!isTextMime(file.mime_type)) continue;
        const read = await this.readFile(workspaceId, file.path);
        const lines = read.content.replace(/\r\n/g, "\n").split("\n");
        let exactLineCount = 0;
        lines.forEach((line, index) => {
          if (!line.toLowerCase().includes(queryLower)) return;
          exactLineCount += 1;
          results.push({
            path: file.path,
            source_path: file.path,
            raw_ref: rawRef,
            line: index + 1,
            source_location: { type: "line", start_line: index + 1, end_line: index + 1 },
            snippet: snippetAround(line, queryText),
            score: grepScore(1, trust),
            trust,
            ...scope,
            node_id: null,
            match_type: grepSourceMatchType(file.path, "literal")
          });
        });

        if (mode === "hybrid" && exactLineCount === 0) {
          const match = bestLexicalLine(read.content, queryText);
          if (match && match.score >= 0.5) {
            results.push({
              path: file.path,
              source_path: file.path,
              raw_ref: rawRef,
              line: match.line,
              source_location: match.line ? { type: "line", start_line: match.line, end_line: match.line } : null,
              snippet: match.snippet,
              score: grepScore(0.55 + match.score * 0.32, trust),
              trust,
              ...scope,
              node_id: null,
              match_type: grepSourceMatchType(file.path, "lexical")
            });
          }
        }
      }

      for (const source of this.listExtractedSources(workspaceId)) {
        const file = this.getFileById(workspaceId, source.file_id);
        if (!grepPathAllowed(file.path, { ...options, include_runs: includeRuns })) continue;
        if (!options.include_stale && this.pathHasOnlyStaleMemory(workspaceId, file.id)) continue;
        const trust = trustLevelForPath(file.path);
        if (!trustMeetsMinimum(trust, options.trust_min)) continue;
        const scope = scopeMetadataForPath(file.path);
        const sourceLocation = bestSourceLocation(source.metadata_json, source.content_text, queryText);
        const exact = source.content_text.toLowerCase().includes(queryLower);
        const lexical = mode === "hybrid" ? bestLexicalLine(source.content_text, queryText) : null;
        if (!exact && (!lexical || lexical.score < 0.5)) continue;

        const line = exact
          ? lineNumberForText(source.content_text, queryText)
          : lexical?.line ?? sourceLine(sourceLocation);
        results.push({
          path: file.path,
          source_path: file.path,
          raw_ref: rawRefForFile(workspaceId, file),
          line,
          source_location: sourceLocation,
          snippet: exact ? snippetAround(lineTextFor(source.content_text, line), queryText) : lexical?.snippet ?? snippetAround(source.content_text, queryText),
          score: grepScore(exact ? 0.94 : 0.58 + (lexical?.score ?? 0) * 0.3, trust),
          trust,
          ...scope,
          node_id: null,
          match_type: grepSourceMatchType(file.path, "extracted")
        });
      }
    }

    if (mode === "semantic" || mode === "hybrid") {
      const recall = await this.recallMemory(workspaceId, queryText, {
        include_detail: true,
        include_raw: false,
        include_trust: true,
        project_hint: options.project_hint,
        trust_levels: options.trust_min ? trustLevelsAtOrAbove(options.trust_min) : undefined,
        scope: recallScopesFromGrepOptions(options),
        project_id: options.project_id,
        project_slug: options.project_slug,
        repo_id: options.repo_id,
        repo_path: options.repo_path,
        session_id: options.session_id,
        agent_id: options.agent_id,
        contact_id: options.contact_id,
        run_id: options.run_id,
        include_stale: options.include_stale,
        limit: Math.max(limit * 3, 12)
      });

      for (const item of recall.results) {
        if (!grepPathAllowed(item.source_path, { ...options, include_runs: includeRuns })) continue;
        const trust = item.trust_level ?? null;
        if (!trustMeetsMinimum(trust, options.trust_min)) continue;
        const sourceLocation = item.source_location ?? null;
        const matchType = grepMatchTypeForSourcePath(item.source_path);
        results.push({
          path: item.source_path,
          source_path: item.source_path,
          raw_ref: item.raw_ref,
          line: sourceLine(sourceLocation),
          source_location: sourceLocation,
          snippet: snippetAround(item.detail || item.summary || item.trigger, queryText),
          score: Number(Math.min(0.97, item.score * (mode === "semantic" ? 1 : 0.96)).toFixed(4)),
          trust,
          scope: item.scope,
          project_id: item.project_id ?? null,
          project_slug: item.project_slug ?? null,
          repo_id: item.repo_id ?? null,
          repo_path: item.repo_path ?? null,
          session_id: item.session_id ?? null,
          agent_id: item.agent_id ?? null,
          contact_id: item.contact_id ?? null,
          run_id: item.run_id ?? null,
          node_id: item.node_id,
          match_type: matchType
        });
      }
    }

    const ranked = dedupeGrepResults(results)
      .sort(compareGrepResults)
      .slice(0, limit);

    this.audit(workspaceId, "agent:grep", "memory_grep", {
      query: queryText,
      mode,
      include_runs: includeRuns,
      include_sources: includeSources,
      include_stale: Boolean(options.include_stale),
      trust_min: options.trust_min ?? null,
      scope: options.scope ?? null,
      result_count: ranked.length
    });

    return {
      query: queryText,
      mode,
      workspace_id: workspaceId,
      results: ranked
    };
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
    return rows.map((row) => this.withTemporalLinks(workspaceId, rowToMemoryNode(row)));
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
    return this.withTemporalLinks(workspaceId, rowToMemoryNode(row));
  }

  private withTemporalLinks(workspaceId: string, node: MemoryNode): MemoryNode {
    const supersedes = this.db
      .prepare(
        `SELECT to_node_id AS node_id
         FROM memory_links
         WHERE workspace_id = ? AND from_node_id = ? AND relation_type = 'supersedes'
         ORDER BY created_at DESC`
      )
      .all(workspaceId, node.id) as unknown as Array<{ node_id: string }>;
    const supersededBy = this.db
      .prepare(
        `SELECT from_node_id AS node_id
         FROM memory_links
         WHERE workspace_id = ? AND to_node_id = ? AND relation_type = 'supersedes'
         ORDER BY created_at DESC`
      )
      .all(workspaceId, node.id) as unknown as Array<{ node_id: string }>;
    return {
      ...node,
      supersedes: supersedes.map((row) => row.node_id),
      superseded_by: supersededBy.map((row) => row.node_id)
    };
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

  recordAuditEvent(workspaceId: string, actor: string, eventType: string, payload: unknown = {}): AuditEvent {
    this.getWorkspace(workspaceId);
    return this.audit(workspaceId, actor || "agent:unknown", eventType || "audit_event", payload);
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
    const normalizedRelationType = normalizeMemoryRelationType(relationType);
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
      .get(workspaceId, fromNodeId, toNodeId, normalizedRelationType) as MemoryLink | undefined;
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
      relation_type: normalizedRelationType,
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
    if (normalizedRelationType === "supersedes") {
      this.markMemoryNodeTrust(workspaceId, toNodeId, "superseded", "superseded");
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
      other_source_path: row.other_source_path,
      direction: row.from_node_id === nodeId ? "outgoing" : "incoming"
    }));
  }

  createGraphEdge(
    workspaceId: string,
    input: {
      from_node_id?: string;
      to_node_id?: string;
      from_type?: MemoryGraphObjectType;
      from_id?: string;
      to_type?: MemoryGraphObjectType;
      to_id?: string;
      relation_type: MemoryRelationType;
      confidence?: number;
      reason?: string;
      source_ref?: string | null;
      actor?: string;
    }
  ): MemoryGraphEdgePacket {
    const fromType = input.from_type ?? "memory_node";
    const toType = input.to_type ?? "memory_node";
    const fromId = input.from_id ?? input.from_node_id;
    const toId = input.to_id ?? input.to_node_id;
    if (!fromId || !toId) {
      throw new MemoryFSError("Graph edge requires from and to ids.");
    }
    const relationType = normalizeMemoryRelationType(input.relation_type);
    if (fromType === "memory_node" && toType === "memory_node") {
      const link = this.linkMemoryNodes(workspaceId, fromId, toId, relationType, {
        confidence: input.confidence,
        reason: input.reason,
        actor: input.actor
      });
      return this.memoryLinkToGraphEdgePacket(workspaceId, link);
    }
    return this.createGraphObjectEdge(workspaceId, {
      from_type: fromType,
      from_id: fromId,
      to_type: toType,
      to_id: toId,
      relation_type: relationType,
      confidence: input.confidence,
      reason: input.reason,
      source_ref: input.source_ref,
      actor: input.actor
    });
  }

  listGraphEdgesForNode(workspaceId: string, nodeId: string): MemoryGraphEdgePacket[] {
    this.getMemoryNode(workspaceId, nodeId);
    const nodeLinks = this.getMemoryNodeLinks(workspaceId, nodeId).map((link) =>
      this.memoryLinkPacketToGraphEdgePacket(workspaceId, link, nodeId)
    );
    const objectEdges = this.db
      .prepare(
        `SELECT * FROM memory_graph_edges
         WHERE workspace_id = ?
           AND ((from_type IN ('memory_node', 'candidate', 'reasoning_memory') AND from_id = ?)
             OR (to_type IN ('memory_node', 'candidate', 'reasoning_memory') AND to_id = ?))
         ORDER BY created_at DESC`
      )
      .all(workspaceId, nodeId, nodeId) as unknown as MemoryGraphEdge[];
    return [...nodeLinks, ...objectEdges.map((edge) => this.decorateGraphEdge(edge, nodeId))]
      .sort(compareGraphEdges);
  }

  getMemoryGraphNode(workspaceId: string, nodeId: string): MemoryGraphNodeResponse {
    return {
      node: this.getMemoryNode(workspaceId, nodeId),
      edges: this.listGraphEdgesForNode(workspaceId, nodeId)
    };
  }

  deleteGraphEdge(
    workspaceId: string,
    edgeId: string,
    input: { actor?: string } = {}
  ): { deleted: boolean; edge: MemoryGraphEdgePacket } {
    this.getWorkspace(workspaceId);
    const link = this.db.prepare("SELECT * FROM memory_links WHERE workspace_id = ? AND id = ?").get(workspaceId, edgeId) as
      | MemoryLink
      | undefined;
    if (link) {
      const packet = this.memoryLinkToGraphEdgePacket(workspaceId, link);
      this.db.prepare("DELETE FROM memory_links WHERE workspace_id = ? AND id = ?").run(workspaceId, edgeId);
      this.audit(workspaceId, input.actor ?? "human:graph", "memory_link_deleted", {
        link_id: edgeId,
        relation_type: link.relation_type
      });
      this.recordSyncEvent(workspaceId, "memory_links", edgeId, "delete", link, input.actor ?? "human:graph", isoNow());
      return { deleted: true, edge: packet };
    }

    const edge = this.db.prepare("SELECT * FROM memory_graph_edges WHERE workspace_id = ? AND id = ?").get(workspaceId, edgeId) as
      | MemoryGraphEdge
      | undefined;
    if (!edge) {
      throw new MemoryFSError("Graph edge not found.", 404);
    }
    const packet = this.decorateGraphEdge(edge);
    this.db.prepare("DELETE FROM memory_graph_edges WHERE workspace_id = ? AND id = ?").run(workspaceId, edgeId);
    this.audit(workspaceId, input.actor ?? "human:graph", "memory_graph_edge_deleted", {
      edge_id: edgeId,
      relation_type: edge.relation_type
    });
    this.recordSyncEvent(workspaceId, "memory_graph_edges", edgeId, "delete", edge, input.actor ?? "human:graph", isoNow());
    return { deleted: true, edge: packet };
  }

  findRelatedMemories(
    workspaceId: string,
    nodeId: string,
    options: { depth?: number; limit?: number; relation_types?: MemoryRelationType[]; include_stale?: boolean } = {}
  ): RelatedMemoryResult[] {
    this.getMemoryNode(workspaceId, nodeId);
    const maxDepth = clampLimit(options.depth ?? 2, 1, 4);
    const limit = clampLimit(options.limit ?? 12, 1, 50);
    const relationFilter = new Set((options.relation_types ?? []).map(normalizeMemoryRelationType));
    const visited = new Set<string>([nodeId]);
    const queue: Array<{ nodeId: string; depth: number; path: MemoryGraphEdgePacket[] }> = [{ nodeId, depth: 0, path: [] }];
    const related: RelatedMemoryResult[] = [];

    while (queue.length > 0 && related.length < limit * 3) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;
      const edges = this.listGraphEdgesForNode(workspaceId, current.nodeId);
      for (const edge of edges) {
        if (relationFilter.size > 0 && !relationFilter.has(edge.relation_type)) continue;
        const nextNodeId = graphEdgeOtherNodeId(edge, current.nodeId);
        if (!nextNodeId || visited.has(nextNodeId)) continue;
        const nextNode = this.getMemoryNode(workspaceId, nextNodeId);
        if (!options.include_stale && (isRejectedMemory(nextNode) || isStaleLikeMemory(nextNode))) continue;
        visited.add(nextNodeId);
        const nextPath = [...current.path, edge];
        const depth = current.depth + 1;
        related.push({
          node: nextNode,
          depth,
          score: graphRelatedScore(nextPath, depth),
          path: nextPath
        });
        queue.push({ nodeId: nextNodeId, depth, path: nextPath });
      }
    }

    return related.sort(compareRelatedMemoryResults).slice(0, limit);
  }

  explainRelationshipPath(
    workspaceId: string,
    fromNodeId: string,
    toNodeId: string,
    options: { max_depth?: number; relation_types?: MemoryRelationType[] } = {}
  ): RelationshipPathResponse {
    const fromNode = this.getMemoryNode(workspaceId, fromNodeId);
    const toNode = this.getMemoryNode(workspaceId, toNodeId);
    const relationFilter = new Set((options.relation_types ?? []).map(normalizeMemoryRelationType));
    const maxDepth = clampLimit(options.max_depth ?? 4, 1, 6);
    const visited = new Set<string>([fromNodeId]);
    const queue: Array<{ nodeId: string; path: MemoryGraphEdgePacket[] }> = [{ nodeId: fromNodeId, path: [] }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length >= maxDepth) continue;
      for (const edge of this.listGraphEdgesForNode(workspaceId, current.nodeId)) {
        if (relationFilter.size > 0 && !relationFilter.has(edge.relation_type)) continue;
        const nextNodeId = graphEdgeOtherNodeId(edge, current.nodeId);
        if (!nextNodeId || visited.has(nextNodeId)) continue;
        const nextPath = [...current.path, edge];
        if (nextNodeId === toNodeId) {
          return {
            from_node: fromNode,
            to_node: toNode,
            found: true,
            path: nextPath,
            explanation: explainGraphPath(fromNode, toNode, nextPath)
          };
        }
        visited.add(nextNodeId);
        queue.push({ nodeId: nextNodeId, path: nextPath });
      }
    }

    return {
      from_node: fromNode,
      to_node: toNode,
      found: false,
      path: [],
      explanation: "No relationship path was found within the requested depth."
    };
  }

  private createGraphObjectEdge(
    workspaceId: string,
    input: {
      from_type: MemoryGraphObjectType;
      from_id: string;
      to_type: MemoryGraphObjectType;
      to_id: string;
      relation_type: MemoryRelationType;
      confidence?: number;
      reason?: string;
      source_ref?: string | null;
      actor?: string;
    }
  ): MemoryGraphEdgePacket {
    this.getWorkspace(workspaceId);
    this.assertGraphEndpoint(workspaceId, input.from_type, input.from_id);
    this.assertGraphEndpoint(workspaceId, input.to_type, input.to_id);
    const relationType = normalizeMemoryRelationType(input.relation_type);
    const existing = this.db
      .prepare(
        `SELECT * FROM memory_graph_edges
         WHERE workspace_id = ? AND from_type = ? AND from_id = ? AND to_type = ? AND to_id = ? AND relation_type = ?`
      )
      .get(workspaceId, input.from_type, input.from_id, input.to_type, input.to_id, relationType) as MemoryGraphEdge | undefined;
    if (existing) {
      const nextConfidence = input.confidence ?? existing.confidence;
      const nextReason = input.reason ?? existing.reason;
      const nextSourceRef = input.source_ref ?? existing.source_ref;
      if (nextConfidence !== existing.confidence || nextReason !== existing.reason || nextSourceRef !== existing.source_ref) {
        this.db
          .prepare("UPDATE memory_graph_edges SET confidence = ?, reason = ?, source_ref = ? WHERE workspace_id = ? AND id = ?")
          .run(nextConfidence, nextReason, nextSourceRef, workspaceId, existing.id);
        return this.decorateGraphEdge({
          ...existing,
          confidence: nextConfidence,
          reason: nextReason,
          source_ref: nextSourceRef
        });
      }
      return this.decorateGraphEdge(existing);
    }

    const edge: MemoryGraphEdge = {
      id: randomUUID(),
      workspace_id: workspaceId,
      from_type: input.from_type,
      from_id: input.from_id,
      to_type: input.to_type,
      to_id: input.to_id,
      relation_type: relationType,
      confidence: input.confidence ?? 0.7,
      reason: input.reason ?? "",
      source_ref: input.source_ref ?? null,
      created_at: isoNow()
    };
    this.db
      .prepare(
        `INSERT INTO memory_graph_edges
         (id, workspace_id, from_type, from_id, to_type, to_id, relation_type, confidence, reason, source_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        edge.id,
        edge.workspace_id,
        edge.from_type,
        edge.from_id,
        edge.to_type,
        edge.to_id,
        edge.relation_type,
        edge.confidence,
        edge.reason,
        edge.source_ref,
        edge.created_at
      );
    this.audit(workspaceId, input.actor ?? "agent:graph", "memory_graph_edge_created", {
      edge_id: edge.id,
      from_type: edge.from_type,
      from_id: edge.from_id,
      to_type: edge.to_type,
      to_id: edge.to_id,
      relation_type: edge.relation_type,
      confidence: edge.confidence,
      reason: edge.reason,
      source_ref: edge.source_ref
    });
    this.recordSyncEvent(workspaceId, "memory_graph_edges", edge.id, "upsert", edge, input.actor ?? "agent:graph", edge.created_at);
    return this.decorateGraphEdge(edge);
  }

  private assertGraphEndpoint(workspaceId: string, type: MemoryGraphObjectType, id: string): void {
    if (isMemoryNodeGraphType(type)) {
      this.getMemoryNode(workspaceId, id);
      return;
    }
    if (type === "file") {
      this.getFileById(workspaceId, id);
      return;
    }
    if (type === "run") {
      this.getRun(workspaceId, id);
    }
  }

  private memoryLinkToGraphEdgePacket(workspaceId: string, link: MemoryLink, focusNodeId?: string): MemoryGraphEdgePacket {
    const fromNode = this.getMemoryNode(workspaceId, link.from_node_id);
    const toNode = this.getMemoryNode(workspaceId, link.to_node_id);
    return {
      id: link.id,
      edge_kind: "memory_link",
      workspace_id: workspaceId,
      from_type: graphTypeForMemoryNode(fromNode),
      from_id: link.from_node_id,
      to_type: graphTypeForMemoryNode(toNode),
      to_id: link.to_node_id,
      relation_type: link.relation_type,
      confidence: link.confidence,
      reason: link.reason,
      source_ref: fromNode.raw_ref,
      created_at: link.created_at,
      direction: focusNodeId ? (link.from_node_id === focusNodeId ? "outgoing" : "incoming") : undefined,
      other_type: focusNodeId ? graphTypeForMemoryNode(link.from_node_id === focusNodeId ? toNode : fromNode) : undefined,
      other_id: focusNodeId ? (link.from_node_id === focusNodeId ? link.to_node_id : link.from_node_id) : undefined,
      from_summary: fromNode.summary,
      to_summary: toNode.summary,
      from_source_path: fromNode.source_path,
      to_source_path: toNode.source_path
    };
  }

  private memoryLinkPacketToGraphEdgePacket(
    workspaceId: string,
    link: MemoryLinkPacket,
    focusNodeId?: string
  ): MemoryGraphEdgePacket {
    const fullLink: MemoryLink = {
      id: link.id,
      workspace_id: workspaceId,
      from_node_id: link.from_node_id,
      to_node_id: link.to_node_id,
      relation_type: link.relation_type,
      confidence: link.confidence,
      reason: link.reason,
      created_at: link.created_at
    };
    return this.memoryLinkToGraphEdgePacket(workspaceId, fullLink, focusNodeId);
  }

  private decorateGraphEdge(edge: MemoryGraphEdge, focusNodeId?: string): MemoryGraphEdgePacket {
    const from = this.describeGraphEndpoint(edge.workspace_id, edge.from_type, edge.from_id);
    const to = this.describeGraphEndpoint(edge.workspace_id, edge.to_type, edge.to_id);
    return {
      id: edge.id,
      edge_kind: "graph_edge",
      workspace_id: edge.workspace_id,
      from_type: edge.from_type,
      from_id: edge.from_id,
      to_type: edge.to_type,
      to_id: edge.to_id,
      relation_type: edge.relation_type,
      confidence: edge.confidence,
      reason: edge.reason,
      source_ref: edge.source_ref,
      created_at: edge.created_at,
      direction: focusNodeId ? (edge.from_id === focusNodeId && isMemoryNodeGraphType(edge.from_type) ? "outgoing" : "incoming") : undefined,
      other_type: focusNodeId
        ? edge.from_id === focusNodeId && isMemoryNodeGraphType(edge.from_type)
          ? edge.to_type
          : edge.from_type
        : undefined,
      other_id: focusNodeId
        ? edge.from_id === focusNodeId && isMemoryNodeGraphType(edge.from_type)
          ? edge.to_id
          : edge.from_id
        : undefined,
      from_summary: from.summary,
      to_summary: to.summary,
      from_source_path: from.sourcePath,
      to_source_path: to.sourcePath
    };
  }

  private describeGraphEndpoint(
    workspaceId: string,
    type: MemoryGraphObjectType,
    id: string
  ): { summary: string | null; sourcePath: string | null } {
    try {
      if (isMemoryNodeGraphType(type)) {
        const node = this.getMemoryNode(workspaceId, id);
        return { summary: node.summary, sourcePath: node.source_path };
      }
      if (type === "file") {
        const file = this.getFileById(workspaceId, id);
        return { summary: file.path, sourcePath: file.path };
      }
      const run = this.getRun(workspaceId, id);
      return { summary: run.title || run.task, sourcePath: run.run_path };
    } catch {
      return { summary: id, sourcePath: null };
    }
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
    const scopeOptions = briefScopeOptions(request);
    const includeCandidates = Boolean(request.include_candidates);
    const briefQuery = [task, ...(request.files ?? [])].filter(Boolean).join("\n");
    const recall = await this.recallMemory(workspaceId, briefQuery, {
      limit: request.limit ?? 12,
      include_detail: true,
      include_raw: Boolean(request.include_raw),
      project_hint: request.project_hint,
      mode: request.mode ?? "task_preparation",
      include_contradictions: request.include_contradictions ?? true,
      include_links: true,
      include_related: true,
      include_trust: true,
      include_rejected: includeCandidates,
      trust_levels: includeCandidates
        ? ["trusted", "reviewed", "source_backed", "agent_generated", "ephemeral"]
        : ["trusted", "reviewed", "source_backed", "ephemeral"],
      ...scopeOptions
    });
    const recalledResults = request.include_recent_runs
      ? recall.results
      : recall.results.filter((result) => result.memory_type !== "run_summary");
    const results = recalledResults.filter((result) => shouldIncludeInBriefMainResults(result, includeCandidates));
    const riskyItems = await this.relevantRiskyBriefItems(workspaceId, briefQuery, request);
    const sections = sectionBriefResults(results, request.include_open_questions ?? true, riskyItems, request.files ?? []);
    const contradictionWarnings = (request.include_contradictions ?? true)
      ? this.findContradictions(workspaceId)
          .slice(0, 5)
          .map((item) => `Contradiction: ${item.from_node.summary} conflicts with ${item.to_node.summary}`)
      : [];
    sections.warnings = [...new Set([...(recall.warnings ?? []), ...sections.warnings, ...contradictionWarnings])];
    sections.suggested_actions = suggestedBriefActions(request, sections);
    const briefMarkdown = renderBriefMarkdown(task, request, sections, results);
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
        suggested_files: sections.suggested_files,
        suggested_actions: sections.suggested_actions
      });
    }

    this.audit(workspaceId, actor, "brief_created", {
      task,
      project_hint: request.project_hint ?? null,
      scope: request.scope ?? null,
      project_slug: request.project_slug ?? null,
      run_id: runId ?? null,
      include_candidates: includeCandidates,
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
    input: { actor?: string; create_promotions?: boolean; reasoning?: boolean } = {}
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
    const reasoningCandidates: ReasoningMemoryCandidate[] = [];
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

    if (input.reasoning) {
      const extractedReasoning = await extractReasoningMemoriesFromRun({
        run_path: run.run_path,
        task: run.task,
        status: run.status,
        artifacts,
        options: this.memoryOptions
      });
      const uniqueReasoning = await this.dedupeReasoningMemories(workspaceId, run, extractedReasoning);
      await this.writeRunArtifact(workspaceId, runId, "reasoning-memories.json", JSON.stringify(uniqueReasoning, null, 2));
      const reasoningFile = this.getFileByPath(workspaceId, `${run.run_path}/reasoning-memories.json`);
      for (const reasoning of uniqueReasoning) {
        const node = await this.insertRunCandidateMemoryNode(
          workspaceId,
          reasoningFile,
          reasoningMemoryToExtractedNode(reasoning),
          actor,
          {
            type: "reasoning_memory",
            source_run: reasoning.source_run,
            source_refs: reasoning.source_refs,
            reasoning_memory: reasoning
          }
        );
        reasoningCandidates.push(this.reasoningCandidateFromNode(workspaceId, node, reasoning));
      }
      this.logRunEvent(workspaceId, runId, "run_reasoning_compiled", {
        reasoning_candidate_count: reasoningCandidates.length
      });
      this.audit(workspaceId, actor, "run_reasoning_memories_compiled", {
        run_id: runId,
        reasoning_candidate_count: reasoningCandidates.length,
        source_path: `${run.run_path}/reasoning-memories.json`
      });
    }

    const followups = extractFollowups(artifacts["followups.md"] ?? combined);
    this.db
      .prepare("UPDATE agent_runs SET status = ? WHERE workspace_id = ? AND id = ?")
      .run("compiled", workspaceId, runId);
    this.logRunEvent(workspaceId, runId, "run_compiled", {
      candidate_count: candidateNodes.length,
      reasoning_candidate_count: reasoningCandidates.length,
      suggested_promotion_count: suggestedPromotions.length
    });
    this.audit(workspaceId, actor, "agent_run_compiled", {
      run_id: runId,
      candidate_count: candidateNodes.length,
      reasoning_candidate_count: reasoningCandidates.length,
      suggested_promotion_count: suggestedPromotions.length
    });
    return {
      candidate_nodes: candidateNodes,
      reasoning_candidates: reasoningCandidates,
      suggested_promotions: suggestedPromotions,
      contradictions: this.findContradictions(workspaceId),
      followups,
      summary: `Compiled ${candidateNodes.length} candidate memories and ${reasoningCandidates.length} reasoning memories from ${run.title}.`
    };
  }

  listRunLessons(workspaceId: string, runId: string): ReasoningMemoryCandidate[] {
    const run = this.getRun(workspaceId, runId);
    return this.listMemoryNodes(workspaceId)
      .filter((node) => node.memory_type === "reasoning_memory")
      .map((node) => this.reasoningCandidateFromNode(workspaceId, node))
      .filter((candidate) => candidate.source_run === run.run_path);
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
      .map((node) => ({ node, reasons: staleReasonsForNode(node, this.nodeHasBeenUsed(node.id) || Boolean(node.last_used_at), this.sourceExists(node)) }))
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

  markMemoryStale(
    workspaceId: string,
    nodeId: string,
    input: { reason: string; actor?: string } = { reason: "" }
  ): MemoryNode {
    const node = this.getMemoryNode(workspaceId, nodeId);
    const actor = input.actor ?? "human:reviewer";
    this.ensureAuthorized(workspaceId, actor, "memory.review", node.source_path);
    const reason = input.reason?.trim() || "Marked stale.";
    const now = isoNow();
    this.db
      .prepare(
        `UPDATE memory_nodes
         SET status = ?, stale_reason = ?, valid_until = COALESCE(valid_until, ?), updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .run("stale", reason, now, now, workspaceId, nodeId);
    this.insertReview(workspaceId, null, nodeId, "stale", actor, reason);
    this.audit(workspaceId, actor, "memory.marked_stale", {
      node_id: nodeId,
      reason
    });
    return this.getMemoryNode(workspaceId, nodeId);
  }

  confirmMemory(
    workspaceId: string,
    nodeId: string,
    input: { actor?: string } = {}
  ): MemoryNode {
    const node = this.getMemoryNode(workspaceId, nodeId);
    const actor = input.actor ?? "human:reviewer";
    this.ensureAuthorized(workspaceId, actor, "memory.review", node.source_path);
    const nextStatus = node.status === "stale" || node.status === "conflicted" ? "active" : node.status;
    const now = isoNow();
    this.db
      .prepare(
        `UPDATE memory_nodes
         SET status = ?, valid_from = COALESCE(valid_from, ?), last_confirmed_at = ?, stale_reason = NULL, updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .run(nextStatus, now, now, now, workspaceId, nodeId);
    this.insertReview(workspaceId, null, nodeId, "confirmed", actor, "Memory confirmed as current.");
    this.audit(workspaceId, actor, "memory.confirmed", {
      node_id: nodeId,
      status: nextStatus
    });
    return this.getMemoryNode(workspaceId, nodeId);
  }

  supersedeMemory(
    workspaceId: string,
    oldNodeId: string,
    newNodeId: string,
    input: { reason?: string; actor?: string } = {}
  ): MemoryLink {
    const oldNode = this.getMemoryNode(workspaceId, oldNodeId);
    const newNode = this.getMemoryNode(workspaceId, newNodeId);
    const actor = input.actor ?? "human:reviewer";
    this.ensureAuthorized(workspaceId, actor, "memory.review", oldNode.source_path);
    this.ensureAuthorized(workspaceId, actor, "memory.review", newNode.source_path);
    const reason = input.reason?.trim() || "Superseded by newer memory.";
    const link = this.linkMemoryNodes(workspaceId, newNodeId, oldNodeId, "supersedes", {
      reason,
      confidence: 0.9,
      actor
    });
    const now = isoNow();
    this.db
      .prepare(
        `UPDATE memory_nodes
         SET trust_level = ?, status = ?, stale_reason = ?, valid_until = COALESCE(valid_until, ?), updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .run("superseded", "superseded", reason, now, now, workspaceId, oldNodeId);
    this.db
      .prepare(
        `UPDATE memory_nodes
         SET valid_from = COALESCE(valid_from, ?), last_confirmed_at = COALESCE(last_confirmed_at, ?), updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .run(now, now, now, workspaceId, newNodeId);
    this.insertReview(workspaceId, null, oldNodeId, "superseded", actor, reason);
    this.audit(workspaceId, actor, "memory.superseded", {
      old_node_id: oldNodeId,
      new_node_id: newNodeId,
      link_id: link.id,
      reason
    });
    return link;
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
    const candidateNode = await this.insertCandidateMemoryNode(workspaceId, file, proposed, actor, undefined, {
      target_path: targetPath,
      append: request.append !== false,
      scope: scopeMetadataFromRequest(request, scopeMetadataForPath(targetPath))
    });
    if (sourceNode) {
      this.linkMemoryNodes(workspaceId, candidateNode.id, sourceNode.id, "promoted_from", {
        confidence: 0.85,
        reason: `Candidate promotion from ${sourcePath} to ${targetPath}.`,
        actor
      });
    }

    const now = isoNow();
    const promotionScope = scopeMetadataFromRequest(request, candidateNode);
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
        scope: promotionScope.scope,
        project_id: promotionScope.project_id,
        project_slug: promotionScope.project_slug,
        repo_id: promotionScope.repo_id,
        repo_path: promotionScope.repo_path,
        session_id: promotionScope.session_id,
        agent_id: promotionScope.agent_id,
        contact_id: promotionScope.contact_id,
        run_id: promotionScope.run_id,
        protected_target: Boolean(protectedTarget)
      }),
      status: requireReview ? "pending" : "approved",
      actor,
      reviewer: null,
      reason: request.reason ?? null,
      append: request.append === false ? 0 : 1,
      candidate_node_id: candidateNode.id,
      scope: promotionScope.scope,
      project_id: promotionScope.project_id,
      project_slug: promotionScope.project_slug,
      repo_id: promotionScope.repo_id,
      repo_path: promotionScope.repo_path,
      session_id: promotionScope.session_id,
      agent_id: promotionScope.agent_id,
      contact_id: promotionScope.contact_id,
      run_id: promotionScope.run_id,
      created_at: now,
      updated_at: now
    };

    this.db
      .prepare(
        `INSERT INTO memory_promotions
         (id, workspace_id, source_path, target_path, source_node_id, proposed_node_json, status, actor, reviewer, reason, append, candidate_node_id, scope, project_id, project_slug, repo_id, repo_path, session_id, agent_id, contact_id, run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        promotion.scope,
        promotion.project_id,
        promotion.project_slug,
        promotion.repo_id,
        promotion.repo_path,
        promotion.session_id,
        promotion.agent_id,
        promotion.contact_id,
        promotion.run_id,
        promotion.created_at,
        promotion.updated_at
      );
    this.audit(workspaceId, actor, "memory_promotion_created", {
      promotion_id: promotion.id,
      source_path: sourcePath,
      target_path: targetPath,
      status: promotion.status,
      protected_target: Boolean(protectedTarget),
      scope: promotion.scope,
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

  async proposeMemoryCandidate(
    workspaceId: string,
    input: ProposeMemoryCandidateInput
  ): Promise<MemoryCandidate> {
    this.getWorkspace(workspaceId);
    const actor = input.actor ?? "agent:candidate";
    const explicitText = input.memory_text ?? input.memory;
    const sourcePath = input.source_path ? normalizeMemoryPath(input.source_path) : null;
    let file: FileRecord;
    let content: string;

    if (sourcePath) {
      const read = await this.readFile(workspaceId, sourcePath);
      file = read.file;
      content = explicitText ?? read.content;
    } else {
      content = explicitText ?? input.detail ?? input.summary ?? "";
      if (!content.trim()) {
        throw new MemoryFSError("Candidate memory text or source_path is required.");
      }
      const candidatePath = `/scratch/candidates/${timestampSlug()}-${randomUUID().slice(0, 8)}.md`;
      file = await this.writeFile(workspaceId, candidatePath, content, {
        actor,
        ingest: false,
        allow_protected_write: true
      });
    }

    const proposed = proposedNodeFromCandidateInput(input, content, file.path);
    const riskFlags = candidateInputRiskFlags(input.risk_flags, input, content, file.path);
    const targetPath = input.promotion_target_path ?? input.target_path;
    const candidateNode = await this.insertCandidateMemoryNode(workspaceId, file, proposed, actor, {
      type: "candidate_proposal",
      created_by: actor,
      risk_flags: riskFlags
    }, {
      target_path: targetPath,
      scope: scopeMetadataFromCandidateInput(input, scopeMetadataForPath(file.path))
    });
    if (targetPath) {
      this.createPromotionForCandidateNode(workspaceId, candidateNode, {
        target_path: targetPath,
        actor,
        reason: input.reason,
        scope: input.scope,
        project_id: input.project_id,
        project_slug: input.project_slug,
        repo_id: input.repo_id,
        repo_path: input.repo_path,
        session_id: input.session_id,
        agent_id: input.agent_id,
        contact_id: input.contact_id,
        run_id: input.run_id
      });
    }
    return this.getCandidate(workspaceId, candidateNode.id);
  }

  listCandidates(workspaceId: string, options: MemoryCandidateListOptions = {}): MemoryCandidate[] {
    this.getWorkspace(workspaceId);
    const statuses = normalizeCandidateStatuses(options.status);
    const promotionsByCandidate = this.promotionsByCandidate(workspaceId);
    return this.listMemoryNodes(workspaceId)
      .filter((node) => {
        if (!isCandidateNode(node, promotionsByCandidate.has(node.id))) return false;
        if (!memoryScopeMatches(node, options)) return false;
        const status = normalizeCandidateStatus(node, promotionsByCandidate.get(node.id) ?? null);
        if (options.duplicates && status !== "duplicate" && !node.duplicate_of) return false;
        if (options.conflicts && status !== "conflicted" && !node.conflict_reason) return false;
        if (statuses.length > 0 && !statuses.includes(status)) return false;
        return true;
      })
      .map((node) => this.memoryCandidateFromNode(workspaceId, node, promotionsByCandidate.get(node.id) ?? null));
  }

  getCandidate(workspaceId: string, candidateId: string): MemoryCandidate {
    this.getWorkspace(workspaceId);
    const promotionsByCandidate = this.promotionsByCandidate(workspaceId);
    const promotion = this.db
      .prepare("SELECT * FROM memory_promotions WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, candidateId) as MemoryPromotion | undefined;
    const nodeId = promotion?.candidate_node_id ?? candidateId;
    const node = this.getMemoryNode(workspaceId, nodeId);
    if (!isCandidateNode(node, promotionsByCandidate.has(node.id))) {
      throw new MemoryFSError("Candidate not found.", 404);
    }
    return this.memoryCandidateFromNode(workspaceId, node, promotion ?? promotionsByCandidate.get(node.id) ?? null);
  }

  async updateCandidate(
    workspaceId: string,
    candidateId: string,
    input: UpdateMemoryCandidateInput
  ): Promise<MemoryCandidate> {
    const current = this.getCandidate(workspaceId, candidateId);
    const actor = input.actor ?? input.reviewer ?? "human:reviewer";
    const status = input.status ?? current.status;
    if (status === "approved" || status === "rejected") {
      throw new MemoryFSError("Use candidate approve or reject for terminal review decisions.");
    }

    const memoryText = input.memory_text?.trim();
    const nextSummary = input.summary ?? (memoryText ? firstDurableSentence(memoryText) || current.node.summary : current.node.summary);
    const nextTrigger = input.trigger ?? current.node.trigger;
    const nextDetail = input.detail ?? (memoryText ? memoryText : current.node.detail);
    const nextTags = input.tags ?? current.node.tags;
    const nextType = input.memory_type ?? input.type ?? current.node.memory_type;
    const nextConfidence = clampConfidence(input.confidence ?? current.node.confidence);
    const nextStatus = normalizeCandidateNodeStatus(status);
    const nextTrust = trustLevelForCandidateStatus(nextStatus, current.node.trust_level);
    const nextScope = scopeMetadataFromCandidateUpdate(input, current.node);
    const now = isoNow();
    const nextStaleReason = nextStatus === "stale" || nextStatus === "conflicted" ? input.reason ?? current.node.stale_reason : current.node.stale_reason;
    const nextConflictReason = nextStatus === "conflicted" ? input.reason ?? current.node.conflict_reason : current.node.conflict_reason;

    this.db
      .prepare(
        `UPDATE memory_nodes
         SET summary = ?, trigger = ?, detail = ?, tags_json = ?, memory_type = ?, confidence = ?, trust_level = ?, status = ?, stale_reason = ?, conflict_reason = ?,
             scope = ?, project_id = ?, project_slug = ?, repo_id = ?, repo_path = ?, session_id = ?, agent_id = ?, contact_id = ?, run_id = ?,
             updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .run(
        nextSummary,
        nextTrigger,
        nextDetail,
        JSON.stringify(nextTags),
        nextType,
        nextConfidence,
        nextTrust,
        nextStatus,
        nextStaleReason,
        nextConflictReason,
        nextScope.scope,
        nextScope.project_id,
        nextScope.project_slug,
        nextScope.repo_id,
        nextScope.repo_path,
        nextScope.session_id,
        nextScope.agent_id,
        nextScope.contact_id,
        nextScope.run_id,
        now,
        workspaceId,
        current.node.id
      );
    await this.storeEmbedding(workspaceId, current.node.id, "summary", await embedText(nextSummary, this.memoryOptions));
    await this.storeEmbedding(workspaceId, current.node.id, "trigger", await embedText(nextTrigger, this.memoryOptions));
    await this.storeEmbedding(workspaceId, current.node.id, "detail", await embedText(nextDetail ?? "", this.memoryOptions));

    const updatedNode = this.getMemoryNode(workspaceId, current.node.id);
    const proposed = extractedFromMemoryNode(updatedNode);
    const targetPath = input.promotion_target_path ?? input.target_path;
    let promotion = current.promotion_id ? this.getPromotion(workspaceId, current.promotion_id) : null;
    if (promotion) {
      const normalizedTarget = targetPath ? normalizeMemoryPath(targetPath) : promotion.target_path;
      this.db
        .prepare(
          `UPDATE memory_promotions
           SET target_path = ?, proposed_node_json = ?, reason = COALESCE(?, reason), updated_at = ?
           WHERE workspace_id = ? AND id = ?`
        )
        .run(
          normalizedTarget,
          JSON.stringify({
            ...proposed,
            source_path: updatedNode.source_path,
            target_path: normalizedTarget,
            candidate_node_id: updatedNode.id,
            scope: updatedNode.scope,
            project_id: updatedNode.project_id,
            project_slug: updatedNode.project_slug,
            repo_id: updatedNode.repo_id,
            repo_path: updatedNode.repo_path,
            session_id: updatedNode.session_id,
            agent_id: updatedNode.agent_id,
            contact_id: updatedNode.contact_id,
            run_id: updatedNode.run_id,
            protected_target: Boolean(this.matchProtectedPath(workspaceId, normalizedTarget))
          }),
          input.reason ?? null,
          now,
          workspaceId,
          promotion.id
        );
      promotion = this.getPromotion(workspaceId, promotion.id);
    } else if (targetPath) {
      promotion = this.createPromotionForCandidateNode(workspaceId, updatedNode, {
        target_path: targetPath,
        actor,
        reason: input.reason,
        scope: nextScope.scope,
        project_id: nextScope.project_id ?? undefined,
        project_slug: nextScope.project_slug ?? undefined,
        repo_id: nextScope.repo_id ?? undefined,
        repo_path: nextScope.repo_path ?? undefined,
        session_id: nextScope.session_id ?? undefined,
        agent_id: nextScope.agent_id ?? undefined,
        contact_id: nextScope.contact_id ?? undefined,
        run_id: nextScope.run_id ?? undefined
      });
    }

    this.insertReview(workspaceId, promotion?.id ?? null, updatedNode.id, "edited", actor, input.reason);
    this.audit(workspaceId, actor, "candidate.edited", {
      node_id: updatedNode.id,
      promotion_id: promotion?.id ?? null,
      status: nextStatus,
      target_path: promotion?.target_path ?? null
    });
    if (nextStatus === "stale") {
      this.audit(workspaceId, actor, "candidate.marked_stale", {
        node_id: updatedNode.id,
        promotion_id: promotion?.id ?? null,
        reason: input.reason ?? null
      });
    }
    if (nextStatus === "conflicted") {
      this.audit(workspaceId, actor, "candidate.marked_conflicted", {
        node_id: updatedNode.id,
        promotion_id: promotion?.id ?? null,
        reason: input.reason ?? null
      });
    }

    return this.getCandidate(workspaceId, updatedNode.id);
  }

  async approveCandidate(
    workspaceId: string,
    candidateId: string,
    input: ApproveMemoryCandidateInput = {}
  ): Promise<MemoryCandidate> {
    const candidate = this.getCandidate(workspaceId, candidateId);
    const reviewer = input.reviewer ?? "human:reviewer";
    let promotionId = candidate.promotion_id;
    const currentPromotion = promotionId ? this.getPromotion(workspaceId, promotionId) : null;
    const targetPath = input.promotion_target_path ?? input.target_path ?? candidate.promotion_target_path;
    if (candidate.status === "duplicate" || candidate.duplicate_of) {
      this.audit(workspaceId, reviewer, "candidate.approval_blocked_duplicate", {
        node_id: candidate.node.id,
        duplicate_of: candidate.duplicate_of,
        comment: input.comment ?? null
      });
      throw new MemoryFSError("Duplicate candidates must be edited or rejected before approval.", 409);
    }
    if (candidate.status === "conflicted" || candidate.conflict_reason) {
      this.audit(workspaceId, reviewer, "candidate.approval_blocked_conflict", {
        node_id: candidate.node.id,
        conflicts_with: candidate.conflicts_with,
        conflict_reason: candidate.conflict_reason,
        comment: input.comment ?? null
      });
      throw new MemoryFSError("Conflicting candidates require resolution before approval.", 409);
    }
    const detectedConflicts = await this.detectApprovalConflicts(
      workspaceId,
      candidate.node,
      targetPath,
      currentPromotion?.append !== 0
    );
    if (detectedConflicts.length > 0) {
      const conflictReason = summarizeConflictReasons(detectedConflicts);
      this.markCandidateConflict(workspaceId, candidate.node.id, detectedConflicts.map((conflict) => conflict.node_id), conflictReason, reviewer);
      throw new MemoryFSError("Conflicting candidates require resolution before approval.", 409);
    }
    if (!promotionId) {
      if (!targetPath) {
        throw new MemoryFSError("Approving a candidate requires a promotion target path.");
      }
      const promotion = this.createPromotionForCandidateNode(workspaceId, candidate.node, {
        target_path: targetPath,
        actor: reviewer,
        reason: candidate.reason ?? input.comment
      });
      promotionId = promotion.id;
    }
    await this.approvePromotion(workspaceId, promotionId, reviewer, input.comment, input.apply ?? true);
    return this.getCandidate(workspaceId, candidate.id);
  }

  rejectCandidate(
    workspaceId: string,
    candidateId: string,
    input: RejectMemoryCandidateInput = {}
  ): MemoryCandidate {
    const candidate = this.getCandidate(workspaceId, candidateId);
    const reviewer = input.reviewer ?? "human:reviewer";
    if (candidate.promotion_id) {
      this.rejectPromotion(workspaceId, candidate.promotion_id, reviewer, input.comment);
      return this.getCandidate(workspaceId, candidate.id);
    }
    this.markMemoryNodeTrust(workspaceId, candidate.node.id, "rejected", "rejected");
    this.insertReview(workspaceId, null, candidate.node.id, "rejected", reviewer, input.comment);
    this.audit(workspaceId, reviewer, "candidate.rejected", {
      node_id: candidate.node.id,
      promotion_id: null,
      comment: input.comment ?? null
    });
    return this.getCandidate(workspaceId, candidate.id);
  }

  resolveCandidateConflict(
    workspaceId: string,
    candidateId: string,
    input: ResolveCandidateConflictInput
  ): MemoryCandidate {
    const candidate = this.getCandidate(workspaceId, candidateId);
    const actor = input.actor ?? input.reviewer ?? "human:reviewer";
    if (!isCandidateConflictResolutionMode(input.mode)) {
      throw new MemoryFSError("Candidate conflict resolution mode must be keep_new, keep_old, keep_both, or mark_superseded.");
    }
    if (candidate.status !== "conflicted" && !candidate.conflict_reason && candidate.conflicts_with.length === 0) {
      throw new MemoryFSError("Candidate has no conflicts to resolve.");
    }
    const reason = input.reason?.trim() || `Resolved candidate conflict with mode ${input.mode}.`;
    const conflictsWith = candidate.conflicts_with;

    if (input.mode === "keep_old") {
      const rejected = this.rejectCandidate(workspaceId, candidate.id, {
        reviewer: actor,
        comment: reason
      });
      this.audit(workspaceId, actor, "candidate.conflict_resolved", {
        node_id: candidate.node.id,
        mode: input.mode,
        conflicts_with: conflictsWith,
        reason
      });
      return rejected;
    }

    if (input.mode === "mark_superseded") {
      for (const oldNodeId of conflictsWith) {
        this.supersedeMemory(workspaceId, oldNodeId, candidate.node.id, {
          actor,
          reason
        });
      }
    }

    const targetPath = input.promotion_target_path ?? input.target_path;
    this.db
      .prepare(
        `UPDATE memory_nodes
         SET status = ?, conflict_reason = NULL, stale_reason = NULL, updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .run("candidate", isoNow(), workspaceId, candidate.node.id);

    if (targetPath) {
      this.updateCandidate(workspaceId, candidate.id, {
        target_path: targetPath,
        actor,
        reason
      });
    }

    this.insertReview(workspaceId, candidate.promotion_id, candidate.node.id, "conflict_resolved", actor, reason);
    this.audit(workspaceId, actor, "candidate.conflict_resolved", {
      node_id: candidate.node.id,
      mode: input.mode,
      conflicts_with: conflictsWith,
      target_path: targetPath ?? candidate.promotion_target_path,
      reason
    });
    return this.getCandidate(workspaceId, candidate.id);
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

    if (promotion.candidate_node_id) {
      const candidateNode = this.getMemoryNode(workspaceId, promotion.candidate_node_id);
      if (candidateNode.status === "duplicate" || candidateNode.duplicate_of) {
        this.audit(workspaceId, reviewer, "candidate.approval_blocked_duplicate", {
          node_id: candidateNode.id,
          duplicate_of: candidateNode.duplicate_of,
          promotion_id: promotion.id,
          comment: comment ?? null
        });
        throw new MemoryFSError("Duplicate candidates must be edited or rejected before approval.", 409);
      }
      if (candidateNode.status === "conflicted" || candidateNode.conflict_reason) {
        this.audit(workspaceId, reviewer, "candidate.approval_blocked_conflict", {
          node_id: candidateNode.id,
          conflicts_with: candidateNode.conflicts_with,
          conflict_reason: candidateNode.conflict_reason,
          promotion_id: promotion.id,
          comment: comment ?? null
        });
        throw new MemoryFSError("Conflicting candidates require resolution before approval.", 409);
      }
      const detectedConflicts = await this.detectApprovalConflicts(
        workspaceId,
        candidateNode,
        promotion.target_path,
        promotion.append !== 0
      );
      if (detectedConflicts.length > 0) {
        const conflictReason = summarizeConflictReasons(detectedConflicts);
        this.markCandidateConflict(
          workspaceId,
          candidateNode.id,
          detectedConflicts.map((conflict) => conflict.node_id),
          conflictReason,
          reviewer
        );
        throw new MemoryFSError("Conflicting candidates require resolution before approval.", 409);
      }
    }

    this.updatePromotionStatus(workspaceId, promotionId, "approved", reviewer);
    this.insertReview(workspaceId, promotionId, promotion.candidate_node_id, "approved", reviewer, comment);
    this.audit(workspaceId, reviewer, "memory_promotion_approved", {
      promotion_id: promotionId,
      comment: comment ?? null
    });
    this.audit(workspaceId, reviewer, "candidate.approved", {
      node_id: promotion.candidate_node_id,
      promotion_id: promotionId,
      comment: comment ?? null
    });

    if (promotion.candidate_node_id) {
      this.markMemoryNodeTrust(workspaceId, promotion.candidate_node_id, "reviewed", "approved");
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
    this.audit(workspaceId, reviewer, "candidate.rejected", {
      node_id: promotion.candidate_node_id,
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
    const now = isoNow();
    this.db
      .prepare("UPDATE memory_nodes SET trust_level = ?, status = ?, valid_from = COALESCE(valid_from, ?), last_confirmed_at = ?, updated_at = ? WHERE source_file_id = ?")
      .run("trusted", "approved", now, now, now, targetFile.id);
    if (promotion.candidate_node_id) {
      this.markMemoryNodeTrust(workspaceId, promotion.candidate_node_id, "trusted", "approved");
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
      const validUntil = typeof row.valid_until === "string" ? row.valid_until : null;
      return (
        row.status === "stale" ||
        row.status === "conflicted" ||
        row.status === "superseded" ||
        row.trust_level === "superseded" ||
        Boolean(ttl && new Date(ttl).getTime() < Date.now()) ||
        Boolean(validUntil && new Date(validUntil).getTime() < Date.now())
      );
    }).length;
    const oldNodeCount = rows.filter((row) => {
      if (row.status === "rejected" || row.trust_level === "rejected") return false;
      const lastConfirmed = typeof row.last_confirmed_at === "string" ? row.last_confirmed_at : null;
      const updatedAt = typeof row.updated_at === "string" ? row.updated_at : "";
      return ageDays(lastConfirmed ?? updatedAt) > 90;
    }).length;
    const unconfirmedNodeCount = rows.filter((row) => {
      if (row.status === "rejected" || row.trust_level === "rejected") return false;
      if (row.status === "candidate" || row.status === "pending" || row.status === "observed") return false;
      return !row.last_confirmed_at;
    }).length;
    const supersededNodeCount = rows.filter((row) => row.status === "superseded" || row.trust_level === "superseded").length;
    const conflictedNodeCount = rows.filter((row) => row.status === "conflicted").length;
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
        oldNodeCount * 1 -
        unconfirmedNodeCount * 1 -
        supersededNodeCount * 2 -
        conflictedNodeCount * 4 -
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
      old_node_count: oldNodeCount,
      unconfirmed_node_count: unconfirmedNodeCount,
      superseded_node_count: supersededNodeCount,
      conflicted_node_count: conflictedNodeCount,
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

  private async writeArchiveEntry(
    workspaceId: string,
    archiveType: ArchiveEntryType,
    input: ArchiveWriteInput
  ): Promise<ArchiveEntry> {
    this.getWorkspace(workspaceId);
    const normalizedType = normalizeArchiveEntryType(archiveType);
    const actor = input.actor ?? "human:archive";
    const content = input.content ?? "";
    const risk = detectSecretRisk(content);
    if (risk) {
      this.audit(workspaceId, actor, "archive_secret_blocked", {
        archive_type: normalizedType,
        title: input.title ?? null,
        risk
      });
      throw new MemoryFSError(`Archive content appears to contain a secret (${risk}). Remove the secret before importing.`, 422);
    }

    await this.ensureArchiveReadme(workspaceId, actor);
    const id = randomUUID();
    const title = (input.title ?? titleForArchiveType(normalizedType)).trim() || titleForArchiveType(normalizedType);
    const filePath = archivePathForEntry(normalizedType, title, id);
    const file = await this.writeFile(workspaceId, filePath, content, {
      actor,
      ingest: false
    });
    const entry = this.insertArchiveEntry(workspaceId, normalizedType, title, file, input.metadata ?? {}, actor, id);
    this.audit(workspaceId, actor, "archive_entry_written", {
      archive_id: entry.id,
      archive_type: entry.archive_type,
      title: entry.title,
      path: entry.path,
      raw_ref: entry.raw_ref
    });
    return entry;
  }

  private async ensureArchiveReadme(workspaceId: string, actor: string): Promise<void> {
    try {
      this.getFileByPath(workspaceId, "/archive/README.md");
      return;
    } catch {
      // Create a small helper file the first time an archive is used.
    }

    await this.writeFile(
      workspaceId,
      "/archive/README.md",
      [
        "# Archive",
        "",
        "This folder stores verbatim source material such as conversations, transcripts, imported sessions, and raw agent logs.",
        "Raw archive files are canonical. Memory candidates derived from archive entries must remain reviewable before becoming durable memory.",
        "",
        "- conversations: chat or coding-session transcripts",
        "- agent-runs: raw agent logs",
        "- imported: imported sessions and transcripts",
        "- raw: other verbatim source material"
      ].join("\n"),
      {
        actor,
        ingest: false
      }
    );
  }

  private insertArchiveEntry(
    workspaceId: string,
    archiveType: ArchiveEntryType,
    title: string,
    file: FileRecord,
    metadata: Record<string, unknown>,
    actor: string,
    id = randomUUID()
  ): ArchiveEntry {
    const now = isoNow();
    const entry: ArchiveEntry = {
      id,
      workspace_id: workspaceId,
      archive_type: archiveType,
      title,
      path: file.path,
      source_file_id: file.id,
      source_blob_sha256: file.current_blob_sha256,
      raw_ref: rawRefForFile(workspaceId, file),
      metadata_json: JSON.stringify({
        ...metadata,
        trust_level: "source_backed",
        canonical: "raw_file",
        source_kind: "archive"
      }),
      created_at: now,
      updated_at: now
    };
    this.db
      .prepare(
        `INSERT INTO archive_entries
         (id, workspace_id, archive_type, title, path, source_file_id, source_blob_sha256, raw_ref, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.workspace_id,
        entry.archive_type,
        entry.title,
        entry.path,
        entry.source_file_id,
        entry.source_blob_sha256,
        entry.raw_ref,
        entry.metadata_json,
        entry.created_at,
        entry.updated_at
      );
    this.recordSyncEvent(workspaceId, "archive_entries", entry.id, "insert", entry, actor, now);
    return entry;
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
    const scope = scopeMetadataForPath(file.path);
    this.db
      .prepare(
        `INSERT INTO memory_nodes
         (id, workspace_id, source_file_id, source_blob_sha256, summary, trigger, detail, raw_excerpt, raw_ref, source_location_json, tags_json, memory_type, importance, confidence, trust_level, status, ttl_expires_at, valid_from, valid_until, last_confirmed_at, last_used_at, stale_reason, scope, project_id, project_slug, repo_id, repo_path, session_id, agent_id, contact_id, run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        null,
        null,
        null,
        null,
        scope.scope,
        scope.project_id,
        scope.project_slug,
        scope.repo_id,
        scope.repo_path,
        scope.session_id,
        scope.agent_id,
        scope.contact_id,
        scope.run_id,
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
    this.linkNodeToSourceContext(workspaceId, createdNode, file, actor);
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

  private async detectCandidateReview(
    workspaceId: string,
    candidate: ExtractedMemoryNode,
    file: FileRecord,
    options: {
      target_path?: string;
      append?: boolean;
      scope: MemoryScopeMetadata;
      source_location?: Record<string, unknown>;
    }
  ): Promise<CandidateReviewDetection> {
    const targetPath = options.target_path ? normalizeMemoryPath(options.target_path) : null;
    const summaryEmbedding = await embedText(candidate.summary, this.memoryOptions);
    const duplicate = this.findCandidateDuplicate(workspaceId, candidate, file, {
      target_path: targetPath,
      scope: options.scope,
      summary_embedding: summaryEmbedding
    });
    if (duplicate) {
      return {
        status: "duplicate",
        duplicate_of: duplicate.node_id,
        conflicts_with: [],
        conflict_reason: null,
        duplicate_reason: duplicate.reason
      };
    }

    const conflicts = this.findCandidateConflicts(workspaceId, candidate, {
      target_path: targetPath,
      append: options.append,
      scope: options.scope,
      summary_embedding: summaryEmbedding
    });
    if (conflicts.length > 0) {
      return {
        status: "conflicted",
        duplicate_of: null,
        conflicts_with: conflicts.map((conflict) => conflict.node_id),
        conflict_reason: summarizeConflictReasons(conflicts)
      };
    }

    return emptyCandidateReviewDetection();
  }

  private findCandidateDuplicate(
    workspaceId: string,
    candidate: ExtractedMemoryNode,
    file: FileRecord,
    options: {
      target_path: string | null;
      scope: MemoryScopeMetadata;
      summary_embedding: number[];
    }
  ): { node_id: string; reason: string; confidence: number } | null {
    const candidateText = normalizedMemoryText(candidateComparableText(candidate));
    const promotionsByCandidate = this.promotionsByCandidate(workspaceId);
    let bestSemantic: { node_id: string; reason: string; confidence: number } | null = null;

    for (const node of this.listMemoryNodes(workspaceId)) {
      if (node.status === "rejected" || node.trust_level === "rejected") continue;
      if (!isCandidateDuplicateTarget(node, promotionsByCandidate.has(node.id))) continue;
      const nodeTextNormalized = normalizedMemoryText(memoryTextForCandidate(node));
      const nodeTarget = promotionsByCandidate.get(node.id)?.target_path ?? node.source_path;
      const sameTypeScope = node.memory_type === candidate.memory_type && memoryScopeMetadataMatches(node, options.scope);

      if (candidateText && candidateText === nodeTextNormalized) {
        return {
          node_id: node.id,
          confidence: 0.99,
          reason: "Normalized candidate text exactly matches an existing memory."
        };
      }

      if (
        sameTypeScope &&
        node.source_file_id === file.id &&
        node.source_blob_sha256 === file.current_blob_sha256 &&
        normalizedMemoryText(node.raw_excerpt ?? node.summary) === normalizedMemoryText(candidate.raw_excerpt || candidate.summary)
      ) {
        return {
          node_id: node.id,
          confidence: 0.98,
          reason: "Candidate has the same source reference, type, scope, and source excerpt as an existing memory."
        };
      }

      if (sameTypeScope && options.target_path && nodeTarget === options.target_path && candidateText === nodeTextNormalized) {
        return {
          node_id: node.id,
          confidence: 0.98,
          reason: "Candidate has the same type, scope, target path, and normalized text as an existing memory."
        };
      }

      if (
        candidate.memory_type === "reasoning_memory" &&
        node.memory_type === "reasoning_memory" &&
        normalizedMemoryText(node.summary) === normalizedMemoryText(candidate.summary) &&
        normalizedMemoryText(node.trigger) === normalizedMemoryText(candidate.trigger)
      ) {
        return {
          node_id: node.id,
          confidence: 0.99,
          reason: "Reasoning memory title and trigger match an existing reasoning memory."
        };
      }

      if (sameTypeScope) {
        const embeddings = this.getNodeEmbeddings(node.id);
        const similarity = unitSimilarity(cosineSimilarity(options.summary_embedding, embeddings.summary ?? []));
        if (similarity >= 0.96 && (!bestSemantic || similarity > bestSemantic.confidence)) {
          bestSemantic = {
            node_id: node.id,
            confidence: similarity,
            reason: "Semantic similarity indicates this candidate duplicates an existing memory."
          };
        }
      }
    }

    return bestSemantic;
  }

  private findCandidateConflicts(
    workspaceId: string,
    candidate: ExtractedMemoryNode,
    options: {
      target_path: string | null;
      append?: boolean;
      scope: MemoryScopeMetadata;
      summary_embedding: number[];
      exclude_node_ids?: string[];
    }
  ): Array<{ node_id: string; reason: string; confidence: number }> {
    const conflicts = new Map<string, { node_id: string; reason: string; confidence: number }>();
    const candidateLike = memoryNodeFromExtracted(candidate);
    const candidateText = candidateComparableText(candidate);
    const excluded = new Set(options.exclude_node_ids ?? []);

    for (const node of this.listMemoryNodes(workspaceId)) {
      if (excluded.has(node.id)) continue;
      if (!isDurableConflictTarget(node)) continue;
      const sameScope = memoryScopeMetadataMatches(node, options.scope);
      const sameType = node.memory_type === candidate.memory_type;
      const nodeTextValue = memoryTextForCandidate(node);
      const overlap = tokenOverlap(nodeTextValue, candidateText);
      const embeddings = this.getNodeEmbeddings(node.id);
      const similarity = unitSimilarity(cosineSimilarity(options.summary_embedding, embeddings.summary ?? []));
      const relation = classifyNodeRelation(node, candidateLike, similarity);

      if (options.target_path && options.append === false && node.source_path === options.target_path) {
        conflicts.set(node.id, {
          node_id: node.id,
          confidence: 0.88,
          reason: `Candidate would overwrite ${options.target_path}, which already has approved or active memory.`
        });
        continue;
      }

      if (sameScope && sameType && relation.relation === "contradicts") {
        conflicts.set(node.id, {
          node_id: node.id,
          confidence: relation.confidence,
          reason: relation.reason
        });
        continue;
      }

      if (sameScope && candidate.memory_type === "decision" && looksContradictory(nodeTextValue, candidateText) && overlap > 0.28) {
        conflicts.set(node.id, {
          node_id: node.id,
          confidence: 0.82,
          reason: "Newer decision appears to contradict an older decision in the same scope."
        });
        continue;
      }

      if (
        sameScope &&
        /\b(no longer|does not apply|no longer applies|obsolete|replace|replaces|supersede|supersedes)\b/i.test(candidateText) &&
        overlap > 0.28
      ) {
        conflicts.set(node.id, {
          node_id: node.id,
          confidence: 0.82,
          reason: "Candidate says a previous constraint or decision no longer applies."
        });
      }
    }

    return [...conflicts.values()].sort((left, right) => right.confidence - left.confidence).slice(0, 8);
  }

  private recordCandidateReviewDetection(
    workspaceId: string,
    node: MemoryNode,
    review: CandidateReviewDetection,
    actor: string
  ): void {
    if (review.duplicate_of) {
      this.linkMemoryNodes(workspaceId, node.id, review.duplicate_of, "duplicates", {
        confidence: 0.96,
        reason: review.duplicate_reason ?? "Candidate duplicates an existing memory.",
        actor
      });
      this.audit(workspaceId, actor, "candidate.duplicate_detected", {
        node_id: node.id,
        duplicate_of: review.duplicate_of,
        reason: review.duplicate_reason ?? null
      });
    }

    if (review.conflicts_with.length > 0) {
      for (const conflictNodeId of review.conflicts_with) {
        this.linkMemoryNodes(workspaceId, node.id, conflictNodeId, "contradicts", {
          confidence: 0.84,
          reason: review.conflict_reason ?? "Candidate conflicts with existing memory.",
          actor
        });
      }
      this.audit(workspaceId, actor, "candidate.conflict_detected", {
        node_id: node.id,
        conflicts_with: review.conflicts_with,
        conflict_reason: review.conflict_reason
      });
    }
  }

  private async detectApprovalConflicts(
    workspaceId: string,
    candidate: MemoryNode,
    targetPath: string | null,
    append = true
  ): Promise<Array<{ node_id: string; reason: string; confidence: number }>> {
    if (candidate.conflicts_with.length > 0 && !candidate.conflict_reason && candidate.status !== "conflicted") {
      return [];
    }
    return this.findCandidateConflicts(workspaceId, extractedFromMemoryNode(candidate), {
      target_path: targetPath ? normalizeMemoryPath(targetPath) : null,
      append,
      scope: candidate,
      summary_embedding: await embedText(candidate.summary, this.memoryOptions),
      exclude_node_ids: [candidate.id, ...candidate.conflicts_with]
    });
  }

  private markCandidateConflict(
    workspaceId: string,
    candidateId: string,
    conflictsWith: string[],
    conflictReason: string,
    actor: string
  ): void {
    const now = isoNow();
    this.db
      .prepare(
        `UPDATE memory_nodes
         SET status = ?, conflict_reason = ?, conflicts_with_json = ?, stale_reason = COALESCE(stale_reason, ?), updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .run("conflicted", conflictReason, JSON.stringify([...new Set(conflictsWith)]), conflictReason, now, workspaceId, candidateId);
    for (const conflictNodeId of conflictsWith) {
      this.linkMemoryNodes(workspaceId, candidateId, conflictNodeId, "contradicts", {
        confidence: 0.84,
        reason: conflictReason,
        actor
      });
    }
    this.insertReview(workspaceId, null, candidateId, "conflicted", actor, conflictReason);
    this.audit(workspaceId, actor, "candidate.conflict_detected", {
      node_id: candidateId,
      conflicts_with: conflictsWith,
      conflict_reason: conflictReason
    });
  }

  private async insertCandidateMemoryNode(
    workspaceId: string,
    file: FileRecord,
    extractedNode: ExtractedMemoryNode,
    actor: string,
    sourceLocation?: Record<string, unknown>,
    options: { target_path?: string; append?: boolean; detect_candidate_review?: boolean; scope?: MemoryScopeMetadata } = {}
  ): Promise<MemoryNode> {
    const now = isoNow();
    const nodeId = randomUUID();
    const rawRef = `memoryfs://${workspaceId}${file.path}#${file.current_blob_sha256}`;
    const scope = options.scope ?? scopeMetadataForPath(file.path);
    const review = options.detect_candidate_review === false
      ? emptyCandidateReviewDetection()
      : await this.detectCandidateReview(workspaceId, extractedNode, file, {
        target_path: options.target_path,
        append: options.append,
        scope,
        source_location: sourceLocation
      });
    this.db
      .prepare(
        `INSERT INTO memory_nodes
         (id, workspace_id, source_file_id, source_blob_sha256, summary, trigger, detail, raw_excerpt, raw_ref, source_location_json, tags_json, memory_type, importance, confidence, trust_level, status, ttl_expires_at, valid_from, valid_until, last_confirmed_at, last_used_at, stale_reason, duplicate_of, conflicts_with_json, conflict_reason, scope, project_id, project_slug, repo_id, repo_path, session_id, agent_id, contact_id, run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        "agent_generated",
        review.status,
        null,
        now,
        null,
        null,
        null,
        null,
        review.duplicate_of,
        JSON.stringify(review.conflicts_with),
        review.conflict_reason,
        scope.scope,
        scope.project_id,
        scope.project_slug,
        scope.repo_id,
        scope.repo_path,
        scope.session_id,
        scope.agent_id,
        scope.contact_id,
        scope.run_id,
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
      source_location: sourceLocation ?? null,
      memory_type: extractedNode.memory_type
    });
    this.audit(workspaceId, actor, "candidate.created", {
      node_id: nodeId,
      source_path: file.path,
      source_location: sourceLocation ?? null,
      memory_type: extractedNode.memory_type,
      status: review.status,
      duplicate_of: review.duplicate_of,
      conflicts_with: review.conflicts_with
    });
    const createdNode = this.getMemoryNode(workspaceId, nodeId);
    this.recordCandidateReviewDetection(workspaceId, createdNode, review, actor);
    this.linkNodeToSourceContext(workspaceId, createdNode, file, actor);
    return createdNode;
  }

  private async insertRunCandidateMemoryNode(
    workspaceId: string,
    file: FileRecord,
    extractedNode: ExtractedMemoryNode,
    actor: string,
    sourceLocation?: Record<string, unknown>
  ): Promise<MemoryNode> {
    const now = isoNow();
    const nodeId = randomUUID();
    const rawRef = `memoryfs://${workspaceId}${file.path}#${file.current_blob_sha256}`;
    const scope = scopeMetadataForPath(file.path);
    const review = await this.detectCandidateReview(workspaceId, extractedNode, file, {
      scope,
      source_location: sourceLocation
    });
    this.db
      .prepare(
        `INSERT INTO memory_nodes
         (id, workspace_id, source_file_id, source_blob_sha256, summary, trigger, detail, raw_excerpt, raw_ref, source_location_json, tags_json, memory_type, importance, confidence, trust_level, status, ttl_expires_at, valid_from, valid_until, last_confirmed_at, last_used_at, stale_reason, duplicate_of, conflicts_with_json, conflict_reason, scope, project_id, project_slug, repo_id, repo_path, session_id, agent_id, contact_id, run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        "agent_generated",
        review.status,
        null,
        now,
        null,
        null,
        null,
        null,
        review.duplicate_of,
        JSON.stringify(review.conflicts_with),
        review.conflict_reason,
        scope.scope,
        scope.project_id,
        scope.project_slug,
        scope.repo_id,
        scope.repo_path,
        scope.session_id,
        scope.agent_id,
        scope.contact_id,
        scope.run_id,
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
      source_location: sourceLocation ?? null,
      memory_type: extractedNode.memory_type
    });
    this.audit(workspaceId, actor, "candidate.created", {
      node_id: nodeId,
      source_path: file.path,
      source_location: sourceLocation ?? null,
      memory_type: extractedNode.memory_type,
      status: review.status,
      duplicate_of: review.duplicate_of,
      conflicts_with: review.conflicts_with
    });
    const createdNode = this.getMemoryNode(workspaceId, nodeId);
    this.recordCandidateReviewDetection(workspaceId, createdNode, review, actor);
    this.linkNodeToSourceContext(workspaceId, createdNode, file, actor);
    return createdNode;
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
      "candidates.md": "",
      "reasoning-memories.json": ""
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

  private pathHasOnlyStaleMemory(workspaceId: string, fileId: string): boolean {
    const rows = this.db
      .prepare(
        `SELECT memory_nodes.*, files.path AS source_path
         FROM memory_nodes
         JOIN files ON files.id = memory_nodes.source_file_id
         WHERE memory_nodes.workspace_id = ? AND memory_nodes.source_file_id = ?`
      )
      .all(workspaceId, fileId) as unknown as MemoryNodeRow[];
    if (rows.length === 0) return false;
    return rows.map(rowToMemoryNode).every(isStaleLikeMemory);
  }

  private linkNodeToSourceContext(workspaceId: string, node: MemoryNode, file: FileRecord, actor: string): void {
    this.createGraphObjectEdge(workspaceId, {
      from_type: graphTypeForMemoryNode(node),
      from_id: node.id,
      relation_type: "derived_from",
      to_type: "file",
      to_id: file.id,
      confidence: 1,
      reason: `Memory node was derived from ${file.path}.`,
      source_ref: node.raw_ref,
      actor
    });

    if (node.run_id) {
      try {
        this.createGraphObjectEdge(workspaceId, {
          from_type: graphTypeForMemoryNode(node),
          from_id: node.id,
          relation_type: "observed_in",
          to_type: "run",
          to_id: node.run_id,
          confidence: 0.95,
          reason: `Memory node was observed in run ${node.run_id}.`,
          source_ref: node.raw_ref,
          actor
        });
      } catch {
        // Older imported run folders may not have run metadata.
      }
    }

    const sameSourceRows = this.db
      .prepare(
        `SELECT memory_nodes.*, files.path AS source_path
         FROM memory_nodes
         JOIN files ON files.id = memory_nodes.source_file_id
         WHERE memory_nodes.workspace_id = ? AND memory_nodes.source_file_id = ? AND memory_nodes.id != ?
         ORDER BY memory_nodes.created_at DESC
         LIMIT 8`
      )
      .all(workspaceId, file.id, node.id) as unknown as MemoryNodeRow[];
    for (const other of sameSourceRows.map(rowToMemoryNode)) {
      this.linkMemoryNodes(workspaceId, node.id, other.id, "derived_from", {
        confidence: 0.86,
        reason: `Both memories were derived from ${file.path}.`,
        actor
      });
    }
  }

  private async dedupeReasoningMemories(
    workspaceId: string,
    run: AgentRun,
    candidates: ExtractedReasoningMemory[]
  ): Promise<ExtractedReasoningMemory[]> {
    const existingNodes = this.listMemoryNodes(workspaceId).filter((node) => node.memory_type === "reasoning_memory");
    const accepted: ExtractedReasoningMemory[] = [];
    const acceptedEmbeddings: Array<{ memory: ExtractedReasoningMemory; embedding: number[] }> = [];

    for (const candidate of candidates) {
      const candidateKey = reasoningMemoryKey(candidate);
      if (
        existingNodes.some((node) => {
          const existing = reasoningMemoryFromNode(node);
          return existing
            ? reasoningMemoryKey(existing) === candidateKey ||
                (existing.source_run === run.run_path &&
                  (normalizeReasoningText(existing.title) === normalizeReasoningText(candidate.title) ||
                    normalizeReasoningText(existing.trigger) === normalizeReasoningText(candidate.trigger)))
            : false;
        })
      ) {
        continue;
      }

      if (accepted.some((item) => reasoningMemoryKey(item) === candidateKey)) continue;
      const embedding = await embedText(reasoningMemorySemanticText(candidate), this.memoryOptions);
      const existingSimilar = existingNodes.some((node) => {
        const existing = reasoningMemoryFromNode(node);
        if (!existing) return false;
        const embeddings = this.getNodeEmbeddings(node.id);
        const summarySimilarity = unitSimilarity(cosineSimilarity(embedding, embeddings.summary ?? []));
        const triggerSimilarity = unitSimilarity(cosineSimilarity(embedding, embeddings.trigger ?? []));
        return existing.source_run === run.run_path && Math.max(summarySimilarity, triggerSimilarity) > 0.93;
      });
      if (existingSimilar) continue;

      const acceptedSimilar = acceptedEmbeddings.some(
        (entry) =>
          entry.memory.source_run === candidate.source_run &&
          unitSimilarity(cosineSimilarity(embedding, entry.embedding)) > 0.93
      );
      if (acceptedSimilar) continue;

      accepted.push(candidate);
      acceptedEmbeddings.push({ memory: candidate, embedding });
    }

    return accepted;
  }

  private reasoningCandidateFromNode(
    workspaceId: string,
    node: MemoryNode,
    override?: ExtractedReasoningMemory
  ): ReasoningMemoryCandidate {
    const reasoning = override ?? reasoningMemoryFromNode(node) ?? fallbackReasoningMemoryFromNode(node);
    return {
      id: node.id,
      node_id: node.id,
      type: "reasoning_memory",
      title: reasoning.title,
      trigger: reasoning.trigger,
      context: reasoning.context,
      strategy: reasoning.strategy,
      failure_pattern: reasoning.failure_pattern,
      success_pattern: reasoning.success_pattern,
      applies_to: reasoning.applies_to,
      preconditions: reasoning.preconditions,
      anti_patterns: reasoning.anti_patterns,
      source_run: reasoning.source_run,
      source_refs: reasoning.source_refs.map((sourcePath) => {
        const file = this.tryGetFileByPath(workspaceId, sourcePath);
        return {
          path: sourcePath,
          raw_ref: file ? rawRefForFile(workspaceId, file) : null
        };
      }),
      confidence: node.confidence,
      status: normalizeCandidateStatus(node, null),
      reason: reasoning.reason,
      raw_ref: node.raw_ref,
      node
    };
  }

  private async relevantRiskyBriefItems(
    workspaceId: string,
    query: string,
    request: BriefRequest
  ): Promise<BriefItem[]> {
    const queryEmbedding = await embedText(query, this.memoryOptions);
    const scopeOptions = briefScopeOptions(request);
    const items = this.listMemoryNodes(workspaceId)
      .filter((node) => {
        if (!isRiskyBriefNode(node)) return false;
        if (!memoryScopeMatches(node, scopeOptions)) return false;
        if (!request.include_recent_runs && node.memory_type === "run_summary") return false;
        return true;
      })
      .map((node) => {
        const embeddings = this.getNodeEmbeddings(node.id);
        const semantic = Math.max(
          unitSimilarity(cosineSimilarity(queryEmbedding, embeddings.summary ?? [])),
          unitSimilarity(cosineSimilarity(queryEmbedding, embeddings.trigger ?? [])),
          unitSimilarity(cosineSimilarity(queryEmbedding, embeddings.detail ?? []))
        );
        const lexical = keywordScore(query, `${node.summary} ${node.trigger} ${node.detail ?? ""} ${node.source_path}`);
        return toBriefItem(
          {
            node_id: node.id,
            type: "memory_node",
            summary: node.summary,
            trigger: node.trigger,
            detail: node.detail,
            tags: node.tags,
            memory_type: node.memory_type,
            importance: node.importance,
            confidence: node.confidence,
            trust_level: node.trust_level,
            status: node.status,
            scope: node.scope,
            project_id: node.project_id,
            project_slug: node.project_slug,
            repo_id: node.repo_id,
            repo_path: node.repo_path,
            session_id: node.session_id,
            agent_id: node.agent_id,
            contact_id: node.contact_id,
            run_id: node.run_id,
            score: Number(Math.max(semantic, lexical).toFixed(4)),
            source_path: node.source_path,
            raw_ref: node.raw_ref,
            warnings: riskyBriefWarnings(node)
          },
          true
        );
      })
      .filter((item) => item.score >= 0.15 || request.files?.some((file) => item.source.source_path.includes(file)));

    return sortBriefItems(items).slice(0, 8);
  }

  private promotionsByCandidate(workspaceId: string): Map<string, MemoryPromotion> {
    const promotions = this.listPromotions(workspaceId);
    const byCandidate = new Map<string, MemoryPromotion>();
    for (const promotion of promotions) {
      if (promotion.candidate_node_id && !byCandidate.has(promotion.candidate_node_id)) {
        byCandidate.set(promotion.candidate_node_id, promotion);
      }
    }
    return byCandidate;
  }

  private latestReviewForNode(workspaceId: string, nodeId: string): MemoryReview | null {
    const review = this.db
      .prepare("SELECT * FROM memory_reviews WHERE workspace_id = ? AND node_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(workspaceId, nodeId) as MemoryReview | undefined;
    return review ?? null;
  }

  private candidateCreatedBy(workspaceId: string, nodeId: string, promotion: MemoryPromotion | null): string {
    if (promotion?.actor) return promotion.actor;
    const events = this.db
      .prepare(
        `SELECT * FROM audit_events
         WHERE workspace_id = ? AND event_type IN ('candidate.created', 'memory_candidate_created', 'run_candidate_memory_created')
         ORDER BY created_at ASC`
      )
      .all(workspaceId) as unknown as AuditEvent[];
    for (const event of events) {
      const payload = parseMaybeObject(event.payload_json);
      if (payload?.node_id === nodeId) return event.actor;
    }
    return "unknown";
  }

  private memoryCandidateFromNode(
    workspaceId: string,
    node: MemoryNode,
    promotion: MemoryPromotion | null
  ): MemoryCandidate {
    const review = this.latestReviewForNode(workspaceId, node.id);
    const status = normalizeCandidateStatus(node, promotion);
    return {
      id: node.id,
      node_id: node.id,
      memory_text: memoryTextForCandidate(node),
      type: node.memory_type,
      scope: node.scope,
      source_refs: [
        {
          source_path: node.source_path,
          raw_ref: node.raw_ref,
          source_location: parseSourceLocation(node.source_location_json)
        }
      ],
      confidence: node.confidence,
      risk_flags: riskFlagsForCandidate(node, promotion, this.sourceExists(node)),
      status,
      valid_from: node.valid_from,
      valid_until: node.valid_until,
      last_confirmed_at: node.last_confirmed_at,
      last_used_at: node.last_used_at,
      supersedes: node.supersedes,
      superseded_by: node.superseded_by,
      stale_reason: node.stale_reason,
      duplicate_of: node.duplicate_of,
      conflicts_with: node.conflicts_with,
      conflict_reason: node.conflict_reason,
      created_by: this.candidateCreatedBy(workspaceId, node.id, promotion),
      created_at: node.created_at,
      reviewed_by: review?.reviewer ?? promotion?.reviewer ?? null,
      reviewed_at: review?.created_at ?? null,
      promotion_id: promotion?.id ?? null,
      promotion_target_path: promotion?.target_path ?? null,
      reason: promotion?.reason ?? null,
      node
    };
  }

  private createPromotionForCandidateNode(
    workspaceId: string,
    candidateNode: MemoryNode,
    request: Pick<
      PromoteMemoryRequest,
      | "target_path"
      | "actor"
      | "reason"
      | "append"
      | "scope"
      | "project_id"
      | "project_slug"
      | "repo_id"
      | "repo_path"
      | "session_id"
      | "agent_id"
      | "contact_id"
      | "run_id"
    >
  ): MemoryPromotion {
    const actor = request.actor ?? "agent:promotion";
    const targetPath = normalizeMemoryPath(request.target_path);
    this.ensureAuthorized(workspaceId, actor, "memory.promote", targetPath);
    const existing = this.db
      .prepare("SELECT * FROM memory_promotions WHERE workspace_id = ? AND candidate_node_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(workspaceId, candidateNode.id) as MemoryPromotion | undefined;
    if (existing) {
      this.db
        .prepare("UPDATE memory_promotions SET target_path = ?, reason = COALESCE(?, reason), updated_at = ? WHERE workspace_id = ? AND id = ?")
        .run(targetPath, request.reason ?? null, isoNow(), workspaceId, existing.id);
      return this.getPromotion(workspaceId, existing.id);
    }

    const proposed = extractedFromMemoryNode(candidateNode);
    const protectedTarget = this.matchProtectedPath(workspaceId, targetPath);
    const now = isoNow();
    const promotionScope = scopeMetadataFromRequest(
      {
        source_path: candidateNode.source_path,
        target_path: targetPath,
        actor,
        reason: request.reason,
        append: request.append,
        scope: request.scope,
        project_id: request.project_id,
        project_slug: request.project_slug,
        repo_id: request.repo_id,
        repo_path: request.repo_path,
        session_id: request.session_id,
        agent_id: request.agent_id,
        contact_id: request.contact_id,
        run_id: request.run_id
      },
      candidateNode
    );
    const promotion: MemoryPromotion = {
      id: randomUUID(),
      workspace_id: workspaceId,
      source_path: candidateNode.source_path,
      target_path: targetPath,
      source_node_id: null,
      proposed_node_json: JSON.stringify({
        ...proposed,
        source_path: candidateNode.source_path,
        target_path: targetPath,
        candidate_node_id: candidateNode.id,
        scope: promotionScope.scope,
        project_id: promotionScope.project_id,
        project_slug: promotionScope.project_slug,
        repo_id: promotionScope.repo_id,
        repo_path: promotionScope.repo_path,
        session_id: promotionScope.session_id,
        agent_id: promotionScope.agent_id,
        contact_id: promotionScope.contact_id,
        run_id: promotionScope.run_id,
        protected_target: Boolean(protectedTarget)
      }),
      status: "pending",
      actor,
      reviewer: null,
      reason: request.reason ?? null,
      append: request.append === false ? 0 : 1,
      candidate_node_id: candidateNode.id,
      scope: promotionScope.scope,
      project_id: promotionScope.project_id,
      project_slug: promotionScope.project_slug,
      repo_id: promotionScope.repo_id,
      repo_path: promotionScope.repo_path,
      session_id: promotionScope.session_id,
      agent_id: promotionScope.agent_id,
      contact_id: promotionScope.contact_id,
      run_id: promotionScope.run_id,
      created_at: now,
      updated_at: now
    };
    this.db
      .prepare(
        `INSERT INTO memory_promotions
         (id, workspace_id, source_path, target_path, source_node_id, proposed_node_json, status, actor, reviewer, reason, append, candidate_node_id, scope, project_id, project_slug, repo_id, repo_path, session_id, agent_id, contact_id, run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        promotion.scope,
        promotion.project_id,
        promotion.project_slug,
        promotion.repo_id,
        promotion.repo_path,
        promotion.session_id,
        promotion.agent_id,
        promotion.contact_id,
        promotion.run_id,
        promotion.created_at,
        promotion.updated_at
      );
    this.audit(workspaceId, actor, "memory_promotion_created", {
      promotion_id: promotion.id,
      source_path: candidateNode.source_path,
      target_path: targetPath,
      status: promotion.status,
      protected_target: Boolean(protectedTarget),
      scope: promotion.scope,
      candidate_node_id: candidateNode.id
    });
    return promotion;
  }

  private markMemoryNodeTrust(
    workspaceId: string,
    nodeId: string,
    trustLevel: MemoryTrustLevel,
    status: MemoryNodeStatus
  ): void {
    this.getMemoryNode(workspaceId, nodeId);
    const now = isoNow();
    const lastConfirmedAt = trustLevel === "trusted" || trustLevel === "reviewed" || status === "approved" ? now : null;
    const validUntil = trustLevel === "rejected" || trustLevel === "superseded" || status === "rejected" || status === "superseded" ? now : null;
    const staleReason = status === "superseded" ? "Superseded by newer memory." : null;
    this.db
      .prepare(
        `UPDATE memory_nodes
         SET trust_level = ?,
             status = ?,
             valid_from = COALESCE(valid_from, ?),
             valid_until = COALESCE(?, valid_until),
             last_confirmed_at = COALESCE(?, last_confirmed_at),
             stale_reason = COALESCE(?, stale_reason),
             updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .run(trustLevel, status, now, validUntil, lastConfirmedAt, staleReason, now, workspaceId, nodeId);
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

    const graphEdges = this.db.prepare("SELECT * FROM memory_graph_edges WHERE workspace_id = ?").all(workspaceId) as unknown as MemoryGraphEdge[];
    for (const edge of graphEdges) push("memory_graph_edge", edge.id, edge);

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
    this.db.prepare("DELETE FROM memory_graph_edges WHERE workspace_id = ?").run(workspaceId);
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

    for (const item of grouped.memory_graph_edge) {
      const edge = parseJson<MemoryGraphEdge>(item.item_json);
      this.db
        .prepare(
          `INSERT INTO memory_graph_edges
           (id, workspace_id, from_type, from_id, to_type, to_id, relation_type, confidence, reason, source_ref, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          edge.id,
          edge.workspace_id,
          edge.from_type,
          edge.from_id,
          edge.to_type,
          edge.to_id,
          edge.relation_type,
          edge.confidence,
          edge.reason,
          edge.source_ref,
          edge.created_at
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

  private markMemoryNodesUsed(workspaceId: string, nodeIds: string[]): void {
    const uniqueIds = [...new Set(nodeIds.filter(Boolean))];
    if (uniqueIds.length === 0) return;
    const now = isoNow();
    const update = this.db.prepare("UPDATE memory_nodes SET last_used_at = ? WHERE workspace_id = ? AND id = ?");
    for (const nodeId of uniqueIds) {
      update.run(now, workspaceId, nodeId);
    }
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

  private getRelatedNodes(workspaceId: string, nodeId: string, options: { include_stale?: boolean } = {}): Array<{
    node_id: string;
    relation_type: MemoryRelationType;
    summary: string;
    source_path: string;
    raw_ref: string;
    depth: number;
    score: number;
  }> {
    return this.findRelatedMemories(workspaceId, nodeId, {
      depth: 1,
      limit: 8,
      include_stale: options.include_stale
    }).map((entry) => ({
      node_id: entry.node.id,
      relation_type: entry.path[entry.path.length - 1]?.relation_type ?? "related_to",
      summary: entry.node.summary,
      source_path: entry.node.source_path,
      raw_ref: entry.node.raw_ref,
      depth: entry.depth,
      score: entry.score
    }));
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

  private audit(workspaceId: string | null, actor: string, eventType: string, payload: unknown): AuditEvent {
    const id = randomUUID();
    const createdAt = isoNow();
    const payloadJson = JSON.stringify(payload);
    this.db
      .prepare(
        "INSERT INTO audit_events (id, workspace_id, actor, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, workspaceId, actor, eventType, payloadJson, createdAt);
    if (workspaceId) {
      this.recordSyncEvent(workspaceId, "audit_events", id, "insert", {
        id,
        workspace_id: workspaceId,
        actor,
        event_type: eventType,
        payload_json: payloadJson,
        created_at: createdAt
      }, actor, createdAt);
    }
    return {
      id,
      workspace_id: workspaceId,
      actor,
      event_type: eventType,
      payload_json: payloadJson,
      created_at: createdAt
    };
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
  const inferred = scopeMetadataForPath(row.source_path);
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
    valid_from: row.valid_from ?? row.created_at ?? null,
    valid_until: row.valid_until ?? null,
    last_confirmed_at: row.last_confirmed_at ?? null,
    last_used_at: row.last_used_at ?? null,
    supersedes: [],
    superseded_by: [],
    stale_reason: row.stale_reason ?? null,
    duplicate_of: row.duplicate_of ?? null,
    conflicts_with: parseStringArray(row.conflicts_with_json),
    conflict_reason: row.conflict_reason ?? null,
    scope: row.scope ?? inferred.scope,
    project_id: row.project_id ?? inferred.project_id,
    project_slug: row.project_slug ?? inferred.project_slug,
    repo_id: row.repo_id ?? inferred.repo_id,
    repo_path: row.repo_path ?? inferred.repo_path,
    session_id: row.session_id ?? inferred.session_id,
    agent_id: row.agent_id ?? inferred.agent_id,
    contact_id: row.contact_id ?? inferred.contact_id,
    run_id: row.run_id ?? inferred.run_id,
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

function parseMaybeObject(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
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

function parseStringArray(jsonText: string | null | undefined): string[] {
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
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
  "candidates.md",
  "reasoning-memories.json"
] as const;

const durableCandidateTypes = new Set<MemoryType>(["decision", "constraint", "preference", "research_finding"]);

function normalizeCandidateStatuses(
  status: MemoryCandidateStatus | MemoryCandidateStatus[] | undefined
): MemoryCandidateStatus[] {
  const values = Array.isArray(status) ? status : status ? [status] : [];
  return values.filter((value): value is MemoryCandidateStatus => isMemoryCandidateStatus(value));
}

function isMemoryCandidateStatus(value: string): value is MemoryCandidateStatus {
  return ["observed", "candidate", "duplicate", "approved", "rejected", "superseded", "stale", "conflicted"].includes(value);
}

function isCandidateConflictResolutionMode(value: string): value is CandidateConflictResolutionMode {
  return value === "keep_new" || value === "keep_old" || value === "keep_both" || value === "mark_superseded";
}

const memoryRelationTypes: MemoryRelationType[] = [
  "related_to",
  "supports",
  "contradicts",
  "supersedes",
  "duplicates",
  "caused_by",
  "derived_from",
  "implemented_in",
  "observed_in",
  "applies_to",
  "blocked_by",
  "belongs_to_project",
  "used_in_run",
  "promoted_from"
];

function normalizeMemoryRelationType(value: string): MemoryRelationType {
  if ((memoryRelationTypes as string[]).includes(value)) return value as MemoryRelationType;
  throw new MemoryFSError(`Unsupported memory graph relation: ${value}.`);
}

function isMemoryNodeGraphType(type: MemoryGraphObjectType): boolean {
  return type === "memory_node" || type === "candidate" || type === "reasoning_memory";
}

function graphTypeForMemoryNode(node: MemoryNode): MemoryGraphObjectType {
  if (node.memory_type === "reasoning_memory") return "reasoning_memory";
  if (node.status === "candidate" || node.status === "pending" || node.status === "observed" || node.status === "duplicate" || node.status === "conflicted") return "candidate";
  return "memory_node";
}

function compareGraphEdges(left: MemoryGraphEdgePacket, right: MemoryGraphEdgePacket): number {
  const created = right.created_at.localeCompare(left.created_at);
  if (created !== 0) return created;
  const relation = left.relation_type.localeCompare(right.relation_type);
  if (relation !== 0) return relation;
  return left.id.localeCompare(right.id);
}

function graphEdgeOtherNodeId(edge: MemoryGraphEdgePacket, currentNodeId: string): string | null {
  if (isMemoryNodeGraphType(edge.from_type) && edge.from_id === currentNodeId && isMemoryNodeGraphType(edge.to_type)) return edge.to_id;
  if (isMemoryNodeGraphType(edge.to_type) && edge.to_id === currentNodeId && isMemoryNodeGraphType(edge.from_type)) return edge.from_id;
  return null;
}

function graphRelatedScore(path: MemoryGraphEdgePacket[], depth: number): number {
  const relationWeight = path.reduce((total, edge) => total + graphRelationWeight(edge.relation_type) * edge.confidence, 0) / Math.max(1, path.length);
  return Number(Math.max(0, Math.min(1, relationWeight / depth)).toFixed(4));
}

function graphRelationWeight(relation: MemoryRelationType): number {
  switch (relation) {
    case "supports":
    case "implemented_in":
    case "applies_to":
      return 1;
    case "derived_from":
    case "observed_in":
    case "promoted_from":
    case "used_in_run":
      return 0.92;
    case "supersedes":
    case "contradicts":
    case "blocked_by":
      return 0.86;
    case "duplicates":
      return 0.78;
    case "caused_by":
    case "belongs_to_project":
    case "related_to":
      return 0.72;
  }
}

function compareRelatedMemoryResults(left: RelatedMemoryResult, right: RelatedMemoryResult): number {
  if (left.depth !== right.depth) return left.depth - right.depth;
  if (right.score !== left.score) return right.score - left.score;
  return left.node.id.localeCompare(right.node.id);
}

function explainGraphPath(fromNode: MemoryNode, toNode: MemoryNode, path: MemoryGraphEdgePacket[]): string {
  const chain = path.map((edge) => `${edge.relation_type}${edge.reason ? ` (${edge.reason})` : ""}`).join(" -> ");
  return `${fromNode.summary} connects to ${toNode.summary} through ${path.length} edge${path.length === 1 ? "" : "s"}: ${chain}.`;
}

function normalizeCandidateNodeStatus(status: MemoryNodeStatus | MemoryCandidateStatus): MemoryNodeStatus {
  if (status === "pending") return "candidate";
  return status;
}

function normalizeCandidateStatus(node: MemoryNode, promotion: MemoryPromotion | null): MemoryCandidateStatus {
  if (node.status === "pending") return "candidate";
  if (isMemoryCandidateStatus(node.status) && node.status !== "candidate") return node.status;
  if (promotion?.status === "rejected") return "rejected";
  if (promotion?.status === "approved" || promotion?.status === "applied") return "approved";
  if (promotion?.status === "pending") return "candidate";
  if (node.trust_level === "rejected") return "rejected";
  if (node.trust_level === "superseded") return "superseded";
  if (node.trust_level === "reviewed" || node.trust_level === "trusted") return "approved";
  return "candidate";
}

function isCandidateNode(node: MemoryNode, hasPromotion: boolean): boolean {
  if (hasPromotion) return true;
  if (node.status === "pending" || node.status === "candidate") return true;
  if (isMemoryCandidateStatus(node.status) && node.status !== "approved") return true;
  return node.trust_level === "agent_generated" && /\/candidates\.md$/.test(node.source_path);
}

function isRejectedMemory(node: MemoryNode): boolean {
  return node.trust_level === "rejected" || node.status === "rejected";
}

function isCandidateLikeStatus(status: MemoryNodeStatus): boolean {
  return status === "pending" || status === "candidate" || status === "observed" || status === "duplicate";
}

function isStaleLikeMemory(node: MemoryNode): boolean {
  return (
    node.status === "stale" ||
    node.status === "conflicted" ||
    node.status === "duplicate" ||
    node.status === "superseded" ||
    node.trust_level === "superseded" ||
    Boolean(node.valid_until && new Date(node.valid_until).getTime() < Date.now())
  );
}

function trustLevelForCandidateStatus(status: MemoryNodeStatus, current: MemoryTrustLevel): MemoryTrustLevel {
  if (status === "rejected") return "rejected";
  if (status === "superseded") return "superseded";
  if (status === "approved") return current === "trusted" ? "trusted" : "reviewed";
  if (status === "observed") return current === "agent_generated" ? "source_backed" : current;
  if (status === "candidate" || status === "pending" || status === "duplicate" || status === "conflicted") return "agent_generated";
  return current;
}

function memoryTextForCandidate(node: MemoryNode): string {
  return [node.summary, node.detail].filter(Boolean).join("\n\n");
}

function riskFlagsForCandidate(node: MemoryNode, promotion: MemoryPromotion | null, sourceExists: boolean): string[] {
  const flags = new Set<string>();
  const sourceLocation = parseSourceLocation(node.source_location_json);
  const explicitFlags = sourceLocation?.risk_flags;
  if (Array.isArray(explicitFlags)) {
    for (const flag of explicitFlags) {
      if (typeof flag === "string" && flag.trim()) flags.add(flag.trim());
    }
  }
  if (node.confidence < 0.55) flags.add("low_confidence");
  if (!sourceExists) flags.add("source_missing");
  if (promotion?.target_path && defaultProtectedPathGlobs.some((glob) => globMatchesPath(glob, promotion.target_path))) {
    flags.add("protected_target");
  }
  if (node.status === "duplicate" || node.duplicate_of) flags.add("duplicate");
  if (node.status === "conflicted") flags.add("conflicted");
  if (node.conflict_reason || node.status === "conflicted") flags.add("conflict");
  if (node.status === "stale") flags.add("stale");
  return [...flags].sort();
}

function candidateInputRiskFlags(inputFlags: string[] | undefined, input: ProposeMemoryCandidateInput, content: string, sourcePath: string): string[] {
  const flags = new Set<string>();
  for (const flag of inputFlags ?? []) {
    if (flag.trim() && flag !== "none") flags.add(flag.trim());
  }
  const text = [content, input.memory_text, input.memory, input.summary, input.trigger, input.detail, input.reason]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
  for (const flag of riskFlagsForText(text, { source_kind: candidateSourceKindForPath(sourcePath) })) {
    if (flag !== "none") flags.add(flag);
  }
  return [...flags].sort();
}

function candidateSourceKindForPath(sourcePath: string): CandidateSourceKind {
  if (sourcePath.startsWith("/archive/")) return "archive";
  if (sourcePath.startsWith("/runs/")) return "agent_run";
  if (sourcePath.startsWith("/scratch/candidates/")) return "user_message";
  return "file";
}

function proposedNodeFromCandidateInput(
  input: ProposeMemoryCandidateInput,
  content: string,
  sourcePath: string
): ExtractedMemoryNode {
  const memoryText = (input.memory_text ?? input.memory ?? input.detail ?? content).trim();
  const summary = input.summary ?? firstDurableSentence(memoryText) ?? firstDurableSentence(content) ?? `Memory candidate from ${sourcePath}.`;
  const trigger = input.trigger ?? `Recall when working with ${sourcePath.split("/").filter(Boolean).slice(-2).join("/") || "this workspace"}.`;
  const detail = input.detail ?? (memoryText || summary);
  return {
    summary,
    trigger,
    detail,
    raw_excerpt: shortestExcerpt(memoryText || content),
    tags: [...new Set(["candidate", ...tagsFromPath(sourcePath)])],
    memory_type: input.memory_type ?? input.type ?? inferMemoryType(`${summary}\n${detail}`),
    importance: importanceFromContent(`${summary}\n${detail}`),
    confidence: clampConfidence(input.confidence ?? 0.72)
  };
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function reasoningMemoryToExtractedNode(memory: ExtractedReasoningMemory): ExtractedMemoryNode {
  return {
    summary: memory.title,
    trigger: memory.trigger,
    detail: [
      `Context: ${memory.context}`,
      `Strategy: ${memory.strategy}`,
      `Failure pattern: ${memory.failure_pattern}`,
      `Success pattern: ${memory.success_pattern}`,
      `Applies to: ${memory.applies_to.join(", ")}`,
      `Preconditions: ${memory.preconditions.join(", ")}`,
      `Anti-patterns: ${memory.anti_patterns.join(", ")}`,
      `Source run: ${memory.source_run}`,
      `Reason: ${memory.reason}`
    ].join("\n"),
    raw_excerpt: memory.title,
    tags: [...new Set(["reasoning", "lesson", ...memory.applies_to, ...memory.preconditions].map(slugifyTag))].slice(0, 8),
    memory_type: "reasoning_memory",
    importance: 4,
    confidence: memory.confidence
  };
}

function reasoningMemoryFromNode(node: MemoryNode): ExtractedReasoningMemory | null {
  const sourceLocation = parseSourceLocation(node.source_location_json);
  const value = sourceLocation?.reasoning_memory;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "reasoning_memory") return null;
  try {
    return {
      type: "reasoning_memory",
      title: stringField(candidate.title, node.summary),
      trigger: stringField(candidate.trigger, node.trigger),
      context: stringField(candidate.context, node.detail ?? node.summary),
      strategy: stringField(candidate.strategy, node.detail ?? node.summary),
      failure_pattern: stringField(candidate.failure_pattern, ""),
      success_pattern: stringField(candidate.success_pattern, ""),
      applies_to: stringArrayField(candidate.applies_to),
      preconditions: stringArrayField(candidate.preconditions),
      anti_patterns: stringArrayField(candidate.anti_patterns),
      source_run: stringField(candidate.source_run, runPathFromSourcePath(node.source_path)),
      source_refs: stringArrayField(candidate.source_refs),
      confidence: typeof candidate.confidence === "number" ? candidate.confidence : node.confidence,
      status: "candidate",
      reason: stringField(candidate.reason, "Derived from run artifacts.")
    };
  } catch {
    return null;
  }
}

function fallbackReasoningMemoryFromNode(node: MemoryNode): ExtractedReasoningMemory {
  const sourceRun = runPathFromSourcePath(node.source_path);
  return {
    type: "reasoning_memory",
    title: node.summary,
    trigger: node.trigger,
    context: node.detail ?? node.summary,
    strategy: node.detail ?? node.summary,
    failure_pattern: "",
    success_pattern: "",
    applies_to: node.tags,
    preconditions: [],
    anti_patterns: [],
    source_run: sourceRun,
    source_refs: [node.source_path],
    confidence: node.confidence,
    status: "candidate",
    reason: "Reasoning metadata was unavailable; reconstructed from the memory node."
  };
}

function reasoningMemoryKey(memory: Pick<ExtractedReasoningMemory, "title" | "trigger" | "source_run">): string {
  return `${normalizeReasoningText(memory.source_run)}:${normalizeReasoningText(memory.title)}:${normalizeReasoningText(memory.trigger)}`;
}

function reasoningMemorySemanticText(memory: ExtractedReasoningMemory): string {
  return [memory.title, memory.trigger, memory.context, memory.strategy, memory.failure_pattern, memory.success_pattern].join("\n");
}

function normalizeReasoningText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function runPathFromSourcePath(sourcePath: string): string {
  const parts = sourcePath.split("/").filter(Boolean);
  return parts[0] === "runs" && parts[1] ? `/runs/${parts[1]}` : sourcePath;
}

function slugifyTag(text: string): string {
  return slugify(text).slice(0, 32) || "reasoning";
}

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
  includeOpenQuestions: boolean,
  riskyItems: BriefItem[],
  likelyFiles: string[]
): BriefSections {
  const items = sortBriefItems(results.map((result) => toBriefItem(result)));
  const facts = items.filter((item) => item.memory_type === "fact");
  const decisions = items.filter((item) => item.memory_type === "decision");
  const constraints = items.filter((item) => item.memory_type === "constraint");
  const preferences = items.filter((item) => item.memory_type === "preference");
  const previousFailures = items.filter((item) => item.memory_type === "error");
  const reasoningMemories = items.filter((item) => item.memory_type === "reasoning_memory");
  const successfulPatterns = items.filter(isSuccessfulBriefPattern);
  const openQuestions = includeOpenQuestions
    ? items.filter((item) => item.memory_type === "unresolved_question")
    : [];
  const suggestedFiles = [...new Set([...likelyFiles, ...items.map((item) => item.source.source_path)])].slice(0, 12);
  const likelyPaths = [...new Set([...suggestedFiles, ...items.map((item) => item.source.source_path)])].slice(0, 16);
  const warnings = [...new Set([...items.flatMap((item) => item.warnings), ...riskyItems.flatMap((item) => item.warnings)])];
  return {
    facts,
    decisions,
    constraints,
    preferences,
    previous_failures: previousFailures,
    previous_errors: previousFailures,
    successful_patterns: successfulPatterns,
    reasoning_memories: reasoningMemories,
    stale_or_conflicted: riskyItems,
    open_questions: openQuestions,
    suggested_files: suggestedFiles,
    likely_paths: likelyPaths,
    suggested_actions: [],
    warnings
  };
}

function renderBriefMarkdown(
  task: string,
  request: BriefRequest,
  sections: BriefSections,
  results: RecallResult[]
): string {
  return [
    `# Memory Brief`,
    "",
    `Task: ${task}`,
    request.project_hint || request.project_slug ? `Project: ${request.project_slug ?? request.project_hint}` : "",
    request.repo_path ? `Repo: ${request.repo_path}` : "",
    request.scope ? `Scope: ${Array.isArray(request.scope) ? request.scope.join(", ") : request.scope}` : "",
    "",
    renderBriefSection("Approved Facts", sections.facts),
    renderRecallSection("Decisions", sections.decisions),
    renderRecallSection("Constraints", sections.constraints),
    renderRecallSection("Preferences", sections.preferences),
    renderRecallSection("Previous Failures", sections.previous_failures),
    renderBriefSection("Successful Patterns", sections.successful_patterns),
    renderBriefSection("Reasoning Memories", sections.reasoning_memories),
    renderBriefSection("Avoid These Assumptions", sections.stale_or_conflicted),
    renderRecallSection("Open Questions", sections.open_questions),
    "## Likely Paths",
    sections.likely_paths.map((file) => `- ${file}`).join("\n") || "- None",
    "",
    "## Suggested Memory Actions",
    sections.suggested_actions.map((action) => `- ${action}`).join("\n") || "- None",
    "",
    "## Warnings",
    sections.warnings.map((warning) => `- ${warning}`).join("\n") || "- None",
    "",
    "## Recall Results",
    results.map((result) => `- ${result.summary} (${result.source_path}, ${result.trust_level ?? "unknown"}/${result.status ?? "unknown"})`).join("\n") || "- None"
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function renderRecallSection(title: string, results: BriefItem[]): string {
  return renderBriefSection(title, results);
}

function renderBriefSection(title: string, results: BriefItem[]): string {
  return [
    `## ${title}`,
    results.map((result) =>
      [
        `- ${result.summary}`,
        `  - Source: ${result.source.source_path}`,
        `  - Trust: ${result.trust_level ?? "unknown"}; status: ${result.status ?? "unknown"}; score: ${result.score.toFixed(2)}`
      ].join("\n")
    ).join("\n") || "- None",
    ""
  ].join("\n");
}

function toBriefItem(result: RecallResult, risky = false): BriefItem {
  const warnings = [...(result.warnings ?? [])];
  if (risky) {
    if (result.status === "stale") warnings.push("Marked stale.");
    if (result.status === "conflicted") warnings.push("Marked conflicted.");
    if (result.status === "duplicate") warnings.push("Marked duplicate.");
    if (result.status === "superseded" || result.trust_level === "superseded") warnings.push("Superseded by newer memory.");
    if (result.status === "rejected" || result.trust_level === "rejected") warnings.push("Rejected memory.");
  }
  return {
    title: result.summary,
    summary: result.summary,
    detail: result.detail ?? null,
    memory_type: result.memory_type,
    trust_level: result.trust_level ?? null,
    status: result.status ?? null,
    score: result.score,
    source: {
      node_id: result.node_id,
      source_path: result.source_path,
      raw_ref: result.raw_ref,
      trust_level: result.trust_level ?? null,
      status: result.status ?? null,
      score: result.score,
      scope: result.scope ?? null,
      project_slug: result.project_slug ?? null,
      repo_path: result.repo_path ?? null,
      run_id: result.run_id ?? null
    },
    tags: result.tags,
    warnings: [...new Set(warnings)]
  };
}

function sortBriefItems(items: BriefItem[]): BriefItem[] {
  return [...items].sort((left, right) => briefItemRank(right) - briefItemRank(left));
}

function briefItemRank(item: BriefItem): number {
  const trust = item.trust_level ? trustRank(item.trust_level) / 6 : 0;
  const statusPenalty = item.status === "candidate" ? 0.12 : item.status === "superseded" || item.status === "stale" || item.status === "conflicted" || item.status === "duplicate" ? 0.3 : 0;
  return item.score + trust * 0.18 - statusPenalty;
}

function isSuccessfulBriefPattern(item: BriefItem): boolean {
  if (item.memory_type === "reasoning_memory") return true;
  const text = `${item.summary} ${item.detail ?? ""}`.toLowerCase();
  return /\b(success|succeeded|successful|fixed|resolved|passed|worked|avoid(?:ed)?|strategy|pattern)\b/.test(text);
}

function shouldIncludeInBriefMainResults(result: RecallResult, includeCandidates: boolean): boolean {
  if (result.status === "rejected" || result.trust_level === "rejected") return false;
  if (result.status === "stale" || result.status === "conflicted" || result.status === "duplicate" || result.status === "superseded") return false;
  if (result.trust_level === "superseded") return false;
  if (result.status === "candidate") return includeCandidates;
  return true;
}

function isRiskyBriefNode(node: MemoryNode): boolean {
  return (
    node.status === "stale" ||
    node.status === "conflicted" ||
    node.status === "duplicate" ||
    node.status === "superseded" ||
    node.status === "rejected" ||
    node.trust_level === "superseded" ||
    node.trust_level === "rejected"
  );
}

function riskyBriefWarnings(node: MemoryNode): string[] {
  const warnings: string[] = [];
  if (node.status === "stale") warnings.push("Marked stale.");
  if (node.status === "conflicted") warnings.push("Marked conflicted.");
  if (node.status === "duplicate" || node.duplicate_of) warnings.push("Marked duplicate.");
  if (node.conflict_reason) warnings.push(`Conflict: ${node.conflict_reason}`);
  if (node.status === "superseded" || node.trust_level === "superseded") warnings.push("Superseded by newer memory.");
  if (node.status === "rejected" || node.trust_level === "rejected") warnings.push("Rejected memory.");
  return warnings;
}

function briefScopeOptions(request: BriefRequest): Pick<
  RecallOptions,
  "scope" | "project_id" | "project_slug" | "repo_id" | "repo_path" | "session_id" | "agent_id" | "contact_id" | "run_id"
> {
  const scope =
    request.scope ??
    (request.project_slug || request.project_id
      ? "project"
      : request.repo_path || request.repo_id
        ? "repo"
        : request.session_id
          ? "session"
          : request.agent_id
            ? "agent"
            : request.contact_id
              ? "contact"
              : request.run_id
                ? "run"
                : undefined);
  return {
    scope,
    project_id: request.project_id,
    project_slug: request.project_slug,
    repo_id: request.repo_id,
    repo_path: request.repo_path,
    session_id: request.session_id,
    agent_id: request.agent_id,
    contact_id: request.contact_id,
    run_id: request.run_id
  };
}

function suggestedBriefActions(request: BriefRequest, sections: BriefSections): string[] {
  const actions: string[] = [];
  if (!request.run_id && !request.create_run) actions.push("create run");
  if (sections.stale_or_conflicted.length > 0) actions.push("review stale or conflicted memory");
  if (sections.reasoning_memories.some((item) => item.status === "candidate")) actions.push("review reasoning memory candidates");
  if (sections.open_questions.length > 0) actions.push("resolve open memory questions");
  if (sections.suggested_files.length > 0) actions.push("open source refs before editing");
  return [...new Set(actions)];
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
  const age = ageDays(node.last_confirmed_at ?? node.updated_at);
  if (node.status === "rejected" || node.trust_level === "rejected") reasons.push("rejected");
  if (node.status === "stale") reasons.push("stale");
  if (node.status === "conflicted") reasons.push("conflicted");
  if (node.status === "duplicate" || node.duplicate_of) reasons.push("duplicate");
  if (node.status === "superseded" || node.trust_level === "superseded" || node.superseded_by.length > 0) reasons.push("superseded");
  if (node.conflict_reason) reasons.push(`conflict:${node.conflict_reason}`);
  if (node.stale_reason) reasons.push(`reason:${node.stale_reason}`);
  if (node.ttl_expires_at && new Date(node.ttl_expires_at).getTime() < Date.now()) reasons.push("expired_ttl");
  if (node.valid_until && new Date(node.valid_until).getTime() < Date.now()) reasons.push("valid_until_elapsed");
  if (!sourceExists) reasons.push("source_missing");
  if (node.confidence < 0.55) reasons.push("low_confidence");
  if (
    !node.last_confirmed_at &&
    age > 30 &&
    node.status !== "candidate" &&
    node.status !== "pending" &&
    node.status !== "observed" &&
    node.trust_level !== "trusted" &&
    node.trust_level !== "reviewed"
  ) {
    reasons.push("unconfirmed");
  }
  if (age > 90) reasons.push("old");
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

function rawRefForFile(workspaceId: string, file: FileRecord): string {
  return `memoryfs://${workspaceId}${file.path}#${file.current_blob_sha256}`;
}

type MemoryScopeMetadata = Pick<
  MemoryNode,
  "scope" | "project_id" | "project_slug" | "repo_id" | "repo_path" | "session_id" | "agent_id" | "contact_id" | "run_id"
>;

function emptyScopeMetadata(scope: MemoryScope): MemoryScopeMetadata {
  return {
    scope,
    project_id: null,
    project_slug: null,
    repo_id: null,
    repo_path: null,
    session_id: null,
    agent_id: null,
    contact_id: null,
    run_id: null
  };
}

function scopeMetadataForPath(filePath: string): MemoryScopeMetadata {
  const parts = filePath.split("/").filter(Boolean);
  const [zone, id] = parts;
  if (zone === "projects" && id) {
    return { ...emptyScopeMetadata("project"), project_slug: id };
  }
  if (zone === "runs" && id) {
    return { ...emptyScopeMetadata("run"), run_id: id };
  }
  if (zone === "repos" && id) {
    return { ...emptyScopeMetadata("repo"), repo_path: parts.slice(1).join("/") || id };
  }
  if (zone === "sessions" && id) {
    return { ...emptyScopeMetadata("session"), session_id: id };
  }
  if (zone === "agents" && id) {
    return { ...emptyScopeMetadata("agent"), agent_id: id };
  }
  if (zone === "contacts" && id) {
    return { ...emptyScopeMetadata("contact"), contact_id: id };
  }
  return emptyScopeMetadata("workspace");
}

function scopeMetadataFromRequest(request: PromoteMemoryRequest, fallback: MemoryScopeMetadata): MemoryScopeMetadata {
  return {
    scope: request.scope ?? fallback.scope,
    project_id: request.project_id ?? fallback.project_id,
    project_slug: request.project_slug ?? fallback.project_slug,
    repo_id: request.repo_id ?? fallback.repo_id,
    repo_path: request.repo_path ?? fallback.repo_path,
    session_id: request.session_id ?? fallback.session_id,
    agent_id: request.agent_id ?? fallback.agent_id,
    contact_id: request.contact_id ?? fallback.contact_id,
    run_id: request.run_id ?? fallback.run_id
  };
}

function scopeMetadataFromCandidateInput(
  request: ProposeMemoryCandidateInput,
  fallback: MemoryScopeMetadata
): MemoryScopeMetadata {
  const scope = request.scope ?? fallback.scope;
  return {
    scope,
    project_id: scope === "project" ? request.project_id ?? fallback.project_id : null,
    project_slug: scope === "project" ? request.project_slug ?? fallback.project_slug : null,
    repo_id: scope === "repo" ? request.repo_id ?? fallback.repo_id : null,
    repo_path: scope === "repo" ? request.repo_path ?? fallback.repo_path : null,
    session_id: scope === "session" ? request.session_id ?? fallback.session_id : null,
    agent_id: scope === "agent" ? request.agent_id ?? fallback.agent_id : null,
    contact_id: scope === "contact" ? request.contact_id ?? fallback.contact_id : null,
    run_id: scope === "run" ? request.run_id ?? fallback.run_id : null
  };
}

function scopeMetadataFromCandidateUpdate(request: UpdateMemoryCandidateInput, fallback: MemoryNode): MemoryScopeMetadata {
  const scope = request.scope ?? fallback.scope;
  return {
    scope,
    project_id: scope === "project" ? request.project_id ?? fallback.project_id : null,
    project_slug: scope === "project" ? request.project_slug ?? fallback.project_slug : null,
    repo_id: scope === "repo" ? request.repo_id ?? fallback.repo_id : null,
    repo_path: scope === "repo" ? request.repo_path ?? fallback.repo_path : null,
    session_id: scope === "session" ? request.session_id ?? fallback.session_id : null,
    agent_id: scope === "agent" ? request.agent_id ?? fallback.agent_id : null,
    contact_id: scope === "contact" ? request.contact_id ?? fallback.contact_id : null,
    run_id: scope === "run" ? request.run_id ?? fallback.run_id : null
  };
}

function normalizeMemoryScopes(scope: string | string[] | MemoryScope | MemoryScope[] | undefined): MemoryScope[] {
  const values = Array.isArray(scope) ? scope : scope ? [scope] : [];
  return values.filter((value): value is MemoryScope => isMemoryScope(value));
}

function isMemoryScope(value: string): value is MemoryScope {
  return ["global", "workspace", "project", "repo", "session", "agent", "contact", "run"].includes(value);
}

function memoryScopeMatches(node: MemoryScopeMetadata, options: {
  scope?: string | string[] | MemoryScope | MemoryScope[];
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
}): boolean {
  const scopes = normalizeMemoryScopes(options.scope);
  if (scopes.length > 0 && !scopes.includes(node.scope)) return false;
  if (options.project_id && node.project_id !== options.project_id) return false;
  if (options.project_slug && node.project_slug !== options.project_slug) return false;
  if (options.repo_id && node.repo_id !== options.repo_id) return false;
  if (options.repo_path && node.repo_path !== options.repo_path) return false;
  if (options.session_id && node.session_id !== options.session_id) return false;
  if (options.agent_id && node.agent_id !== options.agent_id) return false;
  if (options.contact_id && node.contact_id !== options.contact_id) return false;
  if (options.run_id && node.run_id !== options.run_id) return false;
  return true;
}

function recallScopesFromGrepOptions(options: MemoryGrepOptions): MemoryScope[] | undefined {
  const scopes = normalizeMemoryScopes(options.scope);
  if (scopes.length === 0 && options.run_id) return ["run"];
  return scopes.length > 0 ? scopes : undefined;
}

function recallScopeFilterOptions(options: RecallOptions): RecallOptions {
  const scopes = normalizeMemoryScopes(options.scope);
  return {
    ...options,
    run_id: scopes.includes("run") ? options.run_id : undefined
  };
}

function archivePathForEntry(archiveType: ArchiveEntryType, title: string, id: string): string {
  const dir = archiveDirectoryForType(archiveType);
  const readable = slugify(title).slice(0, 60) || archiveType;
  return `${dir}/${timestampSlug()}-${readable}-${id.slice(0, 8)}.txt`;
}

function normalizeArchiveEntryType(value: string): ArchiveEntryType {
  if (value === "conversation" || value === "transcript" || value === "imported" || value === "agent-run" || value === "raw") {
    return value;
  }
  throw new MemoryFSError(`Unsupported archive type: ${value}.`);
}

function archiveDirectoryForType(archiveType: ArchiveEntryType): string {
  switch (archiveType) {
    case "conversation":
      return "/archive/conversations";
    case "agent-run":
      return "/archive/agent-runs";
    case "transcript":
    case "imported":
      return "/archive/imported";
    case "raw":
      return "/archive/raw";
  }
}

function titleForArchiveType(archiveType: ArchiveEntryType): string {
  switch (archiveType) {
    case "conversation":
      return "Archived conversation";
    case "transcript":
      return "Archived transcript";
    case "agent-run":
      return "Archived agent run";
    case "raw":
      return "Raw archive";
    case "imported":
      return "Imported archive";
  }
}

function detectSecretRisk(content: string): string | null {
  const checks: Array<{ label: string; pattern: RegExp }> = [
    { label: "private key", pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i },
    { label: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
    { label: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/ },
    { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    {
      label: "assigned secret",
      pattern: /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token|refresh[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{16,}/i
    }
  ];
  return checks.find((check) => check.pattern.test(content))?.label ?? null;
}

function grepPathAllowed(filePath: string, options: MemoryGrepOptions): boolean {
  if (!grepScopeMatchesPath(filePath, options.scope)) return false;
  if (!memoryScopeMatches(scopeMetadataForPath(filePath), options)) return false;
  if (options.include_runs === false && isRunArtifactPath(filePath)) return false;
  return true;
}

function grepScopeMatchesPath(filePath: string, scopes: string | string[] | undefined): boolean {
  const cleaned = (Array.isArray(scopes) ? scopes : scopes ? [scopes] : []).map((scope) => scope.trim().toLowerCase()).filter(Boolean);
  if (cleaned.length === 0) return true;
  const lowerPath = filePath.toLowerCase();

  return cleaned.some((scope) => {
    if (scope === "all" || scope === "workspace" || scope === "files" || scope === "file" || scope === "raw" || scope === "sources" || scope === "source") {
      return true;
    }
    if (scope.startsWith("/")) {
      const prefix = scope.replace(/\/$/, "");
      return lowerPath === prefix || lowerPath.startsWith(`${prefix}/`);
    }

    const zone = memoryZoneForPath(filePath);
    if (scope === "runs" || scope === "run") return filePath.startsWith("/runs/");
    if (scope === "handoffs" || scope === "handoff") return isHandoffPath(filePath);
    if (scope === "archive" || scope === "archives") return filePath.startsWith("/archive/");
    if (scope === "projects" || scope === "project") return zone === "projects";
    if (scope === "memory" || scope === "memories") return zone === "memory";
    if (scope === "profile") return zone === "profile";
    if (scope === "preferences") return zone === "preferences";
    if (scope === "scratch") return zone === "scratch";
    return lowerPath.includes(scope);
  });
}

function isRunArtifactPath(filePath: string): boolean {
  return filePath.startsWith("/runs/") && !isHandoffPath(filePath);
}

function isHandoffPath(filePath: string): boolean {
  return filePath.startsWith("/handoffs/") || filePath.endsWith("/handoff.md");
}

function trustLevelsAtOrAbove(minimum: MemoryTrustLevel): MemoryTrustLevel[] {
  const levels: MemoryTrustLevel[] = [
    "ephemeral",
    "agent_generated",
    "source_backed",
    "reviewed",
    "trusted",
    "superseded",
    "rejected"
  ];
  return levels.filter((level) => trustMeetsMinimum(level, minimum));
}

function trustMeetsMinimum(level: MemoryTrustLevel | null | undefined, minimum: MemoryTrustLevel | undefined): boolean {
  if (!level) return !minimum;
  if (level === "rejected") return false;
  if (!minimum) return true;
  return trustRank(level) >= trustRank(minimum);
}

function trustRank(level: MemoryTrustLevel): number {
  switch (level) {
    case "rejected":
      return 0;
    case "superseded":
      return 1;
    case "ephemeral":
      return 2;
    case "agent_generated":
      return 3;
    case "source_backed":
      return 4;
    case "reviewed":
      return 5;
    case "trusted":
      return 6;
  }
}

function grepTrustMultiplier(level: MemoryTrustLevel | null | undefined): number {
  if (level === "trusted") return 1.08;
  if (level === "reviewed") return 1.04;
  if (level === "superseded") return 0.45;
  if (level === "ephemeral") return 0.86;
  if (level === "agent_generated") return 0.94;
  if (level === "rejected") return 0;
  return 1;
}

function grepScore(base: number, trust: MemoryTrustLevel | null | undefined): number {
  return Number(Math.max(0, Math.min(1, base * grepTrustMultiplier(trust))).toFixed(4));
}

function bestLexicalLine(text: string, query: string): { line: number | null; snippet: string; score: number } | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let best: { line: number | null; text: string; score: number } | null = null;
  lines.forEach((line, index) => {
    const score = keywordScore(query, line);
    if (!line.trim() || score <= 0) return;
    if (!best || score > best.score) {
      best = { line: index + 1, text: line, score };
    }
  });

  const documentScore = keywordScore(query, text);
  if (!best && documentScore > 0) {
    best = { line: null, text, score: documentScore };
  }
  return best
    ? {
        line: best.line,
        snippet: snippetAround(best.text, query),
        score: best.score
      }
    : null;
}

function lineNumberForText(text: string, query: string): number | null {
  const queryLower = query.toLowerCase();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => line.toLowerCase().includes(queryLower));
  return index >= 0 ? index + 1 : null;
}

function lineTextFor(text: string, line: number | null): string {
  if (!line) return text;
  return text.replace(/\r\n/g, "\n").split("\n")[line - 1] ?? text;
}

function bestSourceLocation(
  metadataJson: string,
  content: string,
  query: string
): Record<string, unknown> | null {
  const metadata = safeParseObject(metadataJson);
  const sections = Array.isArray(metadata.sections) ? metadata.sections : [];
  const line = lineNumberForText(content, query);
  if (line) {
    const matching = sections.find((section) => {
      const location = asPlainObject(asPlainObject(section).sourceLocation);
      const start = numericField(location, "start_line");
      const end = numericField(location, "end_line") ?? start;
      return start !== null && end !== null && line >= start && line <= end;
    });
    const location = asPlainObject(asPlainObject(matching).sourceLocation);
    if (location) return location;
  }

  const firstLocation = asPlainObject(asPlainObject(sections[0]).sourceLocation);
  return firstLocation ?? null;
}

function sourceLine(location: Record<string, unknown> | null | undefined): number | null {
  if (!location) return null;
  return (
    numericField(location, "start_line") ??
    numericField(location, "line") ??
    numericField(location, "row_start") ??
    numericField(location, "row")
  );
}

function numericField(object: Record<string, unknown>, key: string): number | null {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeParseObject(text: string): Record<string, unknown> {
  try {
    return asPlainObject(JSON.parse(text));
  } catch {
    return {};
  }
}

function snippetAround(text: string, query: string, maxLength = 220): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const lower = cleaned.toLowerCase();
  const queryLower = query.toLowerCase();
  const directIndex = lower.indexOf(queryLower);
  const tokenIndex = tokenize(query)
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const center = directIndex >= 0 ? directIndex : tokenIndex ?? 0;
  const start = Math.max(0, center - Math.floor(maxLength / 3));
  const end = Math.min(cleaned.length, start + maxLength);
  const slice = cleaned.slice(start, end).trim();
  return `${start > 0 ? "..." : ""}${slice}${end < cleaned.length ? "..." : ""}`;
}

function grepMatchTypeForSourcePath(sourcePath: string): MemoryGrepMatchType {
  if (sourcePath.startsWith("/archive/")) return "archive";
  if (isHandoffPath(sourcePath)) return "handoff";
  if (sourcePath.startsWith("/runs/")) return "run";
  return "memory";
}

function grepSourceMatchType(sourcePath: string, fallback: "literal" | "lexical" | "extracted"): MemoryGrepMatchType {
  return sourcePath.startsWith("/archive/") ? "archive" : fallback;
}

function dedupeGrepResults(results: MemoryGrepResult[]): MemoryGrepResult[] {
  const byKey = new Map<string, MemoryGrepResult>();
  for (const result of results) {
    const key = result.node_id
      ? `node:${result.node_id}`
      : `${result.path}:${result.line ?? ""}:${result.snippet.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || compareGrepResults(result, existing) < 0) {
      byKey.set(key, result);
    }
  }
  return [...byKey.values()];
}

function compareGrepResults(left: MemoryGrepResult, right: MemoryGrepResult): number {
  if (right.score !== left.score) return right.score - left.score;
  const trustDelta = trustRank(right.trust ?? "rejected") - trustRank(left.trust ?? "rejected");
  if (trustDelta !== 0) return trustDelta;
  return grepMatchPriority(right.match_type) - grepMatchPriority(left.match_type);
}

function grepMatchPriority(type: MemoryGrepMatchType): number {
  switch (type) {
    case "literal":
      return 6;
    case "extracted":
      return 5;
    case "lexical":
      return 4;
    case "archive":
      return 4;
    case "memory":
      return 3;
    case "handoff":
      return 2;
    case "run":
      return 1;
  }
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function ttlForPath(filePath: string): string | null {
  if (!filePath.startsWith("/scratch/")) return null;
  const ttl = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  return ttl.toISOString();
}

function trustScoreMultiplier(node: MemoryNode): number {
  if (node.status === "pending") return 0.25;
  if (node.status === "rejected" || node.trust_level === "rejected") return 0;
  if (node.status === "stale" || node.status === "conflicted" || node.status === "superseded") return 0.42;
  if (node.valid_until && new Date(node.valid_until).getTime() < Date.now()) return 0.42;
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
    memory_graph_edge: items.filter((item) => item.item_type === "memory_graph_edge"),
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

function emptyCandidateReviewDetection(): CandidateReviewDetection {
  return {
    status: "candidate",
    duplicate_of: null,
    conflicts_with: [],
    conflict_reason: null
  };
}

function candidateComparableText(candidate: ExtractedMemoryNode): string {
  return [candidate.summary, candidate.trigger, candidate.detail, candidate.raw_excerpt].filter(Boolean).join("\n");
}

function nodeText(node: Pick<MemoryNode, "summary" | "trigger" | "detail" | "tags">): string {
  return `${node.summary} ${node.trigger} ${node.detail ?? ""} ${node.tags.join(" ")}`;
}

function normalizedMemoryText(text: string): string {
  return tokenize(text).join(" ");
}

function normalizedSentence(text: string): string {
  return tokenize(text).join(" ");
}

function memoryScopeMetadataMatches(node: MemoryScopeMetadata, scope: MemoryScopeMetadata): boolean {
  return (
    node.scope === scope.scope &&
    (scope.project_id === null || node.project_id === scope.project_id) &&
    (scope.project_slug === null || node.project_slug === scope.project_slug) &&
    (scope.repo_id === null || node.repo_id === scope.repo_id) &&
    (scope.repo_path === null || node.repo_path === scope.repo_path) &&
    (scope.session_id === null || node.session_id === scope.session_id) &&
    (scope.agent_id === null || node.agent_id === scope.agent_id) &&
    (scope.contact_id === null || node.contact_id === scope.contact_id) &&
    (scope.run_id === null || node.run_id === scope.run_id)
  );
}

function isDurableConflictTarget(node: MemoryNode): boolean {
  if (node.status === "rejected" || node.status === "duplicate" || node.trust_level === "rejected") return false;
  if (node.status === "candidate" || node.status === "pending" || node.status === "observed" || node.status === "conflicted") return false;
  if (node.trust_level === "superseded" || node.status === "superseded") return false;
  if (node.source_path.startsWith("/scratch/")) return false;
  return true;
}

function isCandidateDuplicateTarget(node: MemoryNode, hasPromotion: boolean): boolean {
  if (isCandidateNode(node, hasPromotion)) return true;
  return isDurableConflictTarget(node);
}

function summarizeConflictReasons(conflicts: Array<{ node_id: string; reason: string }>): string {
  const reasons = [...new Set(conflicts.map((conflict) => conflict.reason).filter(Boolean))];
  return reasons.slice(0, 3).join(" ") || "Candidate conflicts with existing memory.";
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
