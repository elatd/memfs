#!/usr/bin/env node
import { MemoryFS, type MemoryGrepOptions, type RecallOptions } from "@memoryfs/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config();

export interface McpToolHandlers {
  memfs_workspace_list: () => Promise<unknown>;
  memfs_workspace_create: (input: { name: string }) => Promise<unknown>;
  memfs_file_list: (input: { workspace_id: string }) => Promise<unknown>;
  memfs_file_read: (input: { workspace_id: string; path: string; run_id?: string; actor?: string }) => Promise<unknown>;
  memfs_file_write: (input: {
    workspace_id: string;
    path: string;
    content: string;
    actor?: string;
    ingest?: boolean;
    allow_protected_write?: boolean;
  }) => Promise<unknown>;
  memfs_file_append: (input: {
    workspace_id: string;
    path: string;
    content: string;
    actor?: string;
    ingest?: boolean;
    allow_protected_write?: boolean;
    run_id?: string;
  }) => Promise<unknown>;
  memfs_file_upload: (input: {
    workspace_id: string;
    path: string;
    content_base64: string;
    mime_type?: string;
    actor?: string;
    ingest?: boolean;
    allow_protected_write?: boolean;
  }) => Promise<unknown>;
  memfs_file_extract: (input: { workspace_id: string; path: string; actor?: string }) => Promise<unknown>;
  memfs_extracted_source_read: (input: { workspace_id: string; file_id?: string; path?: string }) => Promise<unknown>;
  memfs_file_delete: (input: {
    workspace_id: string;
    path: string;
    actor?: string;
    allow_protected_write?: boolean;
  }) => Promise<unknown>;
  memfs_grep: (input: {
    workspace_id: string;
    query: string;
    mode?: MemoryGrepOptions["mode"];
    scope?: MemoryGrepOptions["scope"];
    project_slug?: string;
    repo_path?: string;
    session_id?: string;
    agent_id?: string;
    contact_id?: string;
    run_id?: string;
    trust_min?: MemoryGrepOptions["trust_min"];
    include_runs?: boolean;
    include_sources?: boolean;
    include_stale?: boolean;
    limit?: number;
  }) => Promise<unknown>;
  memfs_memory_search: (input: {
    workspace_id: string;
    query: string;
    limit?: number;
    project_hint?: string;
    scope?: RecallOptions["scope"];
    project_slug?: string;
    repo_path?: string;
    session_id?: string;
    agent_id?: string;
    contact_id?: string;
    run_id?: string;
    include_stale?: boolean;
  }) => Promise<unknown>;
  memfs_memory_recall: (input: {
    workspace_id: string;
    query: string;
    limit?: number;
    include_detail?: boolean;
    include_raw?: boolean;
    include_why?: boolean;
    include_contradictions?: boolean;
    include_links?: boolean;
    include_trust?: boolean;
    include_rejected?: boolean;
    include_stale?: boolean;
    mode?: RecallOptions["mode"];
    memory_types?: string[];
    trust_levels?: string[];
    project_hint?: string;
    run_id?: string;
    scope?: RecallOptions["scope"];
    project_slug?: string;
    repo_path?: string;
    session_id?: string;
    agent_id?: string;
    contact_id?: string;
  }) => Promise<unknown>;
  memfs_memory_node_read: (input: { workspace_id: string; node_id: string }) => Promise<unknown>;
  memfs_memory_raw_read: (input: { workspace_id: string; node_id: string }) => Promise<unknown>;
  memfs_audit_list: (input: { workspace_id: string; limit?: number }) => Promise<unknown>;
  memfs_memory_promote: (input: {
    workspace_id: string;
    source_path: string;
    target_path: string;
    source_node_id?: string;
    reason?: string;
    actor?: string;
  }) => Promise<unknown>;
  memfs_promotion_list: (input: { workspace_id: string }) => Promise<unknown>;
  memfs_candidate_create: (input: {
    workspace_id: string;
    memory_text?: string;
    summary?: string;
    trigger?: string;
    detail?: string;
    memory_type?: string;
    source_path?: string;
    promotion_target_path?: string;
    confidence?: number;
    reason?: string;
    actor?: string;
    scope?: string;
    project_slug?: string;
    repo_path?: string;
    session_id?: string;
    agent_id?: string;
    contact_id?: string;
    run_id?: string;
  }) => Promise<unknown>;
  memfs_candidate_list: (input: {
    workspace_id: string;
    status?: string;
    duplicates?: boolean;
    conflicts?: boolean;
    scope?: string | string[];
    project_slug?: string;
    repo_path?: string;
    session_id?: string;
    agent_id?: string;
    contact_id?: string;
    run_id?: string;
  }) => Promise<unknown>;
  memfs_candidate_read: (input: { workspace_id: string; candidate_id: string }) => Promise<unknown>;
  memfs_candidate_update: (input: {
    workspace_id: string;
    candidate_id: string;
    summary?: string;
    trigger?: string;
    detail?: string;
    memory_text?: string;
    memory_type?: string;
    confidence?: number;
    status?: string;
    reason?: string;
    actor?: string;
  }) => Promise<unknown>;
  memfs_snapshot_create: (input: { workspace_id: string; name: string; description?: string; actor?: string }) => Promise<unknown>;
  memfs_snapshot_list: (input: { workspace_id: string }) => Promise<unknown>;
  memfs_memory_health: (input: { workspace_id: string; recompute?: boolean }) => Promise<unknown>;
  memfs_brief: (input: {
    workspace_id: string;
    task: string;
    project_hint?: string;
    scope?: string | string[];
    project_slug?: string;
    repo_path?: string;
    session_id?: string;
    agent_id?: string;
    contact_id?: string;
    run_id?: string;
    files?: string[];
    actor?: string;
    create_run?: boolean;
    include_candidates?: boolean;
    limit?: number;
  }) => Promise<unknown>;
  memfs_run_create: (input: { workspace_id: string; task: string; title?: string; actor?: string }) => Promise<unknown>;
  memfs_run_append: (input: { workspace_id: string; run_id: string; kind?: string; text: string; actor?: string }) => Promise<unknown>;
  memfs_run_log_event: (input: { workspace_id: string; run_id: string; event_type: string; payload?: unknown }) => Promise<unknown>;
  memfs_run_complete: (input: { workspace_id: string; run_id: string; result?: string; errors?: string; followups?: string; actor?: string; failed?: boolean }) => Promise<unknown>;
  memfs_run_compile: (input: { workspace_id: string; run_id: string; actor?: string; reasoning?: boolean }) => Promise<unknown>;
  memfs_run_lessons: (input: { workspace_id: string; run_id: string }) => Promise<unknown>;
  memfs_handoff: (input: { workspace_id: string; run_id?: string; project_hint?: string; actor?: string }) => Promise<unknown>;
  memfs_stale_memory_list: (input: { workspace_id: string }) => Promise<unknown>;
  memfs_sync_status: (input: { workspace_id: string }) => Promise<unknown>;
  memfs_sync_pull: (input: { workspace_id: string; actor?: string }) => Promise<unknown>;
  memfs_sync_push: (input: { workspace_id: string; actor?: string }) => Promise<unknown>;
  memfs_sync_conflict_list: (input: { workspace_id: string }) => Promise<unknown>;
}

export function createMemfsMcpToolHandlers(memoryfs: MemoryFS): McpToolHandlers {
  return {
    memfs_workspace_list: async () => memoryfs.listWorkspaces(),
    memfs_workspace_create: async ({ name }) => memoryfs.createWorkspace(requireNonEmpty(name, "name")),
    memfs_file_list: async ({ workspace_id }) => memoryfs.listFiles(workspace_id),
    memfs_file_read: async ({ workspace_id, path, run_id, actor = "agent:mcp" }) =>
      memoryfs.readFile(workspace_id, requireAbsolutePath(path), { run_id, actor }),
    memfs_file_write: async ({
      workspace_id,
      path,
      content,
      actor = "agent:mcp",
      ingest = true,
      allow_protected_write = false
    }) =>
      memoryfs.writeFile(workspace_id, requireAbsolutePath(path), requireNonEmpty(content, "content"), {
        actor,
        ingest,
        allow_protected_write
      }),
    memfs_file_append: async ({
      workspace_id,
      path,
      content,
      actor = "agent:mcp",
      ingest = true,
      allow_protected_write = false,
      run_id
    }) => {
      const normalizedPath = requireAbsolutePath(path);
      const nextContent = await appendFileContent(memoryfs, workspace_id, normalizedPath, requireNonEmpty(content, "content"));
      return memoryfs.writeFile(workspace_id, normalizedPath, nextContent, {
        actor,
        ingest,
        allow_protected_write,
        run_id
      });
    },
    memfs_file_upload: async ({
      workspace_id,
      path,
      content_base64,
      mime_type,
      actor = "agent:mcp",
      ingest = true,
      allow_protected_write = false
    }) =>
      memoryfs.uploadFile(workspace_id, requireAbsolutePath(path), Buffer.from(requireNonEmpty(content_base64, "content_base64"), "base64"), {
        mime_type,
        actor,
        ingest,
        allow_protected_write
      }),
    memfs_file_extract: async ({ workspace_id, path, actor = "agent:mcp" }) =>
      memoryfs.extractFile(workspace_id, requireAbsolutePath(path), actor),
    memfs_extracted_source_read: async ({ workspace_id, file_id, path }) => {
      const selector = file_id ?? path;
      if (!selector) throw new Error("file_id or path is required.");
      return memoryfs.listExtractedSources(workspace_id, selector);
    },
    memfs_file_delete: async ({ workspace_id, path, actor = "agent:mcp", allow_protected_write = false }) => {
      await memoryfs.deleteFile(workspace_id, requireAbsolutePath(path), {
        actor,
        allow_protected_write
      });
      return { ok: true };
    },
    memfs_grep: async ({
      workspace_id,
      query,
      mode = "hybrid",
      scope,
      project_slug,
      repo_path,
      session_id,
      agent_id,
      contact_id,
      run_id,
      trust_min,
      include_runs = true,
      include_sources = true,
      include_stale = false,
      limit = 20
    }) =>
      memoryfs.grepMemory(workspace_id, requireNonEmpty(query, "query"), {
        mode,
        scope,
        project_slug,
        repo_path,
        session_id,
        agent_id,
        contact_id,
        run_id,
        trust_min,
        include_runs,
        include_sources,
        include_stale,
        limit
      }),
    memfs_memory_search: async ({
      workspace_id,
      query,
      limit = 8,
      project_hint,
      scope,
      project_slug,
      repo_path,
      session_id,
      agent_id,
      contact_id,
      run_id,
      include_stale = false
    }) =>
      memoryfs.searchMemory(workspace_id, requireNonEmpty(query, "query"), {
        limit,
        include_detail: true,
        include_raw: false,
        project_hint,
        scope,
        project_slug,
        repo_path,
        session_id,
        agent_id,
        contact_id,
        run_id,
        include_stale
      }),
    memfs_memory_recall: async ({
      workspace_id,
      query,
      limit = 8,
      include_detail = true,
      include_raw = false,
      include_why = false,
      include_contradictions = false,
      include_links = false,
      include_trust = false,
      include_rejected = false,
      include_stale = false,
      mode,
      memory_types,
      trust_levels,
      project_hint,
      run_id,
      scope,
      project_slug,
      repo_path,
      session_id,
      agent_id,
      contact_id
    }) => {
      const options: RecallOptions = {
        limit,
        include_detail,
        include_raw,
        include_why,
        include_contradictions,
        include_links,
        include_trust,
        include_rejected,
        include_stale,
        mode,
        memory_types,
        trust_levels,
        project_hint,
        run_id,
        scope,
        project_slug,
        repo_path,
        session_id,
        agent_id,
        contact_id
      };
      return memoryfs.recallMemory(workspace_id, requireNonEmpty(query, "query"), options);
    },
    memfs_memory_node_read: async ({ workspace_id, node_id }) => memoryfs.getMemoryNode(workspace_id, node_id),
    memfs_memory_raw_read: async ({ workspace_id, node_id }) => ({
      node_id,
      content: await memoryfs.readRawForNode(workspace_id, node_id)
    }),
    memfs_audit_list: async ({ workspace_id, limit = 100 }) => memoryfs.listAuditEvents(workspace_id, limit),
    memfs_memory_promote: async ({
      workspace_id,
      source_path,
      target_path,
      source_node_id,
      reason,
      actor = "agent:mcp"
    }) =>
      memoryfs.promoteMemory(workspace_id, {
        source_path: requireAbsolutePath(source_path),
        target_path: requireAbsolutePath(target_path),
        source_node_id,
        reason,
        actor,
        require_review: true
      }),
    memfs_promotion_list: async ({ workspace_id }) => memoryfs.listPromotions(workspace_id),
    memfs_candidate_create: async ({
      workspace_id,
      memory_text,
      summary,
      trigger,
      detail,
      memory_type,
      source_path,
      promotion_target_path,
      confidence,
      reason,
      actor = "agent:mcp",
      scope,
      project_slug,
      repo_path,
      session_id,
      agent_id,
      contact_id,
      run_id
    }) =>
      memoryfs.proposeMemoryCandidate(workspace_id, {
        memory_text,
        summary,
        trigger,
        detail,
        memory_type: memory_type as never,
        source_path: source_path ? requireAbsolutePath(source_path) : undefined,
        promotion_target_path: promotion_target_path ? requireAbsolutePath(promotion_target_path) : undefined,
        confidence,
        reason,
        actor,
        scope: scope as never,
        project_slug,
        repo_path,
        session_id,
        agent_id,
        contact_id,
        run_id
      }),
    memfs_candidate_list: async ({
      workspace_id,
      status,
      duplicates,
      conflicts,
      scope,
      project_slug,
      repo_path,
      session_id,
      agent_id,
      contact_id,
      run_id
    }) =>
      memoryfs.listCandidates(workspace_id, {
        status: status as never,
        duplicates,
        conflicts,
        scope: scope as never,
        project_slug,
        repo_path,
        session_id,
        agent_id,
        contact_id,
        run_id
      }),
    memfs_candidate_read: async ({ workspace_id, candidate_id }) => memoryfs.getCandidate(workspace_id, candidate_id),
    memfs_candidate_update: async ({
      workspace_id,
      candidate_id,
      summary,
      trigger,
      detail,
      memory_text,
      memory_type,
      confidence,
      status,
      reason,
      actor = "agent:mcp"
    }) =>
      memoryfs.updateCandidate(workspace_id, candidate_id, {
        summary,
        trigger,
        detail,
        memory_text,
        memory_type: memory_type as never,
        confidence,
        status: status as never,
        reason,
        actor
      }),
    memfs_snapshot_create: async ({ workspace_id, name, description, actor = "agent:mcp" }) =>
      memoryfs.createSnapshot(workspace_id, {
        name: requireNonEmpty(name, "name"),
        description,
        actor
      }),
    memfs_snapshot_list: async ({ workspace_id }) => memoryfs.listSnapshots(workspace_id),
    memfs_memory_health: async ({ workspace_id, recompute = false }) =>
      recompute ? memoryfs.recomputeMemoryHealth(workspace_id) : memoryfs.getMemoryHealth(workspace_id),
    memfs_brief: async ({
      workspace_id,
      task,
      project_hint,
      scope,
      project_slug,
      repo_path,
      session_id,
      agent_id,
      contact_id,
      run_id,
      files,
      actor = "agent:mcp",
      create_run = true,
      include_candidates = false,
      limit = 12
    }) =>
      memoryfs.createBrief(workspace_id, {
        task: requireNonEmpty(task, "task"),
        project_hint,
        scope: scope as never,
        project_slug,
        repo_path,
        session_id,
        agent_id,
        contact_id,
        run_id,
        files,
        actor,
        create_run,
        include_candidates,
        limit,
        include_recent_runs: true,
        include_open_questions: true,
        include_contradictions: true
      }),
    memfs_run_create: async ({ workspace_id, task, title, actor = "agent:mcp" }) =>
      memoryfs.createRun(workspace_id, { task: requireNonEmpty(task, "task"), title, actor }),
    memfs_run_append: async ({ workspace_id, run_id, kind = "note", text, actor = "agent:mcp" }) => {
      const run = memoryfs.getRun(workspace_id, run_id);
      const artifactName = runArtifactForKind(kind);
      const filePath = `${run.run_path}/${artifactName}`;
      const nextContent = await appendFileContent(memoryfs, workspace_id, filePath, requireNonEmpty(text, "text"));
      const file = await memoryfs.writeFile(workspace_id, filePath, nextContent, {
        actor,
        ingest: false,
        run_id
      });
      memoryfs.logRunEvent(workspace_id, run_id, "run_artifact_appended", {
        kind,
        artifact: artifactName,
        path: filePath,
        actor
      });
      return file;
    },
    memfs_run_log_event: async ({ workspace_id, run_id, event_type, payload = {} }) =>
      memoryfs.logRunEvent(workspace_id, run_id, event_type, payload),
    memfs_run_complete: async ({ workspace_id, run_id, result, errors, followups, actor = "agent:mcp", failed = false }) =>
      memoryfs.completeRun(workspace_id, run_id, { result, errors, followups, actor, failed }),
    memfs_run_compile: async ({ workspace_id, run_id, actor = "agent:mcp", reasoning = false }) =>
      memoryfs.compileRun(workspace_id, run_id, { actor, reasoning }),
    memfs_run_lessons: async ({ workspace_id, run_id }) => memoryfs.listRunLessons(workspace_id, run_id),
    memfs_handoff: async ({ workspace_id, run_id, project_hint, actor = "agent:mcp" }) =>
      memoryfs.createHandoff(workspace_id, { run_id, project_hint, actor }),
    memfs_stale_memory_list: async ({ workspace_id }) => memoryfs.listStaleMemory(workspace_id),
    memfs_sync_status: async ({ workspace_id }) => memoryfs.getSyncStatus(workspace_id),
    memfs_sync_pull: async ({ workspace_id, actor = "agent:mcp" }) => memoryfs.syncPull(workspace_id, { actor }),
    memfs_sync_push: async ({ workspace_id, actor = "agent:mcp" }) => memoryfs.syncPush(workspace_id, actor),
    memfs_sync_conflict_list: async ({ workspace_id }) => memoryfs.listConflicts(workspace_id)
  };
}

export function createMemfsMcpServer(memoryfs: MemoryFS): McpServer {
  const server = new McpServer({
    name: "memfs",
    version: "0.1.0"
  });
  registerTools(server, createMemfsMcpToolHandlers(memoryfs));
  return server;
}

function registerTools(server: McpServer, handlers: McpToolHandlers): void {
  server.tool("memfs_workspace_list", "List MemFS workspaces.", {}, async () =>
    textResult(await handlers.memfs_workspace_list())
  );
  server.tool(
    "memfs_workspace_create",
    "Create a MemFS workspace.",
    { name: z.string() },
    async (input) => textResult(await handlers.memfs_workspace_create(input))
  );
  server.tool(
    "memfs_file_list",
    "List files in a workspace.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.memfs_file_list(input))
  );
  server.tool(
    "memfs_file_read",
    "Read a MemFS file.",
    { workspace_id: z.string(), path: z.string() },
    async (input) => textResult(await handlers.memfs_file_read(input))
  );
  server.tool(
    "memfs_file_write",
    "Write a MemFS file. Use scratch paths or run paths during agent work. Protected durable paths such as /preferences.md and /projects/*/decisions.md require allow_protected_write=true and should only be written when explicitly instructed.",
    {
      workspace_id: z.string(),
      path: z.string(),
      content: z.string(),
      actor: z.string().default("agent:mcp"),
      ingest: z.boolean().default(true),
      allow_protected_write: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_file_write(input))
  );
  server.tool(
    "memfs_file_append",
    "Append to a MemFS file without bypassing write policy. Preferred for /scratch notes and /runs/<id> artifacts. Protected durable paths still require allow_protected_write=true.",
    {
      workspace_id: z.string(),
      path: z.string(),
      content: z.string(),
      actor: z.string().default("agent:mcp"),
      ingest: z.boolean().default(true),
      allow_protected_write: z.boolean().default(false),
      run_id: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_file_append(input))
  );
  server.tool(
    "memfs_file_delete",
    "Delete a MemFS file. Protected paths require allow_protected_write=true.",
    {
      workspace_id: z.string(),
      path: z.string(),
      actor: z.string().default("agent:mcp"),
      allow_protected_write: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_file_delete(input))
  );
  server.tool(
    "memfs_file_upload",
    "Upload a base64-encoded file into MemFS. Raw uploaded blob remains canonical.",
    {
      workspace_id: z.string(),
      path: z.string(),
      content_base64: z.string(),
      mime_type: z.string().optional(),
      actor: z.string().default("agent:mcp"),
      ingest: z.boolean().default(true),
      allow_protected_write: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_file_upload(input))
  );
  server.tool(
    "memfs_file_extract",
    "Extract derived text and source locations from an existing MemFS file without reading raw source into normal recall.",
    {
      workspace_id: z.string(),
      path: z.string(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_file_extract(input))
  );
  server.tool(
    "memfs_extracted_source_read",
    "Read extracted text metadata for a file by file_id or path. This is derived text, not canonical raw source.",
    {
      workspace_id: z.string(),
      file_id: z.string().optional(),
      path: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_extracted_source_read(input))
  );
  server.tool(
    "memfs_grep",
    "Hybrid grep over MemFS files, extracted text, memory nodes, runs, handoffs, and source-backed context.",
    {
      workspace_id: z.string(),
      query: z.string(),
      mode: z.enum(["literal", "semantic", "hybrid"]).default("hybrid"),
      scope: z.array(z.string()).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional(),
      trust_min: z.enum(["ephemeral", "agent_generated", "source_backed", "reviewed", "trusted", "superseded", "rejected"]).optional(),
      include_runs: z.boolean().default(true),
      include_sources: z.boolean().default(true),
      include_stale: z.boolean().default(false),
      limit: z.number().int().positive().default(20)
    },
    async (input) => textResult(await handlers.memfs_grep(input))
  );
  server.tool(
    "memfs_memory_search",
    "Search MemFS memory nodes with hybrid retrieval. Returns source_path and raw_ref, not raw source content.",
    {
      workspace_id: z.string(),
      query: z.string(),
      limit: z.number().int().positive().default(8),
      project_hint: z.string().optional(),
      scope: z.array(z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"])).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional(),
      include_stale: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_memory_search(input))
  );
  server.tool(
    "memfs_memory_recall",
    "Recall relevant MemFS memory nodes for context. Raw source is omitted by default; use memory_raw_source_read/memfs_memory_raw_read when raw source is explicitly needed.",
    {
      workspace_id: z.string(),
      query: z.string(),
      limit: z.number().int().positive().default(8),
      include_detail: z.boolean().default(true),
      include_raw: z.boolean().default(false),
      include_why: z.boolean().default(false),
      include_contradictions: z.boolean().default(false),
      include_links: z.boolean().default(false),
      include_trust: z.boolean().default(false),
      include_rejected: z.boolean().default(false),
      include_stale: z.boolean().default(false),
      mode: z.enum(["general", "task_preparation", "fact_lookup", "debugging", "handoff", "research", "decision_review"]).optional(),
      memory_types: z.array(z.string()).optional(),
      trust_levels: z.array(z.string()).optional(),
      project_hint: z.string().optional(),
      run_id: z.string().optional(),
      scope: z.array(z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"])).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_memory_recall(input))
  );
  server.tool(
    "memfs_memory_node_read",
    "Read a structured memory node.",
    { workspace_id: z.string(), node_id: z.string() },
    async (input) => textResult(await handlers.memfs_memory_node_read(input))
  );
  server.tool(
    "memfs_memory_raw_read",
    "Explicit raw source read for a memory node. Use only when snippets and source refs are insufficient.",
    { workspace_id: z.string(), node_id: z.string() },
    async (input) => textResult(await handlers.memfs_memory_raw_read(input))
  );
  server.tool(
    "memfs_audit_list",
    "List audit events for a workspace.",
    { workspace_id: z.string(), limit: z.number().int().positive().default(100) },
    async (input) => textResult(await handlers.memfs_audit_list(input))
  );
  server.tool(
    "memfs_memory_promote",
    "Request a reviewable memory promotion. Agents can propose durable memory, but this tool never approves protected durable memory.",
    {
      workspace_id: z.string(),
      source_path: z.string(),
      target_path: z.string(),
      source_node_id: z.string().optional(),
      reason: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_memory_promote(input))
  );
  server.tool(
    "memfs_promotion_list",
    "List pending and historical memory promotions.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.memfs_promotion_list(input))
  );
  server.tool(
    "memfs_candidate_create",
    "Propose a reviewable memory candidate. Use after observations, run results, or inferred lessons. This tool does not approve durable memory.",
    {
      workspace_id: z.string(),
      memory_text: z.string().optional(),
      summary: z.string().optional(),
      trigger: z.string().optional(),
      detail: z.string().optional(),
      memory_type: z.string().optional(),
      source_path: z.string().optional(),
      promotion_target_path: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      reason: z.string().optional(),
      actor: z.string().default("agent:mcp"),
      scope: z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"]).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_candidate_create(input))
  );
  server.tool(
    "memfs_candidate_list",
    "List reviewable memory candidates.",
    {
      workspace_id: z.string(),
      status: z.enum(["observed", "candidate", "duplicate", "approved", "rejected", "superseded", "stale", "conflicted"]).optional(),
      duplicates: z.boolean().default(false),
      conflicts: z.boolean().default(false),
      scope: z.array(z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"])).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_candidate_list(input))
  );
  server.tool(
    "memfs_candidate_read",
    "Read one reviewable memory candidate.",
    { workspace_id: z.string(), candidate_id: z.string() },
    async (input) => textResult(await handlers.memfs_candidate_read(input))
  );
  server.tool(
    "memfs_candidate_update",
    "Edit candidate text or mark a candidate stale or conflicted. This tool does not approve durable memory.",
    {
      workspace_id: z.string(),
      candidate_id: z.string(),
      summary: z.string().optional(),
      trigger: z.string().optional(),
      detail: z.string().optional(),
      memory_text: z.string().optional(),
      memory_type: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      status: z.enum(["observed", "candidate", "duplicate", "superseded", "stale", "conflicted"]).optional(),
      reason: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_candidate_update(input))
  );
  server.tool(
    "memfs_snapshot_create",
    "Create an auditable workspace snapshot.",
    {
      workspace_id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_snapshot_create(input))
  );
  server.tool(
    "memfs_snapshot_list",
    "List workspace snapshots.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.memfs_snapshot_list(input))
  );
  server.tool(
    "memfs_memory_health",
    "Read or recompute the memory health report.",
    { workspace_id: z.string(), recompute: z.boolean().default(false) },
    async (input) => textResult(await handlers.memfs_memory_health(input))
  );
  server.tool(
    "memfs_brief",
    "Create a pre-task memory brief before project work. It surfaces relevant source-backed context without raw source content.",
    {
      workspace_id: z.string(),
      task: z.string(),
      project_hint: z.string().optional(),
      scope: z.array(z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"])).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional(),
      files: z.array(z.string()).optional(),
      actor: z.string().default("agent:mcp"),
      create_run: z.boolean().default(true),
      include_candidates: z.boolean().default(false),
      limit: z.number().int().positive().default(12)
    },
    async (input) => textResult(await handlers.memfs_brief(input))
  );
  server.tool(
    "memfs_run_create",
    "Create an agent run folder and database row before a task. Write notes under /runs using memfs_run_append or memfs_file_append.",
    {
      workspace_id: z.string(),
      task: z.string(),
      title: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_run_create(input))
  );
  server.tool(
    "memfs_run_append",
    "Append a result, error, followup, action, or note artifact under /runs/<run_id> without writing durable memory.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      kind: z.string().default("note"),
      text: z.string(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_run_append(input))
  );
  server.tool(
    "memfs_run_log_event",
    "Log a structured event during an agent run.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      event_type: z.string(),
      payload: z.unknown().optional()
    },
    async (input) => textResult(await handlers.memfs_run_log_event(input))
  );
  server.tool(
    "memfs_run_complete",
    "Complete or fail an agent run and write result artifacts.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      result: z.string().optional(),
      errors: z.string().optional(),
      followups: z.string().optional(),
      actor: z.string().default("agent:mcp"),
      failed: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_run_complete(input))
  );
  server.tool(
    "memfs_run_compile",
    "Compile run artifacts into candidate memories, optional reasoning memories, and suggested promotions.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      actor: z.string().default("agent:mcp"),
      reasoning: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_run_compile(input))
  );
  server.tool(
    "memfs_run_lessons",
    "List reviewable reasoning memories extracted from a run.",
    {
      workspace_id: z.string(),
      run_id: z.string()
    },
    async (input) => textResult(await handlers.memfs_run_lessons(input))
  );
  server.tool(
    "memfs_handoff",
    "Create a concise handoff summary for a run or project.",
    {
      workspace_id: z.string(),
      run_id: z.string().optional(),
      project_hint: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_handoff(input))
  );
  server.tool(
    "memfs_stale_memory_list",
    "List stale, conflicted, superseded, old, unconfirmed, or otherwise review-worthy memory nodes.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.memfs_stale_memory_list(input))
  );
  server.tool(
    "memfs_sync_status",
    "Read local sync status for a workspace.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.memfs_sync_status(input))
  );
  server.tool(
    "memfs_sync_pull",
    "Pull sync events from the configured sync store. Does not bypass protected path conflict checks.",
    { workspace_id: z.string(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.memfs_sync_pull(input))
  );
  server.tool(
    "memfs_sync_push",
    "Push local sync events to the configured sync store.",
    { workspace_id: z.string(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.memfs_sync_push(input))
  );
  server.tool(
    "memfs_sync_conflict_list",
    "List sync conflicts for a workspace.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.memfs_sync_conflict_list(input))
  );

  registerOpenClawAliases(server, handlers);
  registerLegacyAliases(server, handlers);
}

function registerOpenClawAliases(server: McpServer, handlers: McpToolHandlers): void {
  server.tool("workspace_list", "List MemFS workspaces before selecting where an agent should work.", {}, async () =>
    textResult(await handlers.memfs_workspace_list())
  );
  server.tool(
    "workspace_create",
    "Create a MemFS workspace. Use sparingly; prefer existing project workspaces when available.",
    { name: z.string().min(1) },
    async (input) => textResult(await handlers.memfs_workspace_create(input))
  );
  server.tool(
    "file_read",
    "Read a MemFS file. Use for source-backed inspection; raw memory-node source has a separate explicit tool.",
    { workspace_id: z.string(), path: z.string(), run_id: z.string().optional(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.memfs_file_read(input))
  );
  server.tool(
    "file_write",
    "Write scratch or run files. Protected durable paths require allow_protected_write=true and explicit user instruction.",
    {
      workspace_id: z.string(),
      path: z.string(),
      content: z.string(),
      actor: z.string().default("agent:mcp"),
      ingest: z.boolean().default(true),
      allow_protected_write: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_file_write(input))
  );
  server.tool(
    "file_append",
    "Append to scratch or run files without bypassing protected path rules.",
    {
      workspace_id: z.string(),
      path: z.string(),
      content: z.string(),
      actor: z.string().default("agent:mcp"),
      ingest: z.boolean().default(true),
      allow_protected_write: z.boolean().default(false),
      run_id: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_file_append(input))
  );
  server.tool(
    "file_upload",
    "Upload a base64-encoded source file. Uploaded bytes remain canonical; extraction creates derived text.",
    {
      workspace_id: z.string(),
      path: z.string(),
      content_base64: z.string(),
      mime_type: z.string().optional(),
      actor: z.string().default("agent:mcp"),
      ingest: z.boolean().default(true),
      allow_protected_write: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_file_upload(input))
  );
  server.tool(
    "file_extract",
    "Extract derived text and source locations from a MemFS file without making raw source part of recall.",
    { workspace_id: z.string(), path: z.string(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.memfs_file_extract(input))
  );
  server.tool(
    "memory_search",
    "Search source-backed memory nodes. Returns source references, not raw source content.",
    {
      workspace_id: z.string(),
      query: z.string(),
      limit: z.number().int().positive().default(8),
      project_hint: z.string().optional(),
      scope: z.array(z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"])).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional(),
      include_stale: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_memory_search(input))
  );
  server.tool(
    "memory_recall",
    "Recall task-relevant context. Call this when a full brief is unnecessary; raw source is omitted by default.",
    {
      workspace_id: z.string(),
      query: z.string(),
      limit: z.number().int().positive().default(8),
      include_detail: z.boolean().default(true),
      include_raw: z.boolean().default(false),
      include_why: z.boolean().default(false),
      include_contradictions: z.boolean().default(false),
      include_links: z.boolean().default(false),
      include_trust: z.boolean().default(false),
      include_rejected: z.boolean().default(false),
      include_stale: z.boolean().default(false),
      mode: z.enum(["general", "task_preparation", "fact_lookup", "debugging", "handoff", "research", "decision_review"]).optional(),
      memory_types: z.array(z.string()).optional(),
      trust_levels: z.array(z.string()).optional(),
      project_hint: z.string().optional(),
      run_id: z.string().optional(),
      scope: z.array(z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"])).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_memory_recall(input))
  );
  server.tool(
    "memory_raw_source_read",
    "Explicitly read raw source for a memory node. Use only when source refs and snippets are insufficient.",
    { workspace_id: z.string(), node_id: z.string() },
    async (input) => textResult(await handlers.memfs_memory_raw_read(input))
  );
  server.tool(
    "candidate_create",
    "Propose a memory candidate for review. Agents should use this instead of directly writing durable protected memory.",
    {
      workspace_id: z.string(),
      memory_text: z.string().optional(),
      summary: z.string().optional(),
      trigger: z.string().optional(),
      detail: z.string().optional(),
      memory_type: z.string().optional(),
      source_path: z.string().optional(),
      promotion_target_path: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      reason: z.string().optional(),
      actor: z.string().default("agent:mcp"),
      scope: z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"]).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_candidate_create(input))
  );
  server.tool(
    "candidate_list",
    "List reviewable memory candidates. Normal agents can inspect candidates but cannot approve protected memory.",
    {
      workspace_id: z.string(),
      status: z.enum(["observed", "candidate", "duplicate", "approved", "rejected", "superseded", "stale", "conflicted"]).optional(),
      duplicates: z.boolean().default(false),
      conflicts: z.boolean().default(false),
      scope: z.array(z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"])).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_candidate_list(input))
  );
  server.tool(
    "candidate_read",
    "Read a memory candidate and its source refs.",
    { workspace_id: z.string(), candidate_id: z.string() },
    async (input) => textResult(await handlers.memfs_candidate_read(input))
  );
  server.tool(
    "promotion_request",
    "Request a reviewable promotion from source memory to durable memory. This does not approve protected memory.",
    {
      workspace_id: z.string(),
      source_path: z.string(),
      target_path: z.string(),
      source_node_id: z.string().optional(),
      reason: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_memory_promote(input))
  );
  server.tool(
    "run_create",
    "Create a run before starting task work.",
    { workspace_id: z.string(), task: z.string(), title: z.string().optional(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.memfs_run_create(input))
  );
  server.tool(
    "run_append",
    "Append a result, error, followup, action, or note under /runs/<run_id>.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      kind: z.string().default("note"),
      text: z.string(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_run_append(input))
  );
  server.tool(
    "run_complete",
    "Complete or fail an agent run and write result artifacts.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      result: z.string().optional(),
      errors: z.string().optional(),
      followups: z.string().optional(),
      actor: z.string().default("agent:mcp"),
      failed: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_run_complete(input))
  );
  server.tool(
    "run_compile",
    "Compile run artifacts into reviewable memory candidates and optional reasoning memories.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      actor: z.string().default("agent:mcp"),
      reasoning: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_run_compile(input))
  );
  server.tool(
    "brief_create",
    "Create a pre-task brief before project work. Recommended first call for coding agents.",
    {
      workspace_id: z.string(),
      task: z.string(),
      project_hint: z.string().optional(),
      scope: z.array(z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"])).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional(),
      files: z.array(z.string()).optional(),
      actor: z.string().default("agent:mcp"),
      create_run: z.boolean().default(true),
      include_candidates: z.boolean().default(false),
      limit: z.number().int().positive().default(12)
    },
    async (input) => textResult(await handlers.memfs_brief(input))
  );
  server.tool(
    "handoff_create",
    "Create a handoff summary after or during a run.",
    { workspace_id: z.string(), run_id: z.string().optional(), project_hint: z.string().optional(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.memfs_handoff(input))
  );
  server.tool(
    "stale_list",
    "List stale, conflicted, superseded, old, or unconfirmed memories for review.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.memfs_stale_memory_list(input))
  );
  server.tool(
    "audit_list",
    "List audit events for a workspace.",
    { workspace_id: z.string(), limit: z.number().int().positive().default(100) },
    async (input) => textResult(await handlers.memfs_audit_list(input))
  );
  server.tool(
    "snapshot_create",
    "Create an auditable snapshot before risky memory or file work.",
    { workspace_id: z.string(), name: z.string(), description: z.string().optional(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.memfs_snapshot_create(input))
  );
  server.tool(
    "health_report",
    "Read or recompute the workspace memory health report.",
    { workspace_id: z.string(), recompute: z.boolean().default(false) },
    async (input) => textResult(await handlers.memfs_memory_health(input))
  );
}

function registerLegacyAliases(server: McpServer, handlers: McpToolHandlers): void {
  server.tool("memoryfs_workspace_list", "Alias for memfs_workspace_list.", {}, async () =>
    textResult(await handlers.memfs_workspace_list())
  );
  server.tool(
    "memoryfs_file_list",
    "Alias for memfs_file_list.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.memfs_file_list(input))
  );
  server.tool(
    "memoryfs_file_read",
    "Alias for memfs_file_read.",
    { workspace_id: z.string(), path: z.string() },
    async (input) => textResult(await handlers.memfs_file_read(input))
  );
  server.tool(
    "memoryfs_file_write",
    "Alias for memfs_file_write.",
    {
      workspace_id: z.string(),
      path: z.string(),
      content: z.string(),
      actor: z.string().default("agent:mcp"),
      ingest: z.boolean().default(true),
      allow_protected_write: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_file_write(input))
  );
  server.tool(
    "memoryfs_grep",
    "Alias for memfs_grep.",
    {
      workspace_id: z.string(),
      query: z.string(),
      mode: z.enum(["literal", "semantic", "hybrid"]).default("hybrid"),
      scope: z.array(z.string()).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional(),
	      trust_min: z.enum(["ephemeral", "agent_generated", "source_backed", "reviewed", "trusted", "superseded", "rejected"]).optional(),
	      include_runs: z.boolean().default(true),
	      include_sources: z.boolean().default(true),
	      include_stale: z.boolean().default(false),
	      limit: z.number().int().positive().default(20)
    },
    async (input) => textResult(await handlers.memfs_grep(input))
  );
  server.tool(
    "memoryfs_memory_search",
    "Alias for memfs_memory_search.",
    {
      workspace_id: z.string(),
      query: z.string(),
      limit: z.number().int().positive().default(8),
      project_hint: z.string().optional(),
      scope: z.array(z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"])).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
	      agent_id: z.string().optional(),
	      contact_id: z.string().optional(),
	      run_id: z.string().optional(),
	      include_stale: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.memfs_memory_search(input))
  );
  server.tool(
    "memoryfs_memory_recall",
    "Alias for memfs_memory_recall.",
    {
      workspace_id: z.string(),
      query: z.string(),
      limit: z.number().int().positive().default(8),
      include_detail: z.boolean().default(true),
      include_raw: z.boolean().default(false),
      include_why: z.boolean().default(false),
      include_contradictions: z.boolean().default(false),
	      include_links: z.boolean().default(false),
	      include_trust: z.boolean().default(false),
	      include_rejected: z.boolean().default(false),
	      include_stale: z.boolean().default(false),
	      mode: z.enum(["general", "task_preparation", "fact_lookup", "debugging", "handoff", "research", "decision_review"]).optional(),
      memory_types: z.array(z.string()).optional(),
      trust_levels: z.array(z.string()).optional(),
      project_hint: z.string().optional(),
      scope: z.array(z.enum(["global", "workspace", "project", "repo", "session", "agent", "contact", "run"])).optional(),
      project_slug: z.string().optional(),
      repo_path: z.string().optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      contact_id: z.string().optional(),
      run_id: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_memory_recall(input))
  );
  server.tool(
    "memoryfs_memory_node_read",
    "Alias for memfs_memory_node_read.",
    { workspace_id: z.string(), node_id: z.string() },
    async (input) => textResult(await handlers.memfs_memory_node_read(input))
  );
  server.tool(
    "memoryfs_memory_raw_read",
    "Alias for memfs_memory_raw_read.",
    { workspace_id: z.string(), node_id: z.string() },
    async (input) => textResult(await handlers.memfs_memory_raw_read(input))
  );
}

async function main(): Promise<void> {
  const mode = (process.env.MEMFS_MODE as "local" | "team" | "cloud" | undefined) ?? "local";
  const memoryfs = new MemoryFS({
    dataDir: resolveDataDir(),
    mode,
    syncEnabled: envBoolean("MEMFS_SYNC_ENABLED") ?? mode !== "local",
    authRequired: envBoolean("MEMFS_AUTH_REQUIRED") ?? mode !== "local",
    memory: {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
      chatModel: process.env.MEMORYFS_CHAT_MODEL ?? "gpt-4o-mini",
      embedModel: process.env.MEMORYFS_EMBED_MODEL ?? "text-embedding-3-small"
    }
  });
  await memoryfs.initialize();

  process.once("SIGINT", () => {
    memoryfs.close();
    process.exit(0);
  });

  process.once("SIGTERM", () => {
    memoryfs.close();
    process.exit(0);
  });

  await createMemfsMcpServer(memoryfs).connect(new StdioServerTransport());
}

function resolveDataDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const configured = process.env.MEMFS_DATA_DIR ?? process.env.MEMORYFS_DATA_DIR;
  return configured
    ? resolve(process.cwd(), configured)
    : resolve(moduleDir, "../../../data");
}

function envBoolean(name: string): boolean | undefined {
  if (!(name in process.env)) return undefined;
  return process.env[name] === "true";
}

function textResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function requireNonEmpty(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required.`);
  }
  return trimmed;
}

function requireAbsolutePath(value: string | undefined): string {
  const path = requireNonEmpty(value, "path");
  if (!path.startsWith("/")) {
    throw new Error("path must be an absolute MemFS path starting with '/'.");
  }
  return path;
}

async function appendFileContent(memoryfs: MemoryFS, workspaceId: string, path: string, content: string): Promise<string> {
  try {
    const existing = await memoryfs.readFile(workspaceId, path);
    return existing.content ? `${existing.content.trimEnd()}\n${content}` : content;
  } catch {
    return content;
  }
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
    case "note":
    case "notes":
      return "notes.md";
    default:
      return `${kind.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "notes"}.md`;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
