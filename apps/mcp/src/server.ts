#!/usr/bin/env node
import {
  VeriFS,
  memoryScopes,
  memoryTrustLevels,
  memoryTypes,
  parseStringUnion,
  recallModes,
  type MemoryCandidateStatus,
  type MemoryGrepOptions,
  type MemoryScope,
  type MemoryTrustLevel,
  type MemoryType,
  type RecallOptions
} from "@verifs/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config();

const memoryCandidateStatuses = ["observed", "candidate", "duplicate", "approved", "rejected", "superseded", "stale", "conflicted"] as const;
const editableMemoryCandidateStatuses = ["observed", "candidate", "duplicate", "superseded", "stale", "conflicted"] as const;

export interface McpToolHandlers {
  verifs_workspace_list: () => Promise<unknown>;
  verifs_workspace_create: (input: { name: string }) => Promise<unknown>;
  verifs_file_list: (input: { workspace_id: string }) => Promise<unknown>;
  verifs_file_read: (input: { workspace_id: string; path: string; run_id?: string; actor?: string }) => Promise<unknown>;
  verifs_file_write: (input: {
    workspace_id: string;
    path: string;
    content: string;
    actor?: string;
    ingest?: boolean;
    allow_protected_write?: boolean;
  }) => Promise<unknown>;
  verifs_file_append: (input: {
    workspace_id: string;
    path: string;
    content: string;
    actor?: string;
    ingest?: boolean;
    allow_protected_write?: boolean;
    run_id?: string;
  }) => Promise<unknown>;
  verifs_file_upload: (input: {
    workspace_id: string;
    path: string;
    content_base64: string;
    mime_type?: string;
    actor?: string;
    ingest?: boolean;
    allow_protected_write?: boolean;
  }) => Promise<unknown>;
  verifs_file_extract: (input: { workspace_id: string; path: string; actor?: string }) => Promise<unknown>;
  verifs_extracted_source_read: (input: { workspace_id: string; file_id?: string; path?: string }) => Promise<unknown>;
  verifs_file_delete: (input: {
    workspace_id: string;
    path: string;
    actor?: string;
    allow_protected_write?: boolean;
  }) => Promise<unknown>;
  verifs_grep: (input: {
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
  verifs_memory_search: (input: {
    workspace_id: string;
    query: string;
    limit?: number;
    project_hint?: string;
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
  }) => Promise<unknown>;
  verifs_memory_recall: (input: {
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
    memory_types?: MemoryType[];
    trust_levels?: MemoryTrustLevel[];
    project_hint?: string;
    run_id?: string;
    scope?: RecallOptions["scope"];
    project_slug?: string;
    repo_path?: string;
    session_id?: string;
    agent_id?: string;
    contact_id?: string;
  }) => Promise<unknown>;
  verifs_memory_node_read: (input: { workspace_id: string; node_id: string }) => Promise<unknown>;
  verifs_memory_raw_read: (input: { workspace_id: string; node_id: string }) => Promise<unknown>;
  verifs_audit_list: (input: { workspace_id: string; limit?: number }) => Promise<unknown>;
  verifs_memory_promote: (input: {
    workspace_id: string;
    source_path: string;
    target_path: string;
    source_node_id?: string;
    reason?: string;
    actor?: string;
  }) => Promise<unknown>;
  verifs_promotion_list: (input: { workspace_id: string }) => Promise<unknown>;
  verifs_candidate_create: (input: {
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
  verifs_candidate_list: (input: {
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
  verifs_candidate_read: (input: { workspace_id: string; candidate_id: string }) => Promise<unknown>;
  verifs_candidate_update: (input: {
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
  verifs_snapshot_create: (input: { workspace_id: string; name: string; description?: string; actor?: string }) => Promise<unknown>;
  verifs_snapshot_list: (input: { workspace_id: string }) => Promise<unknown>;
  verifs_memory_health: (input: { workspace_id: string; recompute?: boolean }) => Promise<unknown>;
  verifs_brief: (input: {
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
  verifs_run_create: (input: { workspace_id: string; task: string; title?: string; actor?: string }) => Promise<unknown>;
  verifs_run_append: (input: { workspace_id: string; run_id: string; kind?: string; text: string; actor?: string }) => Promise<unknown>;
  verifs_run_log_event: (input: { workspace_id: string; run_id: string; event_type: string; payload?: unknown }) => Promise<unknown>;
  verifs_run_complete: (input: { workspace_id: string; run_id: string; result?: string; errors?: string; followups?: string; actor?: string; failed?: boolean }) => Promise<unknown>;
  verifs_run_compile: (input: { workspace_id: string; run_id: string; actor?: string; reasoning?: boolean }) => Promise<unknown>;
  verifs_run_lessons: (input: { workspace_id: string; run_id: string }) => Promise<unknown>;
  verifs_handoff: (input: { workspace_id: string; run_id?: string; project_hint?: string; actor?: string }) => Promise<unknown>;
  verifs_stale_memory_list: (input: { workspace_id: string }) => Promise<unknown>;
  verifs_sync_status: (input: { workspace_id: string }) => Promise<unknown>;
  verifs_sync_pull: (input: { workspace_id: string; actor?: string }) => Promise<unknown>;
  verifs_sync_push: (input: { workspace_id: string; actor?: string }) => Promise<unknown>;
  verifs_sync_conflict_list: (input: { workspace_id: string }) => Promise<unknown>;
}

export function createVeriFSMcpToolHandlers(verifs: VeriFS): McpToolHandlers {
  return {
    verifs_workspace_list: async () => verifs.listWorkspaces(),
    verifs_workspace_create: async ({ name }) => verifs.createWorkspace(requireNonEmpty(name, "name")),
    verifs_file_list: async ({ workspace_id }) => verifs.listFiles(workspace_id),
    verifs_file_read: async ({ workspace_id, path, run_id, actor = "agent:mcp" }) =>
      verifs.readFile(workspace_id, requireAbsolutePath(path), { run_id, actor }),
    verifs_file_write: async ({
      workspace_id,
      path,
      content,
      actor = "agent:mcp",
      ingest = true,
      allow_protected_write = false
    }) =>
      verifs.writeFile(workspace_id, requireAbsolutePath(path), requireNonEmpty(content, "content"), {
        actor,
        ingest,
        allow_protected_write
      }),
    verifs_file_append: async ({
      workspace_id,
      path,
      content,
      actor = "agent:mcp",
      ingest = true,
      allow_protected_write = false,
      run_id
    }) => {
      const normalizedPath = requireAbsolutePath(path);
      const nextContent = await appendFileContent(verifs, workspace_id, normalizedPath, requireNonEmpty(content, "content"));
      return verifs.writeFile(workspace_id, normalizedPath, nextContent, {
        actor,
        ingest,
        allow_protected_write,
        run_id
      });
    },
    verifs_file_upload: async ({
      workspace_id,
      path,
      content_base64,
      mime_type,
      actor = "agent:mcp",
      ingest = true,
      allow_protected_write = false
    }) =>
      verifs.uploadFile(workspace_id, requireAbsolutePath(path), Buffer.from(requireNonEmpty(content_base64, "content_base64"), "base64"), {
        mime_type,
        actor,
        ingest,
        allow_protected_write
      }),
    verifs_file_extract: async ({ workspace_id, path, actor = "agent:mcp" }) =>
      verifs.extractFile(workspace_id, requireAbsolutePath(path), actor),
    verifs_extracted_source_read: async ({ workspace_id, file_id, path }) => {
      const selector = file_id ?? path;
      if (!selector) throw new Error("file_id or path is required.");
      return verifs.listExtractedSources(workspace_id, selector);
    },
    verifs_file_delete: async ({ workspace_id, path, actor = "agent:mcp", allow_protected_write = false }) => {
      await verifs.deleteFile(workspace_id, requireAbsolutePath(path), {
        actor,
        allow_protected_write
      });
      return { ok: true };
    },
    verifs_grep: async ({
      workspace_id,
      query,
      mode = "literal",
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
      verifs.grepMemory(workspace_id, requireNonEmpty(query, "query"), {
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
    verifs_memory_search: async ({
      workspace_id,
      query,
      limit = 20,
      project_hint,
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
      include_stale = false
    }) =>
      verifs.grepMemory(workspace_id, requireNonEmpty(query, "query"), {
        mode: "hybrid",
        limit,
        project_hint,
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
        include_stale
      }),
    verifs_memory_recall: async ({
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
        memory_types: parseMemoryTypes(memory_types),
        trust_levels: parseMemoryTrustLevels(trust_levels),
        project_hint,
        run_id,
        scope,
        project_slug,
        repo_path,
        session_id,
        agent_id,
        contact_id
      };
      return verifs.recallMemory(workspace_id, requireNonEmpty(query, "query"), options);
    },
    verifs_memory_node_read: async ({ workspace_id, node_id }) => verifs.getMemoryNode(workspace_id, node_id),
    verifs_memory_raw_read: async ({ workspace_id, node_id }) => ({
      node_id,
      content: await verifs.readRawForNode(workspace_id, node_id)
    }),
    verifs_audit_list: async ({ workspace_id, limit = 100 }) => verifs.listAuditEvents(workspace_id, limit),
    verifs_memory_promote: async ({
      workspace_id,
      source_path,
      target_path,
      source_node_id,
      reason,
      actor = "agent:mcp"
    }) =>
      verifs.promoteMemory(workspace_id, {
        source_path: requireAbsolutePath(source_path),
        target_path: requireAbsolutePath(target_path),
        source_node_id,
        reason,
        actor,
        require_review: true
      }),
    verifs_promotion_list: async ({ workspace_id }) => verifs.listPromotions(workspace_id),
    verifs_candidate_create: async ({
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
      verifs.proposeMemoryCandidate(workspace_id, {
        memory_text,
        summary,
        trigger,
        detail,
        memory_type: parseMemoryType(memory_type),
        source_path: source_path ? requireAbsolutePath(source_path) : undefined,
        promotion_target_path: promotion_target_path ? requireAbsolutePath(promotion_target_path) : undefined,
        confidence,
        reason,
        actor,
        scope: parseMemoryScope(scope),
        project_slug,
        repo_path,
        session_id,
        agent_id,
        contact_id,
        run_id
      }),
    verifs_candidate_list: async ({
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
      verifs.listCandidates(workspace_id, {
        status: parseMemoryCandidateStatus(status),
        duplicates,
        conflicts,
        scope: parseMemoryScopeOption(scope),
        project_slug,
        repo_path,
        session_id,
        agent_id,
        contact_id,
        run_id
      }),
    verifs_candidate_read: async ({ workspace_id, candidate_id }) => verifs.getCandidate(workspace_id, candidate_id),
    verifs_candidate_update: async ({
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
      verifs.updateCandidate(workspace_id, candidate_id, {
        summary,
        trigger,
        detail,
        memory_text,
        memory_type: parseMemoryType(memory_type),
        confidence,
        status: parseEditableMemoryCandidateStatus(status),
        reason,
        actor
      }),
    verifs_snapshot_create: async ({ workspace_id, name, description, actor = "agent:mcp" }) =>
      verifs.createSnapshot(workspace_id, {
        name: requireNonEmpty(name, "name"),
        description,
        actor
      }),
    verifs_snapshot_list: async ({ workspace_id }) => verifs.listSnapshots(workspace_id),
    verifs_memory_health: async ({ workspace_id, recompute = false }) =>
      recompute ? verifs.recomputeMemoryHealth(workspace_id) : verifs.getMemoryHealth(workspace_id),
    verifs_brief: async ({
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
      verifs.createBrief(workspace_id, {
        task: requireNonEmpty(task, "task"),
        project_hint,
        scope: parseMemoryScopeOption(scope),
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
    verifs_run_create: async ({ workspace_id, task, title, actor = "agent:mcp" }) =>
      verifs.createRun(workspace_id, { task: requireNonEmpty(task, "task"), title, actor }),
    verifs_run_append: async ({ workspace_id, run_id, kind = "note", text, actor = "agent:mcp" }) => {
      const run = verifs.getRun(workspace_id, run_id);
      const artifactName = runArtifactForKind(kind);
      const filePath = `${run.run_path}/${artifactName}`;
      const nextContent = await appendFileContent(verifs, workspace_id, filePath, requireNonEmpty(text, "text"));
      const file = await verifs.writeFile(workspace_id, filePath, nextContent, {
        actor,
        ingest: false,
        run_id
      });
      verifs.logRunEvent(workspace_id, run_id, "run_artifact_appended", {
        kind,
        artifact: artifactName,
        path: filePath,
        actor
      });
      return file;
    },
    verifs_run_log_event: async ({ workspace_id, run_id, event_type, payload = {} }) =>
      verifs.logRunEvent(workspace_id, run_id, event_type, payload),
    verifs_run_complete: async ({ workspace_id, run_id, result, errors, followups, actor = "agent:mcp", failed = false }) =>
      verifs.completeRun(workspace_id, run_id, { result, errors, followups, actor, failed }),
    verifs_run_compile: async ({ workspace_id, run_id, actor = "agent:mcp", reasoning = false }) =>
      verifs.compileRun(workspace_id, run_id, { actor, reasoning }),
    verifs_run_lessons: async ({ workspace_id, run_id }) => verifs.listRunLessons(workspace_id, run_id),
    verifs_handoff: async ({ workspace_id, run_id, project_hint, actor = "agent:mcp" }) =>
      verifs.createHandoff(workspace_id, { run_id, project_hint, actor }),
    verifs_stale_memory_list: async ({ workspace_id }) => verifs.listStaleMemory(workspace_id),
    verifs_sync_status: async ({ workspace_id }) => verifs.getSyncStatus(workspace_id),
    verifs_sync_pull: async ({ workspace_id, actor = "agent:mcp" }) => verifs.syncPull(workspace_id, { actor }),
    verifs_sync_push: async ({ workspace_id, actor = "agent:mcp" }) => verifs.syncPush(workspace_id, actor),
    verifs_sync_conflict_list: async ({ workspace_id }) => verifs.listConflicts(workspace_id)
  };
}

export function createVeriFSMcpServer(verifs: VeriFS): McpServer {
  const server = new McpServer({
    name: "verifs",
    version: "0.1.0"
  });
  registerTools(server, createVeriFSMcpToolHandlers(verifs));
  return server;
}

function verifsGrepToolSchema() {
  return {
    workspace_id: z.string(),
    query: z.string(),
    mode: z.enum(["literal", "semantic", "hybrid"]).default("literal"),
    scope: z.array(z.string()).optional(),
    project_slug: z.string().optional(),
    repo_path: z.string().optional(),
    session_id: z.string().optional(),
    agent_id: z.string().optional(),
    contact_id: z.string().optional(),
    run_id: z.string().optional(),
    trust_min: z.enum(memoryTrustLevels).optional(),
    include_runs: z.boolean().default(true),
    include_sources: z.boolean().default(true),
    include_stale: z.boolean().default(false),
    limit: z.number().int().positive().default(20)
  };
}

function verifsMemorySearchToolSchema() {
  return {
    workspace_id: z.string(),
    query: z.string(),
    limit: z.number().int().positive().default(20),
    project_hint: z.string().optional(),
    scope: z.array(z.enum(memoryScopes)).optional(),
    project_slug: z.string().optional(),
    repo_path: z.string().optional(),
    session_id: z.string().optional(),
    agent_id: z.string().optional(),
    contact_id: z.string().optional(),
    run_id: z.string().optional(),
    trust_min: z.enum(memoryTrustLevels).optional(),
    include_runs: z.boolean().default(true),
    include_sources: z.boolean().default(true),
    include_stale: z.boolean().default(false)
  };
}

function verifsMemoryRecallToolSchema() {
  return {
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
    mode: z.enum(recallModes).optional(),
    memory_types: z.array(z.enum(memoryTypes)).optional(),
    trust_levels: z.array(z.enum(memoryTrustLevels)).optional(),
    project_hint: z.string().optional(),
    run_id: z.string().optional(),
    scope: z.array(z.enum(memoryScopes)).optional(),
    project_slug: z.string().optional(),
    repo_path: z.string().optional(),
    session_id: z.string().optional(),
    agent_id: z.string().optional(),
    contact_id: z.string().optional()
  };
}

export function createVeriFSMcpToolSchemas() {
  return {
    verifs_grep: verifsGrepToolSchema(),
    verifs_memory_search: verifsMemorySearchToolSchema(),
    verifs_memory_recall: verifsMemoryRecallToolSchema()
  };
}

function registerTools(server: McpServer, handlers: McpToolHandlers): void {
  const schemas = createVeriFSMcpToolSchemas();
  server.tool("verifs_workspace_list", "List VeriFS workspaces.", {}, async () =>
    textResult(await handlers.verifs_workspace_list())
  );
  server.tool(
    "verifs_workspace_create",
    "Create a VeriFS workspace.",
    { name: z.string() },
    async (input) => textResult(await handlers.verifs_workspace_create(input))
  );
  server.tool(
    "verifs_file_list",
    "List files in a workspace.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.verifs_file_list(input))
  );
  server.tool(
    "verifs_file_read",
    "Read a VeriFS file.",
    { workspace_id: z.string(), path: z.string() },
    async (input) => textResult(await handlers.verifs_file_read(input))
  );
  server.tool(
    "verifs_file_write",
    "Write a VeriFS file. Use scratch paths or run paths during agent work. Protected durable paths such as /preferences.md and /projects/*/decisions.md require allow_protected_write=true and should only be written when explicitly instructed.",
    {
      workspace_id: z.string(),
      path: z.string(),
      content: z.string(),
      actor: z.string().default("agent:mcp"),
      ingest: z.boolean().default(true),
      allow_protected_write: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.verifs_file_write(input))
  );
  server.tool(
    "verifs_file_append",
    "Append to a VeriFS file without bypassing write policy. Preferred for /scratch notes and /runs/<id> artifacts. Protected durable paths still require allow_protected_write=true.",
    {
      workspace_id: z.string(),
      path: z.string(),
      content: z.string(),
      actor: z.string().default("agent:mcp"),
      ingest: z.boolean().default(true),
      allow_protected_write: z.boolean().default(false),
      run_id: z.string().optional()
    },
    async (input) => textResult(await handlers.verifs_file_append(input))
  );
  server.tool(
    "verifs_file_delete",
    "Delete a VeriFS file. Protected paths require allow_protected_write=true.",
    {
      workspace_id: z.string(),
      path: z.string(),
      actor: z.string().default("agent:mcp"),
      allow_protected_write: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.verifs_file_delete(input))
  );
  server.tool(
    "verifs_file_upload",
    "Upload a base64-encoded file into VeriFS. Raw uploaded blob remains canonical.",
    {
      workspace_id: z.string(),
      path: z.string(),
      content_base64: z.string(),
      mime_type: z.string().optional(),
      actor: z.string().default("agent:mcp"),
      ingest: z.boolean().default(true),
      allow_protected_write: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.verifs_file_upload(input))
  );
  server.tool(
    "verifs_file_extract",
    "Extract derived text and source locations from an existing VeriFS file without reading raw source into normal recall.",
    {
      workspace_id: z.string(),
      path: z.string(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.verifs_file_extract(input))
  );
  server.tool(
    "verifs_extracted_source_read",
    "Read extracted text metadata for a file by file_id or path. This is derived text, not canonical raw source.",
    {
      workspace_id: z.string(),
      file_id: z.string().optional(),
      path: z.string().optional()
    },
    async (input) => textResult(await handlers.verifs_extracted_source_read(input))
  );
  server.tool(
    "verifs_grep",
    "Exact grep over VeriFS files by default. Pass mode=hybrid or mode=semantic for meaning-oriented matching.",
    schemas.verifs_grep,
    async (input) => textResult(await handlers.verifs_grep(input))
  );
  server.tool(
    "verifs_memory_search",
    "Meaning-oriented hybrid search over VeriFS sources and memory records. Equivalent to verifs_grep with mode=hybrid and returns the same grep/search result shape.",
    schemas.verifs_memory_search,
    async (input) => textResult(await handlers.verifs_memory_search(input))
  );
  server.tool(
    "verifs_memory_recall",
    "Recall relevant VeriFS memory nodes for context. Raw source is omitted by default; use memory_raw_source_read/verifs_memory_raw_read when raw source is explicitly needed.",
    schemas.verifs_memory_recall,
    async (input) => textResult(await handlers.verifs_memory_recall(input))
  );
  server.tool(
    "verifs_memory_node_read",
    "Read a structured memory node.",
    { workspace_id: z.string(), node_id: z.string() },
    async (input) => textResult(await handlers.verifs_memory_node_read(input))
  );
  server.tool(
    "verifs_memory_raw_read",
    "Explicit raw source read for a memory node. Use only when snippets and source refs are insufficient.",
    { workspace_id: z.string(), node_id: z.string() },
    async (input) => textResult(await handlers.verifs_memory_raw_read(input))
  );
  server.tool(
    "verifs_audit_list",
    "List audit events for a workspace.",
    { workspace_id: z.string(), limit: z.number().int().positive().default(100) },
    async (input) => textResult(await handlers.verifs_audit_list(input))
  );
  server.tool(
    "verifs_memory_promote",
    "Request a reviewable memory promotion. Agents can propose durable memory, but this tool never approves protected durable memory.",
    {
      workspace_id: z.string(),
      source_path: z.string(),
      target_path: z.string(),
      source_node_id: z.string().optional(),
      reason: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.verifs_memory_promote(input))
  );
  server.tool(
    "verifs_promotion_list",
    "List pending and historical memory promotions.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.verifs_promotion_list(input))
  );
  server.tool(
    "verifs_candidate_create",
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
    async (input) => textResult(await handlers.verifs_candidate_create(input))
  );
  server.tool(
    "verifs_candidate_list",
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
    async (input) => textResult(await handlers.verifs_candidate_list(input))
  );
  server.tool(
    "verifs_candidate_read",
    "Read one reviewable memory candidate.",
    { workspace_id: z.string(), candidate_id: z.string() },
    async (input) => textResult(await handlers.verifs_candidate_read(input))
  );
  server.tool(
    "verifs_candidate_update",
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
    async (input) => textResult(await handlers.verifs_candidate_update(input))
  );
  server.tool(
    "verifs_snapshot_create",
    "Create an auditable workspace snapshot.",
    {
      workspace_id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.verifs_snapshot_create(input))
  );
  server.tool(
    "verifs_snapshot_list",
    "List workspace snapshots.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.verifs_snapshot_list(input))
  );
  server.tool(
    "verifs_memory_health",
    "Read or recompute the memory health report.",
    { workspace_id: z.string(), recompute: z.boolean().default(false) },
    async (input) => textResult(await handlers.verifs_memory_health(input))
  );
  server.tool(
    "verifs_brief",
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
    async (input) => textResult(await handlers.verifs_brief(input))
  );
  server.tool(
    "verifs_run_create",
    "Create an agent run folder and database row before a task. Write notes under /runs using verifs_run_append or verifs_file_append.",
    {
      workspace_id: z.string(),
      task: z.string(),
      title: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.verifs_run_create(input))
  );
  server.tool(
    "verifs_run_append",
    "Append a result, error, followup, action, or note artifact under /runs/<run_id> without writing durable memory.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      kind: z.string().default("note"),
      text: z.string(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.verifs_run_append(input))
  );
  server.tool(
    "verifs_run_log_event",
    "Log a structured event during an agent run.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      event_type: z.string(),
      payload: z.unknown().optional()
    },
    async (input) => textResult(await handlers.verifs_run_log_event(input))
  );
  server.tool(
    "verifs_run_complete",
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
    async (input) => textResult(await handlers.verifs_run_complete(input))
  );
  server.tool(
    "verifs_run_compile",
    "Compile run artifacts into candidate memories, optional reasoning memories, and suggested promotions.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      actor: z.string().default("agent:mcp"),
      reasoning: z.boolean().default(false)
    },
    async (input) => textResult(await handlers.verifs_run_compile(input))
  );
  server.tool(
    "verifs_run_lessons",
    "List reviewable reasoning memories extracted from a run.",
    {
      workspace_id: z.string(),
      run_id: z.string()
    },
    async (input) => textResult(await handlers.verifs_run_lessons(input))
  );
  server.tool(
    "verifs_handoff",
    "Create a concise handoff summary for a run or project.",
    {
      workspace_id: z.string(),
      run_id: z.string().optional(),
      project_hint: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.verifs_handoff(input))
  );
  server.tool(
    "verifs_stale_memory_list",
    "List stale, conflicted, superseded, old, unconfirmed, or otherwise review-worthy memory nodes.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.verifs_stale_memory_list(input))
  );
  server.tool(
    "verifs_sync_status",
    "Read local sync status for a workspace.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.verifs_sync_status(input))
  );
  server.tool(
    "verifs_sync_pull",
    "Pull sync events from the configured sync store. Does not bypass protected path conflict checks.",
    { workspace_id: z.string(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.verifs_sync_pull(input))
  );
  server.tool(
    "verifs_sync_push",
    "Push local sync events to the configured sync store.",
    { workspace_id: z.string(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.verifs_sync_push(input))
  );
  server.tool(
    "verifs_sync_conflict_list",
    "List sync conflicts for a workspace.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.verifs_sync_conflict_list(input))
  );

  registerOpenClawAliases(server, handlers);
}

function registerOpenClawAliases(server: McpServer, handlers: McpToolHandlers): void {
  const schemas = createVeriFSMcpToolSchemas();
  server.tool("workspace_list", "List VeriFS workspaces before selecting where an agent should work.", {}, async () =>
    textResult(await handlers.verifs_workspace_list())
  );
  server.tool(
    "workspace_create",
    "Create a VeriFS workspace. Use sparingly; prefer existing project workspaces when available.",
    { name: z.string().min(1) },
    async (input) => textResult(await handlers.verifs_workspace_create(input))
  );
  server.tool(
    "file_read",
    "Read a VeriFS file. Use for source-backed inspection; raw memory-node source has a separate explicit tool.",
    { workspace_id: z.string(), path: z.string(), run_id: z.string().optional(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.verifs_file_read(input))
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
    async (input) => textResult(await handlers.verifs_file_write(input))
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
    async (input) => textResult(await handlers.verifs_file_append(input))
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
    async (input) => textResult(await handlers.verifs_file_upload(input))
  );
  server.tool(
    "file_extract",
    "Extract derived text and source locations from a VeriFS file without making raw source part of recall.",
    { workspace_id: z.string(), path: z.string(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.verifs_file_extract(input))
  );
  server.tool(
    "memory_search",
    "Meaning-oriented hybrid search over VeriFS sources and memory records. Returns the grep/search result shape without raw source content.",
    schemas.verifs_memory_search,
    async (input) => textResult(await handlers.verifs_memory_search(input))
  );
  server.tool(
    "memory_recall",
    "Recall task-relevant context. Call this when a full brief is unnecessary; raw source is omitted by default.",
    schemas.verifs_memory_recall,
    async (input) => textResult(await handlers.verifs_memory_recall(input))
  );
  server.tool(
    "memory_raw_source_read",
    "Explicitly read raw source for a memory node. Use only when source refs and snippets are insufficient.",
    { workspace_id: z.string(), node_id: z.string() },
    async (input) => textResult(await handlers.verifs_memory_raw_read(input))
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
    async (input) => textResult(await handlers.verifs_candidate_create(input))
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
    async (input) => textResult(await handlers.verifs_candidate_list(input))
  );
  server.tool(
    "candidate_read",
    "Read a memory candidate and its source refs.",
    { workspace_id: z.string(), candidate_id: z.string() },
    async (input) => textResult(await handlers.verifs_candidate_read(input))
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
    async (input) => textResult(await handlers.verifs_memory_promote(input))
  );
  server.tool(
    "run_create",
    "Create a run before starting task work.",
    { workspace_id: z.string(), task: z.string(), title: z.string().optional(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.verifs_run_create(input))
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
    async (input) => textResult(await handlers.verifs_run_append(input))
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
    async (input) => textResult(await handlers.verifs_run_complete(input))
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
    async (input) => textResult(await handlers.verifs_run_compile(input))
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
    async (input) => textResult(await handlers.verifs_brief(input))
  );
  server.tool(
    "handoff_create",
    "Create a handoff summary after or during a run.",
    { workspace_id: z.string(), run_id: z.string().optional(), project_hint: z.string().optional(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.verifs_handoff(input))
  );
  server.tool(
    "stale_list",
    "List stale, conflicted, superseded, old, or unconfirmed memories for review.",
    { workspace_id: z.string() },
    async (input) => textResult(await handlers.verifs_stale_memory_list(input))
  );
  server.tool(
    "audit_list",
    "List audit events for a workspace.",
    { workspace_id: z.string(), limit: z.number().int().positive().default(100) },
    async (input) => textResult(await handlers.verifs_audit_list(input))
  );
  server.tool(
    "snapshot_create",
    "Create an auditable snapshot before risky memory or file work.",
    { workspace_id: z.string(), name: z.string(), description: z.string().optional(), actor: z.string().default("agent:mcp") },
    async (input) => textResult(await handlers.verifs_snapshot_create(input))
  );
  server.tool(
    "health_report",
    "Read or recompute the workspace memory health report.",
    { workspace_id: z.string(), recompute: z.boolean().default(false) },
    async (input) => textResult(await handlers.verifs_memory_health(input))
  );
}

async function main(): Promise<void> {
  const mode = (process.env.VERIFS_MODE as "local" | "team" | "cloud" | undefined) ?? "local";
  const verifs = new VeriFS({
    dataDir: resolveDataDir(),
    mode,
    syncEnabled: envBoolean("VERIFS_SYNC_ENABLED") ?? mode !== "local",
    authRequired: envBoolean("VERIFS_AUTH_REQUIRED") ?? mode !== "local",
    memory: {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
      chatModel: process.env.VERIFS_CHAT_MODEL ?? "gpt-4o-mini",
      embedModel: process.env.VERIFS_EMBED_MODEL ?? "text-embedding-3-small"
    }
  });
  await verifs.initialize();

  process.once("SIGINT", () => {
    verifs.close();
    process.exit(0);
  });

  process.once("SIGTERM", () => {
    verifs.close();
    process.exit(0);
  });

  await createVeriFSMcpServer(verifs).connect(new StdioServerTransport());
}

function resolveDataDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const configured = process.env.VERIFS_DATA_DIR;
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

function parseMemoryTypes(values: string[] | undefined): MemoryType[] | undefined {
  return parseStringUnion(values, memoryTypes, "memory_types");
}

function parseMemoryTrustLevels(values: string[] | undefined): MemoryTrustLevel[] | undefined {
  return parseStringUnion(values, memoryTrustLevels, "trust_levels");
}

function parseMemoryType(value: string | undefined): MemoryType | undefined {
  return parseStringUnion(value ? [value] : undefined, memoryTypes, "memory_type")?.[0];
}

function parseMemoryScope(value: string | undefined): MemoryScope | undefined {
  return parseStringUnion(value ? [value] : undefined, memoryScopes, "scope")?.[0];
}

function parseMemoryScopeOption(value: string | string[] | undefined): RecallOptions["scope"] {
  return parseStringUnion(stringList(value), memoryScopes, "scope");
}

function parseMemoryCandidateStatus(value: string | undefined): MemoryCandidateStatus | undefined {
  return parseStringUnion(value ? [value] : undefined, memoryCandidateStatuses, "status")?.[0];
}

function parseEditableMemoryCandidateStatus(value: string | undefined): Exclude<MemoryCandidateStatus, "approved" | "rejected"> | undefined {
  return parseStringUnion(value ? [value] : undefined, editableMemoryCandidateStatuses, "status")?.[0];
}

function stringList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => entry.split(",").map((item) => item.trim()).filter(Boolean));
}

function requireAbsolutePath(value: string | undefined): string {
  const path = requireNonEmpty(value, "path");
  if (!path.startsWith("/")) {
    throw new Error("path must be an absolute VeriFS path starting with '/'.");
  }
  return path;
}

async function appendFileContent(verifs: VeriFS, workspaceId: string, path: string, content: string): Promise<string> {
  try {
    const existing = await verifs.readFile(workspaceId, path);
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
