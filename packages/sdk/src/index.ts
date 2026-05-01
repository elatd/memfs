export interface ClientWriteOptions {
  actor?: string;
  ingest?: boolean;
  allow_protected_write?: boolean;
  run_id?: string;
}

export interface ClientUploadOptions extends ClientWriteOptions {
  mime_type?: string;
}

export interface ClientDeleteOptions {
  actor?: string;
  allow_protected_write?: boolean;
}

export interface ClientRecallOptions {
  limit?: number;
  include_detail?: boolean;
  include_raw?: boolean;
  project_hint?: string;
  scope?: string | string[];
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  mode?: string;
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

export interface ClientGrepOptions {
  mode?: "literal" | "semantic" | "hybrid";
  scope?: string | string[];
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
  trust_min?: string;
  include_runs?: boolean;
  include_sources?: boolean;
  include_stale?: boolean;
  limit?: number;
  project_hint?: string;
}

export interface ClientArchiveImportOptions {
  archive_type?: "conversation" | "transcript" | "imported" | "agent-run" | "raw";
  title?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export interface ClientArchiveExtractOptions {
  actor?: string;
  limit?: number;
}

export interface ClientBriefOptions {
  project_hint?: string;
  scope?: string | string[];
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
  mode?: string;
  include_recent_runs?: boolean;
  include_open_questions?: boolean;
  include_contradictions?: boolean;
  include_raw?: boolean;
  include_candidates?: boolean;
  limit?: number;
  create_run?: boolean;
}

export interface ClientPromoteOptions {
  source_node_id?: string;
  proposed_memory_type?: string;
  reason?: string;
  actor?: string;
  require_review?: boolean;
  append?: boolean;
}

export interface ClientCandidateOptions {
  status?: string | string[];
  duplicates?: boolean;
  conflicts?: boolean;
  scope?: string | string[];
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
}

export interface ClientCandidateCreateOptions extends ClientCandidateOptions {
  memory_text?: string;
  memory?: string;
  summary?: string;
  trigger?: string;
  detail?: string;
  type?: string;
  memory_type?: string;
  source_path?: string;
  promotion_target_path?: string;
  target_path?: string;
  confidence?: number;
  risk_flags?: string[];
  reason?: string;
  actor?: string;
}

export interface ClientCandidateUpdateOptions {
  memory_text?: string;
  summary?: string;
  trigger?: string;
  detail?: string;
  type?: string;
  memory_type?: string;
  confidence?: number;
  tags?: string[];
  status?: string;
  promotion_target_path?: string;
  target_path?: string;
  reason?: string;
  actor?: string;
  reviewer?: string;
}

export interface ClientCandidateConflictResolutionOptions {
  mode: "keep_new" | "keep_old" | "keep_both" | "mark_superseded";
  actor?: string;
  reviewer?: string;
  reason?: string;
  target_path?: string;
  promotion_target_path?: string;
}

export interface ClientGraphRelatedOptions {
  depth?: number;
  limit?: number;
  relation_types?: string[];
  include_stale?: boolean;
}

export interface ClientGraphPathOptions {
  max_depth?: number;
  relation_types?: string[];
}

export interface ClientGraphLinkOptions {
  from_node_id?: string;
  to_node_id?: string;
  from_type?: string;
  from_id?: string;
  to_type?: string;
  to_id?: string;
  relation_type: string;
  confidence?: number;
  reason?: string;
  source_ref?: string | null;
  actor?: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
}

export interface FileReadPacket {
  file: { id: string; path: string; [key: string]: unknown };
  content: string;
}

export interface AgentRunPacket {
  id: string;
  workspace_id: string;
  title: string;
  task: string;
  actor: string;
  status: string;
  run_path: string;
  created_at: string;
  completed_at: string | null;
}

export interface MemFSClientOptions {
  apiUrl?: string;
  actor?: string;
  createWorkspaceIfMissing?: boolean;
}

export interface WorkspaceInput {
  workspace: string;
  actor?: string;
  createWorkspace?: boolean;
}

export interface RememberInput extends WorkspaceInput {
  text: string;
  scope?: string | string[];
  source?: "explicit_user_instruction" | "agent_observation" | "model_generated" | "imported" | string;
  approved?: boolean;
  targetPath?: string;
  target_path?: string;
  sourcePath?: string;
  source_path?: string;
  type?: string;
  memory_type?: string;
  confidence?: number;
  reason?: string;
  risk_flags?: string[];
  reviewer?: string;
  project_id?: string;
  project_slug?: string;
  repo_id?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
}

export interface RememberResult {
  workspace_id: string;
  status: "candidate" | "approved";
  candidate: unknown;
}

export interface RecallInput extends WorkspaceInput, ClientRecallOptions {
  query: string;
}

export interface GrepInput extends WorkspaceInput, ClientGrepOptions {
  query: string;
}

export interface WriteInput extends WorkspaceInput {
  path: string;
  text?: string;
  content?: string;
  ingest?: boolean;
  allowProtected?: boolean;
  allow_protected_write?: boolean;
  run_id?: string;
}

export interface ReadInput extends WorkspaceInput {
  path: string;
  run_id?: string;
}

export interface CandidateListInput extends WorkspaceInput, ClientCandidateOptions {}

export interface CandidateReviewInput extends WorkspaceInput {
  id: string;
  reviewer?: string;
  comment?: string;
  targetPath?: string;
  target_path?: string;
}

export interface RunStartInput extends WorkspaceInput {
  task: string;
  title?: string;
}

export interface RunAppendInput {
  workspace?: string;
  kind: "result" | "error" | "errors" | "followup" | "followups" | "action" | "actions" | "note" | string;
  text: string;
  actor?: string;
}

export interface RunFinishInput {
  workspace?: string;
  result?: string;
  errors?: string;
  followups?: string;
  actor?: string;
  failed?: boolean;
}

export interface RunCompileInput {
  workspace?: string;
  actor?: string;
  create_promotions?: boolean;
  reasoning?: boolean;
}

export interface BriefCreateInput extends WorkspaceInput, ClientBriefOptions {
  task: string;
}

export class MemoryFSClient {
  constructor(private readonly baseUrl = "http://localhost:3131") {}

  createWorkspace(name: string): Promise<unknown> {
    return this.request("/workspaces", {
      method: "POST",
      body: { name }
    });
  }

  listWorkspaces(): Promise<unknown> {
    return this.request("/workspaces");
  }

  listFiles(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/files`);
  }

  readFile(workspaceId: string, path: string, options: { run_id?: string; actor?: string } = {}): Promise<unknown> {
    const params = new URLSearchParams({ path });
    if (options.run_id) params.set("run_id", options.run_id);
    if (options.actor) params.set("actor", options.actor);
    return this.request(`/workspaces/${workspaceId}/files/read?${params.toString()}`);
  }

  writeFile(
    workspaceId: string,
    path: string,
    content: string,
    options: ClientWriteOptions = {}
  ): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/files/write`, {
      method: "POST",
      body: {
        path,
        content,
        ...options
      }
    });
  }

  uploadFile(
    workspaceId: string,
    path: string,
    contentBase64: string,
    options: ClientUploadOptions = {}
  ): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/files/upload`, {
      method: "POST",
      body: {
        path,
        content_base64: contentBase64,
        ...options
      }
    });
  }

  extractFile(workspaceId: string, path: string, actor = "agent:sdk"): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/files/extract`, {
      method: "POST",
      body: { path, actor }
    });
  }

  ingestFile(workspaceId: string, path: string, actor = "agent:sdk"): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/ingest-file`, {
      method: "POST",
      body: { path, actor }
    });
  }

  readExtractedSources(workspaceId: string, fileId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/files/${fileId}/extracted`);
  }

  deleteFile(workspaceId: string, path: string, options: ClientDeleteOptions = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/files/delete`, {
      method: "POST",
      body: {
        path,
        ...options
      }
    });
  }

  searchMemory(workspaceId: string, query: string, options: ClientRecallOptions = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/search`, {
      method: "POST",
      body: {
        query,
        ...options
      }
    });
  }

  grepMemory(workspaceId: string, query: string, options: ClientGrepOptions = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/grep`, {
      method: "POST",
      body: {
        query,
        ...options
      }
    });
  }

  importArchiveText(workspaceId: string, content: string, options: ClientArchiveImportOptions = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/archive/import`, {
      method: "POST",
      body: {
        content,
        ...options
      }
    });
  }

  listArchive(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/archive`);
  }

  readArchive(workspaceId: string, archiveId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/archive/${archiveId}`);
  }

  extractArchive(workspaceId: string, archiveId: string, options: ClientArchiveExtractOptions = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/archive/${archiveId}/extract`, {
      method: "POST",
      body: options
    });
  }

  searchArchive(workspaceId: string, query: string, options: ClientGrepOptions = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/archive/search`, {
      method: "POST",
      body: {
        query,
        ...options
      }
    });
  }

  recallMemory(workspaceId: string, query: string, options: ClientRecallOptions = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/recall`, {
      method: "POST",
      body: {
        query,
        ...options
      }
    });
  }

  readMemoryNode(workspaceId: string, nodeId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/nodes/${nodeId}`);
  }

  readMemoryNodeSource(workspaceId: string, nodeId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/nodes/${nodeId}/source`);
  }

  listMemoryNodes(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/nodes`);
  }

  listMemoryNodeLinks(workspaceId: string, nodeId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/nodes/${nodeId}/links`);
  }

  createMemoryNodeLink(
    workspaceId: string,
    nodeId: string,
    body: {
      to_node_id: string;
      relation_type: string;
      confidence?: number;
      reason?: string;
      actor?: string;
    }
  ): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/nodes/${nodeId}/links`, {
      method: "POST",
      body
    });
  }

  getMemoryGraphNode(workspaceId: string, nodeId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/graph/nodes/${nodeId}`);
  }

  findRelatedMemories(
    workspaceId: string,
    nodeId: string,
    options: ClientGraphRelatedOptions = {}
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (options.depth !== undefined) params.set("depth", String(options.depth));
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.include_stale !== undefined) params.set("include_stale", String(options.include_stale));
    if (options.relation_types?.length) params.set("relation_types", options.relation_types.join(","));
    const query = params.toString();
    return this.request(`/workspaces/${workspaceId}/memory/graph/nodes/${nodeId}/related${query ? `?${query}` : ""}`);
  }

  explainGraphPath(
    workspaceId: string,
    fromNodeId: string,
    toNodeId: string,
    options: ClientGraphPathOptions = {}
  ): Promise<unknown> {
    const params = new URLSearchParams({
      from_node_id: fromNodeId,
      to_node_id: toNodeId
    });
    if (options.max_depth !== undefined) params.set("max_depth", String(options.max_depth));
    if (options.relation_types?.length) params.set("relation_types", options.relation_types.join(","));
    return this.request(`/workspaces/${workspaceId}/memory/graph/path?${params.toString()}`);
  }

  createGraphEdge(workspaceId: string, body: ClientGraphLinkOptions): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/graph/links`, {
      method: "POST",
      body
    });
  }

  deleteGraphEdge(workspaceId: string, edgeId: string, body: { actor?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/graph/links/${edgeId}`, {
      method: "DELETE",
      body
    });
  }

  listContradictions(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/contradictions`);
  }

  explainRecall(workspaceId: string, query: string, options: ClientRecallOptions = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/explain-recall`, {
      method: "POST",
      body: {
        query,
        ...options
      }
    });
  }

  promoteMemory(
    workspaceId: string,
    sourcePath: string,
    targetPath: string,
    options: ClientPromoteOptions = {}
  ): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/promote`, {
      method: "POST",
      body: {
        source_path: sourcePath,
        target_path: targetPath,
        ...options
      }
    });
  }

  listPromotions(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/promotions`);
  }

  listCandidates(workspaceId: string, options: ClientCandidateOptions = {}): Promise<unknown> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) {
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, item);
      } else if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    const query = params.toString();
    return this.request(`/workspaces/${workspaceId}/memory/candidates${query ? `?${query}` : ""}`);
  }

  createCandidate(workspaceId: string, body: ClientCandidateCreateOptions): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/candidates`, {
      method: "POST",
      body
    });
  }

  readCandidate(workspaceId: string, candidateId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/candidates/${candidateId}`);
  }

  updateCandidate(workspaceId: string, candidateId: string, body: ClientCandidateUpdateOptions): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/candidates/${candidateId}/update`, {
      method: "POST",
      body
    });
  }

  approveCandidate(workspaceId: string, candidateId: string, body: { reviewer?: string; comment?: string; apply?: boolean; target_path?: string; promotion_target_path?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/candidates/${candidateId}/approve`, {
      method: "POST",
      body
    });
  }

  rejectCandidate(workspaceId: string, candidateId: string, body: { reviewer?: string; comment?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/candidates/${candidateId}/reject`, {
      method: "POST",
      body
    });
  }

  resolveCandidateConflict(workspaceId: string, candidateId: string, body: ClientCandidateConflictResolutionOptions): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/candidates/${candidateId}/resolve-conflict`, {
      method: "POST",
      body
    });
  }

  approvePromotion(workspaceId: string, promotionId: string, body: { reviewer?: string; comment?: string; apply?: boolean } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/promotions/${promotionId}/approve`, {
      method: "POST",
      body
    });
  }

  rejectPromotion(workspaceId: string, promotionId: string, body: { reviewer?: string; comment?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/promotions/${promotionId}/reject`, {
      method: "POST",
      body
    });
  }

  createSnapshot(workspaceId: string, name: string, body: { description?: string; actor?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/snapshots`, {
      method: "POST",
      body: {
        name,
        ...body
      }
    });
  }

  listSnapshots(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/snapshots`);
  }

  diffSnapshot(workspaceId: string, snapshotId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/snapshots/${snapshotId}/diff`);
  }

  rollbackSnapshot(workspaceId: string, snapshotId: string, body: { dry_run?: boolean; actor?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/snapshots/${snapshotId}/rollback`, {
      method: "POST",
      body
    });
  }

  getMemoryHealth(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/health`);
  }

  recomputeMemoryHealth(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/health/recompute`, {
      method: "POST"
    });
  }

  readRaw(workspaceId: string, nodeId: string, options: { run_id?: string; actor?: string } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (options.run_id) params.set("run_id", options.run_id);
    if (options.actor) params.set("actor", options.actor);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/workspaces/${workspaceId}/memory/nodes/${nodeId}/raw${suffix}`);
  }

  createBrief(workspaceId: string, task: string, options: ClientBriefOptions = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/brief`, {
      method: "POST",
      body: {
        task,
        ...options
      }
    });
  }

  createRun(workspaceId: string, task: string, body: { title?: string; actor?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/runs`, {
      method: "POST",
      body: {
        task,
        ...body
      }
    });
  }

  startRun(workspaceId: string, runId: string, body: { actor?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/runs/${runId}/start`, {
      method: "POST",
      body
    });
  }

  listRuns(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/runs`);
  }

  readRun(workspaceId: string, runId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/runs/${runId}`);
  }

  completeRun(
    workspaceId: string,
    runId: string,
    body: { result?: string; errors?: string; followups?: string; actor?: string; failed?: boolean } = {}
  ): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/runs/${runId}/complete`, {
      method: "POST",
      body
    });
  }

  compileRun(
    workspaceId: string,
    runId: string,
    body: { actor?: string; create_promotions?: boolean; reasoning?: boolean } = {}
  ): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/runs/${runId}/compile`, {
      method: "POST",
      body
    });
  }

  listRunLessons(workspaceId: string, runId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/runs/${runId}/lessons`);
  }

  logRunEvent(workspaceId: string, runId: string, body: { event_type?: string; payload?: unknown } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/runs/${runId}/events`, {
      method: "POST",
      body
    });
  }

  createHandoff(workspaceId: string, body: { run_id?: string; project_hint?: string; actor?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/handoff`, {
      method: "POST",
      body
    });
  }

  listStaleMemory(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/stale`);
  }

  markMemoryStale(workspaceId: string, nodeId: string, body: { reason?: string; actor?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/nodes/${nodeId}/mark-stale`, {
      method: "POST",
      body
    });
  }

  confirmMemory(workspaceId: string, nodeId: string, body: { actor?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/nodes/${nodeId}/confirm`, {
      method: "POST",
      body
    });
  }

  supersedeMemory(workspaceId: string, oldNodeId: string, newNodeId: string, body: { reason?: string; actor?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/memory/nodes/${oldNodeId}/supersede/${newNodeId}`, {
      method: "POST",
      body
    });
  }

  listAuditEvents(workspaceId: string, limit = 100): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/audit-events?limit=${limit}`);
  }

  recordAuditEvent(workspaceId: string, body: { actor?: string; event_type: string; payload?: unknown }): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/audit-events`, {
      method: "POST",
      body
    });
  }

  syncStatus(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/sync/status`);
  }

  syncPull(workspaceId: string, body: { actor?: string; events?: unknown[] } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/sync/pull`, {
      method: "POST",
      body
    });
  }

  syncPush(workspaceId: string, body: { actor?: string } = {}): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/sync/push`, {
      method: "POST",
      body
    });
  }

  listSyncConflicts(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/sync/conflicts`);
  }

  resolveSyncConflict(
    workspaceId: string,
    conflictId: string,
    body: { mode: "keep_local" | "keep_remote" | "manual_merge" | "keep_both"; actor?: string; manual_content?: string }
  ): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/sync/conflicts/${conflictId}/resolve`, {
      method: "POST",
      body
    });
  }

  listTeamMembers(workspaceId: string): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/team/members`);
  }

  addTeamMember(
    workspaceId: string,
    body: { handle: string; role: "owner" | "admin" | "editor" | "agent" | "viewer"; display_name?: string; actor?: string }
  ): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/team/members`, {
      method: "POST",
      body
    });
  }

  setTeamRole(
    workspaceId: string,
    body: { handle: string; role: "owner" | "admin" | "editor" | "agent" | "viewer"; actor?: string }
  ): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/team/role`, {
      method: "POST",
      body
    });
  }

  private async request(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: init.body ? { "content-type": "application/json" } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(errorBody?.error ?? `MemoryFS request failed with ${response.status}.`);
    }

    return response.json();
  }
}

export function createMemoryFSClient(baseUrl?: string): MemoryFSClient {
  return new MemoryFSClient(baseUrl);
}

export class MemFSClient extends MemoryFSClient {
  private readonly defaultActor: string;
  private readonly createMissingWorkspaces: boolean;
  private readonly workspaceCache = new Map<string, string>();
  private readonly runWorkspaceById = new Map<string, string>();
  private readonly runPathById = new Map<string, string>();

  readonly candidates = {
    list: async (input: CandidateListInput): Promise<unknown> => {
      const workspaceId = await this.resolveWorkspaceId(input);
      return this.listCandidates(workspaceId, stripWorkspace(input));
    },
    approve: async (input: CandidateReviewInput): Promise<unknown> => {
      const workspaceId = await this.resolveWorkspaceId(input, false);
      return this.approveCandidate(workspaceId, input.id, {
        reviewer: input.reviewer ?? input.actor ?? this.defaultActor,
        comment: input.comment,
        target_path: input.target_path ?? input.targetPath
      });
    },
    reject: async (input: CandidateReviewInput): Promise<unknown> => {
      const workspaceId = await this.resolveWorkspaceId(input, false);
      return this.rejectCandidate(workspaceId, input.id, {
        reviewer: input.reviewer ?? input.actor ?? this.defaultActor,
        comment: input.comment
      });
    }
  };

  readonly runs = {
    start: async (input: RunStartInput): Promise<AgentRunPacket> => {
      const workspaceId = await this.resolveWorkspaceId(input);
      const created = (await this.createRun(workspaceId, input.task, {
        title: input.title,
        actor: input.actor ?? this.defaultActor
      })) as AgentRunPacket;
      const started = (await this.startRun(workspaceId, created.id, {
        actor: input.actor ?? this.defaultActor
      })) as AgentRunPacket;
      this.rememberRunWorkspace(started, workspaceId);
      return started;
    },
    append: async (runId: string, input: RunAppendInput): Promise<unknown> => {
      const workspaceId = await this.resolveRunWorkspace(runId, input.workspace);
      const runPath = await this.resolveRunPath(workspaceId, runId);
      const artifact = runArtifactForKind(input.kind);
      const filePath = `${runPath}/${artifact}`;
      const existing = await this.readFile(workspaceId, filePath).catch(() => null) as FileReadPacket | null;
      const nextContent = existing?.content ? `${existing.content.trimEnd()}\n${input.text}` : input.text;
      const written = await this.writeFile(workspaceId, filePath, nextContent, {
        actor: input.actor ?? this.defaultActor,
        ingest: false,
        run_id: runId
      });
      await this.logRunEvent(workspaceId, runId, {
        event_type: "run_artifact_appended",
        payload: {
          kind: input.kind,
          artifact,
          path: filePath,
          actor: input.actor ?? this.defaultActor
        }
      });
      return written;
    },
    finish: async (runId: string, input: RunFinishInput = {}): Promise<unknown> => {
      const workspaceId = await this.resolveRunWorkspace(runId, input.workspace);
      return this.completeRun(workspaceId, runId, {
        result: input.result,
        errors: input.errors,
        followups: input.followups,
        actor: input.actor ?? this.defaultActor,
        failed: input.failed
      });
    },
    compile: async (runId: string, input: RunCompileInput = {}): Promise<unknown> => {
      const workspaceId = await this.resolveRunWorkspace(runId, input.workspace);
      return this.compileRun(workspaceId, runId, {
        actor: input.actor ?? this.defaultActor,
        create_promotions: input.create_promotions,
        reasoning: input.reasoning
      });
    }
  };

  readonly briefs = {
    create: async (input: BriefCreateInput): Promise<unknown> => {
      const workspaceId = await this.resolveWorkspaceId(input);
      return this.createBrief(workspaceId, input.task, stripWorkspaceAndTask(input));
    }
  };

  constructor(options: MemFSClientOptions | string = {}) {
    const apiUrl = typeof options === "string" ? options : options.apiUrl;
    super(apiUrl);
    this.defaultActor = typeof options === "string" ? "agent:sdk" : options.actor ?? "agent:sdk";
    this.createMissingWorkspaces = typeof options === "string" ? true : options.createWorkspaceIfMissing ?? true;
  }

  async remember(input: RememberInput): Promise<RememberResult> {
    const workspaceId = await this.resolveWorkspaceId(input);
    const memoryType = input.memory_type ?? input.type ?? inferMemoryType(input.text);
    const targetPath = input.target_path ?? input.targetPath ?? defaultRememberTargetPath({ ...input, memory_type: memoryType });
    const source = input.source ?? "agent_observation";
    const reviewer = input.reviewer ?? input.actor ?? this.defaultActor;
    if (input.approved && !reviewer.startsWith("human:")) {
      throw new Error("MemFS remember({ approved: true }) requires a human reviewer or human actor.");
    }
    const reason = input.reason ?? `Remembered via SDK source=${source}.`;
    const candidate = await this.createCandidate(workspaceId, {
      memory_text: input.text,
      memory_type: memoryType,
      type: memoryType,
      scope: input.scope,
      source_path: input.source_path ?? input.sourcePath,
      promotion_target_path: targetPath,
      confidence: input.confidence ?? (source === "explicit_user_instruction" ? 0.95 : 0.75),
      risk_flags: input.risk_flags,
      reason,
      actor: input.actor ?? this.defaultActor,
      project_id: input.project_id,
      project_slug: input.project_slug,
      repo_id: input.repo_id,
      repo_path: input.repo_path,
      session_id: input.session_id,
      agent_id: input.agent_id,
      contact_id: input.contact_id,
      run_id: input.run_id
    }) as { id?: string; node_id?: string };

    if (!input.approved) {
      return {
        workspace_id: workspaceId,
        status: "candidate",
        candidate
      };
    }

    const candidateId = candidate.id ?? candidate.node_id;
    if (!candidateId) {
      throw new Error("MemFS remember could not identify the created candidate.");
    }
    const approved = await this.approveCandidate(workspaceId, candidateId, {
      reviewer,
      comment: input.reason,
      target_path: targetPath,
      apply: true
    });
    return {
      workspace_id: workspaceId,
      status: "approved",
      candidate: approved
    };
  }

  async recall(input: RecallInput): Promise<unknown> {
    const workspaceId = await this.resolveWorkspaceId(input);
    return this.recallMemory(workspaceId, input.query, stripWorkspaceAndQuery(input));
  }

  async search(input: RecallInput): Promise<unknown> {
    const workspaceId = await this.resolveWorkspaceId(input);
    return this.searchMemory(workspaceId, input.query, stripWorkspaceAndQuery(input));
  }

  async grep(input: GrepInput): Promise<unknown> {
    const workspaceId = await this.resolveWorkspaceId(input);
    return this.grepMemory(workspaceId, input.query, stripWorkspaceAndQuery(input));
  }

  async write(input: WriteInput): Promise<unknown> {
    const workspaceId = await this.resolveWorkspaceId(input);
    const content = input.content ?? input.text ?? "";
    return this.writeFile(workspaceId, input.path, content, {
      actor: input.actor ?? this.defaultActor,
      ingest: input.ingest,
      allow_protected_write: input.allow_protected_write ?? input.allowProtected,
      run_id: input.run_id
    });
  }

  async read(input: ReadInput): Promise<unknown> {
    const workspaceId = await this.resolveWorkspaceId(input);
    return this.readFile(workspaceId, input.path, {
      actor: input.actor ?? this.defaultActor,
      run_id: input.run_id
    });
  }

  private async resolveWorkspaceId(input: WorkspaceInput | { workspace: string; createWorkspace?: boolean }, defaultCreate = this.createMissingWorkspaces): Promise<string> {
    const selector = input.workspace;
    const cached = this.workspaceCache.get(selector);
    if (cached) return cached;

    const workspaces = (await this.listWorkspaces()) as WorkspaceSummary[];
    const existing = workspaces.find((workspace) => workspace.id === selector || workspace.name === selector);
    if (existing) {
      this.cacheWorkspace(existing);
      return existing.id;
    }

    if (input.createWorkspace ?? defaultCreate) {
      const created = (await this.createWorkspace(selector)) as WorkspaceSummary;
      this.cacheWorkspace(created);
      return created.id;
    }

    throw new Error(`MemFS workspace not found: ${selector}`);
  }

  private async resolveRunWorkspace(runId: string, workspace?: string): Promise<string> {
    if (workspace) return this.resolveWorkspaceId({ workspace }, false);
    const workspaceId = this.runWorkspaceById.get(runId);
    if (!workspaceId) {
      throw new Error(`MemFS run ${runId} is not associated with this client. Pass { workspace } or start the run with this client.`);
    }
    return workspaceId;
  }

  private async resolveRunPath(workspaceId: string, runId: string): Promise<string> {
    const cached = this.runPathById.get(runId);
    if (cached) return cached;
    const response = (await this.readRun(workspaceId, runId)) as { run: AgentRunPacket };
    this.rememberRunWorkspace(response.run, workspaceId);
    return response.run.run_path;
  }

  private cacheWorkspace(workspace: WorkspaceSummary): void {
    this.workspaceCache.set(workspace.id, workspace.id);
    this.workspaceCache.set(workspace.name, workspace.id);
  }

  private rememberRunWorkspace(run: AgentRunPacket, workspaceId: string): void {
    this.runWorkspaceById.set(run.id, workspaceId);
    this.runPathById.set(run.id, run.run_path);
  }
}

export function createMemFSClient(options?: MemFSClientOptions | string): MemFSClient {
  return new MemFSClient(options);
}

function stripWorkspace<T extends WorkspaceInput>(input: T): Omit<T, "workspace" | "actor" | "createWorkspace"> {
  const { workspace: _workspace, actor: _actor, createWorkspace: _createWorkspace, ...rest } = input;
  return rest;
}

function stripWorkspaceAndQuery<T extends WorkspaceInput & { query: string }>(
  input: T
): Omit<T, "workspace" | "actor" | "createWorkspace" | "query"> {
  const { workspace: _workspace, actor: _actor, createWorkspace: _createWorkspace, query: _query, ...rest } = input;
  return rest;
}

function stripWorkspaceAndTask(input: BriefCreateInput): ClientBriefOptions {
  const { workspace: _workspace, createWorkspace: _createWorkspace, task: _task, ...rest } = input;
  return rest;
}

function inferMemoryType(text: string): string {
  if (/^\s*preference:/i.test(text) || /\b(prefers?|likes|wants)\b/i.test(text)) return "preference";
  if (/^\s*constraint:/i.test(text) || /\b(must|never|cannot|should not)\b/i.test(text)) return "constraint";
  if (/^\s*decision:/i.test(text) || /\b(decided|decision)\b/i.test(text)) return "decision";
  return "fact";
}

function defaultRememberTargetPath(input: {
  text: string;
  scope?: string | string[];
  memory_type?: string;
  project_slug?: string;
  project_id?: string;
}): string {
  const memoryType = input.memory_type ?? inferMemoryType(input.text);
  const project = input.project_slug ?? input.project_id;
  const scopes = Array.isArray(input.scope) ? input.scope : input.scope ? [input.scope] : [];
  if (project || scopes.includes("project")) {
    const slug = project ?? "default";
    if (memoryType === "decision") return `/projects/${slug}/decisions.md`;
    if (memoryType === "constraint") return `/projects/${slug}/constraints.md`;
    return `/projects/${slug}/memory.md`;
  }
  if (memoryType === "preference") return "/preferences.md";
  if (scopes.includes("global")) return "/profile.md";
  return "/memory/remembered.md";
}

function runArtifactForKind(kind: string): string {
  switch (kind) {
    case "result":
      return "result.md";
    case "error":
    case "errors":
      return "errors.md";
    case "followup":
    case "followups":
      return "followups.md";
    case "action":
    case "actions":
      return "actions.md";
    default:
      return `${kind.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "note"}.md`;
  }
}
