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
  mode?: string;
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

export interface ClientBriefOptions {
  project_hint?: string;
  actor?: string;
  mode?: string;
  include_recent_runs?: boolean;
  include_open_questions?: boolean;
  include_contradictions?: boolean;
  include_raw?: boolean;
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
    body: { actor?: string; create_promotions?: boolean } = {}
  ): Promise<unknown> {
    return this.request(`/workspaces/${workspaceId}/runs/${runId}/compile`, {
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
