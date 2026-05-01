import cors from "@fastify/cors";
import { MemoryFS, MemoryFSError, type ArchiveEntryType, type MemoryGrepOptions, type MemoryRelationType, type PromoteMemoryRequest, type RecallOptions, type SyncEvent } from "@memoryfs/core";
import dotenv from "dotenv";
import Fastify, { type FastifyRequest } from "fastify";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const moduleDir = dirname(fileURLToPath(import.meta.url));

export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const mode = (process.env.MEMFS_MODE as "local" | "team" | "cloud" | undefined) ?? "local";
  const syncEnabled = envBoolean("MEMFS_SYNC_ENABLED") ?? mode !== "local";
  const authRequired = envBoolean("MEMFS_AUTH_REQUIRED") ?? mode !== "local";
  const memoryfs = new MemoryFS({
    dataDir: resolveDataDir(),
    mode,
    databaseUrl: process.env.MEMFS_DATABASE_URL,
    syncEnabled,
    authRequired,
    memory: {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
      chatModel: process.env.MEMORYFS_CHAT_MODEL ?? "gpt-4o-mini",
      embedModel: process.env.MEMORYFS_EMBED_MODEL ?? "text-embedding-3-small"
    }
  });
  await memoryfs.initialize();

  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : true
  });

  await app.register(cors, {
    origin: true
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!authRequired || request.url === "/health") return;
    if (!actorFromRequest(request)) {
      return reply.status(401).send({ error: "Authentication required. Send Authorization: Bearer <actor> or x-memfs-actor." });
    }
  });

  app.addHook("onClose", async () => {
    memoryfs.close();
  });

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error instanceof MemoryFSError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : "Unknown MemoryFS API error.";
    reply.status(statusCode).send({
      error: message
    });
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/workspaces", async (request) => {
    const body = request.body as { name?: string };
    return memoryfs.createWorkspace(body.name ?? "");
  });

  app.get("/workspaces", async () => memoryfs.listWorkspaces());

  app.get("/workspaces/:id", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.getWorkspace(id);
  });

  app.get("/workspaces/:id/files", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.listFiles(id);
  });

  app.get("/workspaces/:id/files/read", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { path?: string; run_id?: string; actor?: string };
    return memoryfs.readFile(id, query.path ?? "", {
      run_id: query.run_id,
      actor: query.actor ?? actorFromRequest(request)
    });
  });

  app.post("/workspaces/:id/files/write", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      path?: string;
      content?: string;
      actor?: string;
      ingest?: boolean;
      allow_protected_write?: boolean;
      run_id?: string;
    };
    return memoryfs.writeFile(id, body.path ?? "", body.content ?? "", {
      actor: body.actor ?? actorFromRequest(request),
      ingest: body.ingest ?? true,
      allow_protected_write: body.allow_protected_write ?? false,
      run_id: body.run_id
    });
  });

  app.post("/workspaces/:id/files/delete", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      path?: string;
      actor?: string;
      allow_protected_write?: boolean;
    };
    await memoryfs.deleteFile(id, body.path ?? "", {
      actor: body.actor ?? actorFromRequest(request),
      allow_protected_write: body.allow_protected_write ?? false
    });
    return { ok: true };
  });

  app.post("/workspaces/:id/files/upload", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      path?: string;
      content_base64?: string;
      content?: string;
      mime_type?: string;
      actor?: string;
      ingest?: boolean;
      allow_protected_write?: boolean;
      run_id?: string;
    };
    const bytes = body.content_base64
      ? Buffer.from(body.content_base64, "base64")
      : Buffer.from(body.content ?? "", "utf8");
    return memoryfs.uploadFile(id, body.path ?? "", bytes, {
      mime_type: body.mime_type,
      actor: body.actor ?? actorFromRequest(request),
      ingest: body.ingest ?? true,
      allow_protected_write: body.allow_protected_write ?? false,
      run_id: body.run_id
    });
  });

  app.get("/workspaces/:id/files/:file_id/extracted", async (request) => {
    const { id, file_id } = request.params as { id: string; file_id: string };
    return memoryfs.listExtractedSources(id, file_id);
  });

  app.post("/workspaces/:id/files/extract", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string; actor?: string };
    return memoryfs.extractFile(id, body.path ?? "", body.actor ?? actorFromRequest(request) ?? "agent:api");
  });

  app.post("/workspaces/:id/memory/ingest-file", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string; actor?: string };
    return memoryfs.ingestFile(id, body.path ?? "", body.actor ?? actorFromRequest(request) ?? "agent:api");
  });

  app.post("/workspaces/:id/memory/search", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      query?: string;
      limit?: number;
      include_detail?: boolean;
      include_raw?: boolean;
      project_hint?: string;
      scope?: RecallOptions["scope"];
      project_id?: string;
      project_slug?: string;
      repo_id?: string;
      repo_path?: string;
      session_id?: string;
      agent_id?: string;
      contact_id?: string;
      run_id?: string;
      include_related?: boolean;
      include_stale?: boolean;
      log_memory_usage?: boolean;
    };
    return memoryfs.searchMemory(id, body.query ?? "", body);
  });

  app.post("/workspaces/:id/memory/grep", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as MemoryGrepOptions & { query?: string };
    return memoryfs.grepMemory(id, body.query ?? "", body);
  });

  app.get("/workspaces/:id/archive", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.archive.list(id);
  });

  app.post("/workspaces/:id/archive/import", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      content?: string;
      title?: string;
      archive_type?: ArchiveEntryType;
      actor?: string;
      metadata?: Record<string, unknown>;
    };
    return memoryfs.archive.importText(id, {
      content: body.content ?? "",
      title: body.title,
      archive_type: body.archive_type,
      actor: body.actor ?? actorFromRequest(request) ?? "agent:api",
      metadata: body.metadata
    });
  });

  app.post("/workspaces/:id/archive/search", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as MemoryGrepOptions & { query?: string };
    return memoryfs.grepMemory(id, body.query ?? "", {
      mode: body.mode ?? "hybrid",
      scope: body.scope ?? ["archive"],
      trust_min: body.trust_min,
      include_runs: body.include_runs,
      include_sources: body.include_sources ?? true,
      limit: body.limit ?? 20,
      project_hint: body.project_hint
    });
  });

  app.post("/workspaces/:id/archive/:archive_id/extract", async (request) => {
    const { id, archive_id } = request.params as { id: string; archive_id: string };
    const body = request.body as { actor?: string; limit?: number };
    return memoryfs.archive.extractToMemoryCandidates(id, archive_id, {
      actor: body.actor ?? actorFromRequest(request) ?? "agent:api",
      limit: body.limit
    });
  });

  app.get("/workspaces/:id/archive/:archive_id", async (request) => {
    const { id, archive_id } = request.params as { id: string; archive_id: string };
    return memoryfs.archive.read(id, archive_id);
  });

  app.post("/workspaces/:id/memory/recall", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      query?: string;
      limit?: number;
      include_detail?: boolean;
      include_raw?: boolean;
      project_hint?: string;
      scope?: RecallOptions["scope"];
      project_id?: string;
      project_slug?: string;
      repo_id?: string;
      repo_path?: string;
      session_id?: string;
      agent_id?: string;
      contact_id?: string;
      run_id?: string;
      include_related?: boolean;
      include_stale?: boolean;
      log_memory_usage?: boolean;
    };
    return memoryfs.recallMemory(id, body.query ?? "", body);
  });

  app.get("/workspaces/:id/memory/nodes", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.listMemoryNodes(id);
  });

  app.get("/workspaces/:id/memory/nodes/:node_id", async (request) => {
    const { id, node_id } = request.params as { id: string; node_id: string };
    return memoryfs.getMemoryNode(id, node_id);
  });

  app.get("/workspaces/:id/memory/nodes/:node_id/raw", async (request) => {
    const { id, node_id } = request.params as { id: string; node_id: string };
    const query = request.query as { run_id?: string; actor?: string };
    return {
      node_id,
      content: await memoryfs.readRawForNode(id, node_id, {
        run_id: query.run_id,
        actor: query.actor ?? actorFromRequest(request)
      })
    };
  });

  app.get("/workspaces/:id/memory/nodes/:node_id/source", async (request) => {
    const { id, node_id } = request.params as { id: string; node_id: string };
    return memoryfs.getMemoryNodeSource(id, node_id);
  });

  app.get("/workspaces/:id/memory/nodes/:node_id/links", async (request) => {
    const { id, node_id } = request.params as { id: string; node_id: string };
    return memoryfs.getMemoryNodeLinks(id, node_id);
  });

  app.get("/workspaces/:id/memory/graph/nodes/:node_id", async (request) => {
    const { id, node_id } = request.params as { id: string; node_id: string };
    return memoryfs.getMemoryGraphNode(id, node_id);
  });

  app.get("/workspaces/:id/memory/graph/nodes/:node_id/related", async (request) => {
    const { id, node_id } = request.params as { id: string; node_id: string };
    const query = request.query as { depth?: string; limit?: string; include_stale?: string; relation_types?: string };
    return memoryfs.findRelatedMemories(id, node_id, {
      depth: query.depth ? Number(query.depth) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      include_stale: query.include_stale === "true",
      relation_types: query.relation_types ? query.relation_types.split(",").map((entry) => entry.trim()) as MemoryRelationType[] : undefined
    });
  });

  app.get("/workspaces/:id/memory/graph/path", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { from_node_id?: string; to_node_id?: string; max_depth?: string; relation_types?: string };
    return memoryfs.explainRelationshipPath(id, query.from_node_id ?? "", query.to_node_id ?? "", {
      max_depth: query.max_depth ? Number(query.max_depth) : undefined,
      relation_types: query.relation_types ? query.relation_types.split(",").map((entry) => entry.trim()) as MemoryRelationType[] : undefined
    });
  });

  app.post("/workspaces/:id/memory/nodes/:node_id/links", async (request) => {
    const { id, node_id } = request.params as { id: string; node_id: string };
    const body = request.body as {
      to_node_id?: string;
      relation_type?: MemoryRelationType;
      confidence?: number;
      reason?: string;
      actor?: string;
    };
    return memoryfs.linkMemoryNodes(id, node_id, body.to_node_id ?? "", body.relation_type ?? "related_to", {
      confidence: body.confidence,
      reason: body.reason,
      actor: body.actor ?? "human:web"
    });
  });

  app.post("/workspaces/:id/memory/graph/links", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      from_node_id?: string;
      to_node_id?: string;
      from_type?: "memory_node" | "file" | "run" | "candidate" | "reasoning_memory";
      from_id?: string;
      to_type?: "memory_node" | "file" | "run" | "candidate" | "reasoning_memory";
      to_id?: string;
      relation_type?: MemoryRelationType;
      confidence?: number;
      reason?: string;
      source_ref?: string | null;
      actor?: string;
    };
    return memoryfs.createGraphEdge(id, {
      from_node_id: body.from_node_id,
      to_node_id: body.to_node_id,
      from_type: body.from_type,
      from_id: body.from_id,
      to_type: body.to_type,
      to_id: body.to_id,
      relation_type: body.relation_type ?? "related_to",
      confidence: body.confidence,
      reason: body.reason,
      source_ref: body.source_ref,
      actor: body.actor ?? actorFromRequest(request) ?? "human:web"
    });
  });

  app.delete("/workspaces/:id/memory/graph/links/:edge_id", async (request) => {
    const { id, edge_id } = request.params as { id: string; edge_id: string };
    const query = request.query as { actor?: string };
    const body = request.body as { actor?: string } | undefined;
    return memoryfs.deleteGraphEdge(id, edge_id, {
      actor: query.actor ?? body?.actor ?? actorFromRequest(request) ?? "human:web"
    });
  });

  app.post("/workspaces/:id/memory/nodes/:node_id/mark-stale", async (request) => {
    const { id, node_id } = request.params as { id: string; node_id: string };
    const body = request.body as { reason?: string; actor?: string };
    return memoryfs.markMemoryStale(id, node_id, {
      reason: body.reason ?? "Marked stale.",
      actor: body.actor ?? actorFromRequest(request) ?? "human:web"
    });
  });

  app.post("/workspaces/:id/memory/nodes/:node_id/confirm", async (request) => {
    const { id, node_id } = request.params as { id: string; node_id: string };
    const body = request.body as { actor?: string };
    return memoryfs.confirmMemory(id, node_id, {
      actor: body.actor ?? actorFromRequest(request) ?? "human:web"
    });
  });

  app.post("/workspaces/:id/memory/nodes/:old_node_id/supersede/:new_node_id", async (request) => {
    const { id, old_node_id, new_node_id } = request.params as { id: string; old_node_id: string; new_node_id: string };
    const body = request.body as { reason?: string; actor?: string };
    return memoryfs.supersedeMemory(id, old_node_id, new_node_id, {
      reason: body.reason,
      actor: body.actor ?? actorFromRequest(request) ?? "human:web"
    });
  });

  app.get("/workspaces/:id/memory/contradictions", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.findContradictions(id);
  });

  app.post("/workspaces/:id/memory/explain-recall", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      query?: string;
      limit?: number;
      include_detail?: boolean;
      include_raw?: boolean;
      project_hint?: string;
      mode?: RecallOptions["mode"];
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
    };
    return memoryfs.explainRecall(id, body.query ?? "", body);
  });

  app.post("/workspaces/:id/brief", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      task?: string;
      project_hint?: string;
      scope?: RecallOptions["scope"];
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
      mode?: RecallOptions["mode"];
      include_recent_runs?: boolean;
      include_open_questions?: boolean;
      include_contradictions?: boolean;
      include_raw?: boolean;
      include_candidates?: boolean;
      limit?: number;
      create_run?: boolean;
    };
    return memoryfs.createBrief(id, {
      task: body.task ?? "",
      project_hint: body.project_hint,
      scope: body.scope as never,
      project_id: body.project_id,
      project_slug: body.project_slug,
      repo_id: body.repo_id,
      repo_path: body.repo_path,
      session_id: body.session_id,
      agent_id: body.agent_id,
      contact_id: body.contact_id,
      run_id: body.run_id,
      files: body.files,
      actor: body.actor ?? actorFromRequest(request),
      mode: body.mode,
      include_recent_runs: body.include_recent_runs,
      include_open_questions: body.include_open_questions,
      include_contradictions: body.include_contradictions,
      include_raw: body.include_raw,
      include_candidates: body.include_candidates,
      limit: body.limit,
      create_run: body.create_run
    });
  });

  app.post("/workspaces/:id/runs", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { task?: string; title?: string; actor?: string };
    return memoryfs.createRun(id, {
      task: body.task ?? "",
      title: body.title,
      actor: body.actor
    });
  });

  app.get("/workspaces/:id/runs", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.listRuns(id);
  });

  app.get("/workspaces/:id/runs/:run_id", async (request) => {
    const { id, run_id } = request.params as { id: string; run_id: string };
    return {
      run: memoryfs.getRun(id, run_id),
      events: memoryfs.listRunEvents(id, run_id),
      memory_used: memoryfs.listRunMemoryUsage(id, run_id)
    };
  });

  app.post("/workspaces/:id/runs/:run_id/start", async (request) => {
    const { id, run_id } = request.params as { id: string; run_id: string };
    const body = request.body as { actor?: string };
    return memoryfs.startRun(id, run_id, body.actor ?? actorFromRequest(request) ?? "agent:api");
  });

  app.post("/workspaces/:id/runs/:run_id/events", async (request) => {
    const { id, run_id } = request.params as { id: string; run_id: string };
    const body = request.body as { event_type?: string; payload?: unknown };
    return memoryfs.logRunEvent(id, run_id, body.event_type ?? "event", body.payload ?? {});
  });

  app.post("/workspaces/:id/runs/:run_id/complete", async (request) => {
    const { id, run_id } = request.params as { id: string; run_id: string };
    const body = request.body as { result?: string; errors?: string; followups?: string; actor?: string; failed?: boolean };
    return memoryfs.completeRun(id, run_id, body);
  });

  app.post("/workspaces/:id/runs/:run_id/compile", async (request) => {
    const { id, run_id } = request.params as { id: string; run_id: string };
    const body = request.body as { actor?: string; create_promotions?: boolean; reasoning?: boolean };
    return memoryfs.compileRun(id, run_id, body);
  });

  app.get("/workspaces/:id/runs/:run_id/lessons", async (request) => {
    const { id, run_id } = request.params as { id: string; run_id: string };
    return memoryfs.listRunLessons(id, run_id);
  });

  app.get("/workspaces/:id/runs/:run_id/memory-used", async (request) => {
    const { id, run_id } = request.params as { id: string; run_id: string };
    return memoryfs.listRunMemoryUsage(id, run_id);
  });

  app.post("/workspaces/:id/handoff", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { run_id?: string; project_hint?: string; actor?: string };
    return memoryfs.createHandoff(id, body);
  });

  app.get("/workspaces/:id/handoffs", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.listHandoffs(id);
  });

  app.get("/workspaces/:id/memory/stale", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.listStaleMemory(id);
  });

  app.post("/workspaces/:id/memory/stale/review", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { node_ids?: string[]; reviewer?: string; comment?: string };
    return memoryfs.reviewStaleMemory(id, body);
  });

  app.get("/workspaces/:id/memory/candidates", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as {
      status?: string;
      duplicates?: string;
      conflicts?: string;
      scope?: string | string[];
      project_slug?: string;
      repo_path?: string;
      session_id?: string;
      agent_id?: string;
      contact_id?: string;
      run_id?: string;
    };
    return memoryfs.listCandidates(id, {
      status: query.status as never,
      duplicates: query.duplicates === "true",
      conflicts: query.conflicts === "true",
      scope: query.scope as never,
      project_slug: query.project_slug,
      repo_path: query.repo_path,
      session_id: query.session_id,
      agent_id: query.agent_id,
      contact_id: query.contact_id,
      run_id: query.run_id
    });
  });

  app.post("/workspaces/:id/memory/candidates", async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Parameters<MemoryFS["proposeMemoryCandidate"]>[1];
    return memoryfs.proposeMemoryCandidate(id, {
      ...body,
      actor: body.actor ?? actorFromRequest(request) ?? "agent:api"
    });
  });

  app.get("/workspaces/:id/memory/candidates/:candidate_id", async (request) => {
    const { id, candidate_id } = request.params as { id: string; candidate_id: string };
    return memoryfs.getCandidate(id, candidate_id);
  });

  app.post("/workspaces/:id/memory/candidates/:candidate_id/update", async (request) => {
    const { id, candidate_id } = request.params as { id: string; candidate_id: string };
    const body = (request.body ?? {}) as Parameters<MemoryFS["updateCandidate"]>[2];
    return memoryfs.updateCandidate(id, candidate_id, {
      ...body,
      actor: body.actor ?? body.reviewer ?? actorFromRequest(request) ?? "human:api"
    });
  });

  app.post("/workspaces/:id/memory/candidates/:candidate_id/approve", async (request) => {
    const { id, candidate_id } = request.params as { id: string; candidate_id: string };
    const body = (request.body ?? {}) as NonNullable<Parameters<MemoryFS["approveCandidate"]>[2]>;
    return memoryfs.approveCandidate(id, candidate_id, {
      ...body,
      reviewer: body.reviewer ?? actorFromRequest(request) ?? "human:api"
    });
  });

  app.post("/workspaces/:id/memory/candidates/:candidate_id/reject", async (request) => {
    const { id, candidate_id } = request.params as { id: string; candidate_id: string };
    const body = (request.body ?? {}) as NonNullable<Parameters<MemoryFS["rejectCandidate"]>[2]>;
    return memoryfs.rejectCandidate(id, candidate_id, {
      ...body,
      reviewer: body.reviewer ?? actorFromRequest(request) ?? "human:api"
    });
  });

  app.post("/workspaces/:id/memory/candidates/:candidate_id/resolve-conflict", async (request) => {
    const { id, candidate_id } = request.params as { id: string; candidate_id: string };
    const body = (request.body ?? {}) as Parameters<MemoryFS["resolveCandidateConflict"]>[2];
    return memoryfs.resolveCandidateConflict(id, candidate_id, {
      ...body,
      actor: body.actor ?? body.reviewer ?? actorFromRequest(request) ?? "human:api"
    });
  });

  app.post("/workspaces/:id/memory/promote", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      source_path?: string;
      target_path?: string;
      source_node_id?: string;
      proposed_memory_type?: string;
      reason?: string;
      actor?: string;
      require_review?: boolean;
      append?: boolean;
    };
    return memoryfs.promoteMemory(id, {
      source_path: body.source_path ?? "",
      target_path: body.target_path ?? "",
      source_node_id: body.source_node_id,
      proposed_memory_type: body.proposed_memory_type as PromoteMemoryRequest["proposed_memory_type"],
      reason: body.reason,
      actor: body.actor,
      require_review: body.require_review ?? true,
      append: body.append
    });
  });

  app.get("/workspaces/:id/memory/promotions", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.listPromotions(id);
  });

  app.get("/workspaces/:id/memory/promotions/:promotion_id", async (request) => {
    const { id, promotion_id } = request.params as { id: string; promotion_id: string };
    return memoryfs.getPromotion(id, promotion_id);
  });

  app.post("/workspaces/:id/memory/promotions/:promotion_id/approve", async (request) => {
    const { id, promotion_id } = request.params as { id: string; promotion_id: string };
    const body = request.body as { reviewer?: string; comment?: string; apply?: boolean };
    return memoryfs.approvePromotion(id, promotion_id, body.reviewer ?? actorFromRequest(request) ?? "human:api", body.comment, body.apply ?? true);
  });

  app.post("/workspaces/:id/memory/promotions/:promotion_id/reject", async (request) => {
    const { id, promotion_id } = request.params as { id: string; promotion_id: string };
    const body = request.body as { reviewer?: string; comment?: string };
    return memoryfs.rejectPromotion(id, promotion_id, body.reviewer ?? actorFromRequest(request) ?? "human:api", body.comment);
  });

  app.post("/workspaces/:id/memory/promotions/:promotion_id/apply", async (request) => {
    const { id, promotion_id } = request.params as { id: string; promotion_id: string };
    const body = request.body as { actor?: string };
    return memoryfs.applyPromotion(id, promotion_id, body.actor ?? actorFromRequest(request) ?? "human:api");
  });

  app.post("/workspaces/:id/snapshots", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; description?: string; actor?: string };
    return memoryfs.createSnapshot(id, {
      name: body.name ?? "",
      description: body.description,
      actor: body.actor ?? actorFromRequest(request)
    });
  });

  app.get("/workspaces/:id/snapshots", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.listSnapshots(id);
  });

  app.get("/workspaces/:id/snapshots/:snapshot_id", async (request) => {
    const { id, snapshot_id } = request.params as { id: string; snapshot_id: string };
    return memoryfs.getSnapshot(id, snapshot_id);
  });

  app.get("/workspaces/:id/snapshots/:snapshot_id/diff", async (request) => {
    const { id, snapshot_id } = request.params as { id: string; snapshot_id: string };
    return memoryfs.diffSnapshot(id, snapshot_id);
  });

  app.post("/workspaces/:id/snapshots/:snapshot_id/rollback", async (request) => {
    const { id, snapshot_id } = request.params as { id: string; snapshot_id: string };
    const body = request.body as { dry_run?: boolean; actor?: string };
    return memoryfs.rollbackSnapshot(id, snapshot_id, {
      dry_run: body.dry_run ?? false,
      actor: body.actor ?? actorFromRequest(request)
    });
  });

  app.get("/workspaces/:id/sync/status", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.getSyncStatus(id);
  });

  app.post("/workspaces/:id/sync/pull", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { actor?: string; events?: SyncEvent[] };
    return memoryfs.syncPull(id, {
      actor: body.actor ?? actorFromRequest(request) ?? "agent:api",
      events: body.events
    });
  });

  app.post("/workspaces/:id/sync/push", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { actor?: string };
    return memoryfs.syncPush(id, body.actor ?? actorFromRequest(request) ?? "agent:api");
  });

  app.get("/workspaces/:id/sync/conflicts", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.listConflicts(id);
  });

  app.post("/workspaces/:id/sync/conflicts/:conflict_id/resolve", async (request) => {
    const { id, conflict_id } = request.params as { id: string; conflict_id: string };
    const body = request.body as {
      mode?: "keep_local" | "keep_remote" | "manual_merge" | "keep_both";
      actor?: string;
      manual_content?: string;
    };
    return memoryfs.resolveConflict(id, conflict_id, {
      mode: body.mode ?? "keep_both",
      actor: body.actor ?? actorFromRequest(request) ?? "human:api",
      manual_content: body.manual_content
    });
  });

  app.get("/workspaces/:id/team/members", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.listWorkspaceMembers(id);
  });

  app.post("/workspaces/:id/team/members", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { handle?: string; role?: "owner" | "admin" | "editor" | "agent" | "viewer"; display_name?: string; actor?: string };
    return memoryfs.addWorkspaceMember(id, {
      handle: body.handle ?? "",
      role: body.role ?? "viewer",
      display_name: body.display_name ?? null,
      actor: body.actor ?? actorFromRequest(request) ?? "human:api"
    });
  });

  app.post("/workspaces/:id/team/role", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { handle?: string; role?: "owner" | "admin" | "editor" | "agent" | "viewer"; actor?: string };
    return memoryfs.setWorkspaceMemberRole(
      id,
      body.handle ?? "",
      body.role ?? "viewer",
      body.actor ?? actorFromRequest(request) ?? "human:api"
    );
  });

  app.get("/workspaces/:id/memory/health", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.getMemoryHealth(id);
  });

  app.post("/workspaces/:id/memory/health/recompute", async (request) => {
    const { id } = request.params as { id: string };
    return memoryfs.recomputeMemoryHealth(id);
  });

  app.get("/workspaces/:id/audit-events", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string };
    return memoryfs.listAuditEvents(id, Number(query.limit ?? 100));
  });

  app.post("/workspaces/:id/audit-events", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { actor?: string; event_type?: string; payload?: unknown };
    return memoryfs.recordAuditEvent(
      id,
      body.actor ?? actorFromRequest(request) ?? "agent:api",
      body.event_type ?? "audit_event",
      body.payload ?? {}
    );
  });

  return app;
}

function resolveDataDir(): string {
  const configured = process.env.MEMFS_DATA_DIR ?? process.env.MEMORYFS_DATA_DIR;
  return configured
    ? resolve(process.cwd(), configured)
    : resolve(moduleDir, "../../../data");
}

function envBoolean(name: string): boolean | undefined {
  if (!(name in process.env)) return undefined;
  return process.env[name] === "true";
}

function actorFromRequest(request: FastifyRequest): string | undefined {
  const header = request.headers["x-memfs-actor"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = request.headers.authorization;
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice("bearer ".length).trim();
  }
  return undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await buildServer();
  const port = Number(process.env.MEMORYFS_API_PORT ?? 3131);
  await app.listen({
    port,
    host: "0.0.0.0"
  });
}
