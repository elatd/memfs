#!/usr/bin/env node
import { MemoryFS, type RecallOptions } from "@memoryfs/core";
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
  memfs_memory_search: (input: { workspace_id: string; query: string; limit?: number; project_hint?: string }) => Promise<unknown>;
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
    mode?: RecallOptions["mode"];
    memory_types?: string[];
    trust_levels?: string[];
    project_hint?: string;
    run_id?: string;
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
  memfs_snapshot_create: (input: { workspace_id: string; name: string; description?: string; actor?: string }) => Promise<unknown>;
  memfs_snapshot_list: (input: { workspace_id: string }) => Promise<unknown>;
  memfs_memory_health: (input: { workspace_id: string; recompute?: boolean }) => Promise<unknown>;
  memfs_brief: (input: {
    workspace_id: string;
    task: string;
    project_hint?: string;
    actor?: string;
    create_run?: boolean;
    limit?: number;
  }) => Promise<unknown>;
  memfs_run_create: (input: { workspace_id: string; task: string; title?: string; actor?: string }) => Promise<unknown>;
  memfs_run_log_event: (input: { workspace_id: string; run_id: string; event_type: string; payload?: unknown }) => Promise<unknown>;
  memfs_run_complete: (input: { workspace_id: string; run_id: string; result?: string; errors?: string; followups?: string; actor?: string; failed?: boolean }) => Promise<unknown>;
  memfs_run_compile: (input: { workspace_id: string; run_id: string; actor?: string }) => Promise<unknown>;
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
    memfs_workspace_create: async ({ name }) => memoryfs.createWorkspace(name),
    memfs_file_list: async ({ workspace_id }) => memoryfs.listFiles(workspace_id),
    memfs_file_read: async ({ workspace_id, path, run_id, actor = "agent:mcp" }) =>
      memoryfs.readFile(workspace_id, path, { run_id, actor }),
    memfs_file_write: async ({
      workspace_id,
      path,
      content,
      actor = "agent:mcp",
      ingest = true,
      allow_protected_write = false
    }) =>
      memoryfs.writeFile(workspace_id, path, content, {
        actor,
        ingest,
        allow_protected_write
      }),
    memfs_file_upload: async ({
      workspace_id,
      path,
      content_base64,
      mime_type,
      actor = "agent:mcp",
      ingest = true,
      allow_protected_write = false
    }) =>
      memoryfs.uploadFile(workspace_id, path, Buffer.from(content_base64, "base64"), {
        mime_type,
        actor,
        ingest,
        allow_protected_write
      }),
    memfs_file_extract: async ({ workspace_id, path, actor = "agent:mcp" }) =>
      memoryfs.extractFile(workspace_id, path, actor),
    memfs_extracted_source_read: async ({ workspace_id, file_id, path }) =>
      memoryfs.listExtractedSources(workspace_id, file_id ?? path),
    memfs_file_delete: async ({ workspace_id, path, actor = "agent:mcp", allow_protected_write = false }) => {
      await memoryfs.deleteFile(workspace_id, path, {
        actor,
        allow_protected_write
      });
      return { ok: true };
    },
    memfs_memory_search: async ({ workspace_id, query, limit = 8, project_hint }) =>
      memoryfs.searchMemory(workspace_id, query, {
        limit,
        include_detail: true,
        include_raw: false,
        project_hint
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
      mode,
      memory_types,
      trust_levels,
      project_hint,
      run_id
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
        mode,
        memory_types,
        trust_levels,
        project_hint,
        run_id
      };
      return memoryfs.recallMemory(workspace_id, query, options);
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
        source_path,
        target_path,
        source_node_id,
        reason,
        actor,
        require_review: true
      }),
    memfs_promotion_list: async ({ workspace_id }) => memoryfs.listPromotions(workspace_id),
    memfs_snapshot_create: async ({ workspace_id, name, description, actor = "agent:mcp" }) =>
      memoryfs.createSnapshot(workspace_id, {
        name,
        description,
        actor
      }),
    memfs_snapshot_list: async ({ workspace_id }) => memoryfs.listSnapshots(workspace_id),
    memfs_memory_health: async ({ workspace_id, recompute = false }) =>
      recompute ? memoryfs.recomputeMemoryHealth(workspace_id) : memoryfs.getMemoryHealth(workspace_id),
    memfs_brief: async ({ workspace_id, task, project_hint, actor = "agent:mcp", create_run = true, limit = 12 }) =>
      memoryfs.createBrief(workspace_id, {
        task,
        project_hint,
        actor,
        create_run,
        limit,
        include_recent_runs: true,
        include_open_questions: true,
        include_contradictions: true
      }),
    memfs_run_create: async ({ workspace_id, task, title, actor = "agent:mcp" }) =>
      memoryfs.createRun(workspace_id, { task, title, actor }),
    memfs_run_log_event: async ({ workspace_id, run_id, event_type, payload = {} }) =>
      memoryfs.logRunEvent(workspace_id, run_id, event_type, payload),
    memfs_run_complete: async ({ workspace_id, run_id, result, errors, followups, actor = "agent:mcp", failed = false }) =>
      memoryfs.completeRun(workspace_id, run_id, { result, errors, followups, actor, failed }),
    memfs_run_compile: async ({ workspace_id, run_id, actor = "agent:mcp" }) =>
      memoryfs.compileRun(workspace_id, run_id, { actor }),
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
    "Write a MemFS file. Protected paths require allow_protected_write=true.",
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
    "memfs_memory_search",
    "Search MemFS memory nodes with hybrid retrieval. Returns source_path and raw_ref.",
    {
      workspace_id: z.string(),
      query: z.string(),
      limit: z.number().int().positive().default(8),
      project_hint: z.string().optional()
    },
    async (input) => textResult(await handlers.memfs_memory_search(input))
  );
  server.tool(
    "memfs_memory_recall",
    "Recall relevant MemFS memory nodes. Raw source is included only when include_raw=true.",
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
      mode: z.enum(["general", "task_preparation", "fact_lookup", "debugging", "handoff", "research", "decision_review"]).optional(),
      memory_types: z.array(z.string()).optional(),
      trust_levels: z.array(z.string()).optional(),
      project_hint: z.string().optional(),
      run_id: z.string().optional()
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
    "Explicitly read the raw source content for a memory node.",
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
    "Propose a memory promotion. Agents can propose promotions, but this tool does not approve them.",
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
    "Create a pre-task memory brief. Raw source is not included.",
    {
      workspace_id: z.string(),
      task: z.string(),
      project_hint: z.string().optional(),
      actor: z.string().default("agent:mcp"),
      create_run: z.boolean().default(true),
      limit: z.number().int().positive().default(12)
    },
    async (input) => textResult(await handlers.memfs_brief(input))
  );
  server.tool(
    "memfs_run_create",
    "Create an agent run folder and database row.",
    {
      workspace_id: z.string(),
      task: z.string(),
      title: z.string().optional(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_run_create(input))
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
    "Compile run artifacts into candidate memories and suggested promotions.",
    {
      workspace_id: z.string(),
      run_id: z.string(),
      actor: z.string().default("agent:mcp")
    },
    async (input) => textResult(await handlers.memfs_run_compile(input))
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
    "List memory nodes that should be reviewed for staleness.",
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

  registerLegacyAliases(server, handlers);
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
    "memoryfs_memory_search",
    "Alias for memfs_memory_search.",
    {
      workspace_id: z.string(),
      query: z.string(),
      limit: z.number().int().positive().default(8),
      project_hint: z.string().optional()
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
      mode: z.enum(["general", "task_preparation", "fact_lookup", "debugging", "handoff", "research", "decision_review"]).optional(),
      memory_types: z.array(z.string()).optional(),
      trust_levels: z.array(z.string()).optional(),
      project_hint: z.string().optional()
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
