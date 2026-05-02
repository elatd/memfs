#!/usr/bin/env node
import { MemoryFSClient } from "@memoryfs/sdk";
import { listMountRegistry, runMountd, unmountMount, type MountRegistryEntry } from "@memoryfs/mountd";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CliConfig {
  selectedWorkspaceId?: string;
  selectedWorkspaceName?: string;
}

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliRunOptions {
  env?: NodeJS.ProcessEnv;
  io?: CliIo;
}

interface ParsedArgs {
  args: string[];
  json: boolean;
  allowProtected: boolean;
  ingest: boolean;
  dryRun: boolean;
}

interface Workspace {
  id: string;
  name: string;
}

interface FileRecord {
  id: string;
  path: string;
  size_bytes: number;
  updated_at: string;
}

interface FileReadResponse {
  file: FileRecord;
  content: string;
}

interface RecallResponse {
  query: string;
  results: RecallResult[];
}

interface RecallResult {
  node_id: string;
  summary: string;
  trigger: string;
  detail?: string | null;
  tags: string[];
  memory_type: string;
  importance: number;
  confidence: number;
  score: number;
  source_path: string;
  raw_ref: string;
  raw_excerpt?: string | null;
  raw_content?: string | null;
  scope?: string;
  project_slug?: string | null;
  repo_path?: string | null;
  session_id?: string | null;
  agent_id?: string | null;
  contact_id?: string | null;
  run_id?: string | null;
}

interface MemoryGraphEdge {
  id: string;
  edge_kind: "memory_link" | "graph_edge";
  workspace_id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation_type: string;
  confidence: number;
  reason: string;
  source_ref: string | null;
  created_at: string;
  direction?: "outgoing" | "incoming";
  other_type?: string;
  other_id?: string;
  from_summary?: string | null;
  to_summary?: string | null;
  from_source_path?: string | null;
  to_source_path?: string | null;
}

interface MemoryGraphNodeResponse {
  node: MemoryNode;
  edges: MemoryGraphEdge[];
}

interface RelatedMemoryResult {
  node: MemoryNode;
  depth: number;
  score: number;
  path: MemoryGraphEdge[];
}

interface RelationshipPathResponse {
  from_node: MemoryNode;
  to_node: MemoryNode;
  found: boolean;
  path: MemoryGraphEdge[];
  explanation: string;
}

interface DeleteGraphEdgeResponse {
  deleted: boolean;
  edge: MemoryGraphEdge;
}

interface MemoryGrepResponse {
  query: string;
  mode: "literal" | "semantic" | "hybrid";
  workspace_id: string;
  results: MemoryGrepResult[];
}

interface MemoryGrepResult {
  path: string;
  source_path: string;
  raw_ref: string | null;
  line: number | null;
  snippet: string;
  score: number;
  trust: string | null;
  scope?: string;
  project_slug?: string | null;
  repo_path?: string | null;
  session_id?: string | null;
  agent_id?: string | null;
  contact_id?: string | null;
  run_id?: string | null;
  node_id: string | null;
  match_type: string;
}

interface ArchiveEntry {
  id: string;
  archive_type: string;
  title: string;
  path: string;
  raw_ref: string;
  created_at: string;
}

interface ArchiveReadResponse {
  entry: ArchiveEntry;
  content: string;
}

interface ArchiveExtractResponse {
  archive: ArchiveEntry;
  candidate_nodes: MemoryNode[];
  summary: string;
}

interface MemoryNode {
  id: string;
  summary: string;
  trigger: string;
  detail: string | null;
  tags: string[];
  memory_type: string;
  importance: number;
  confidence: number;
  source_path: string;
  raw_ref: string;
  source_location_json?: string | null;
  trust_level?: string;
  status?: string;
  valid_from?: string | null;
  valid_until?: string | null;
  last_confirmed_at?: string | null;
  last_used_at?: string | null;
  supersedes?: string[];
  superseded_by?: string[];
  stale_reason?: string | null;
  scope?: string;
  project_id?: string | null;
  project_slug?: string | null;
  repo_id?: string | null;
  repo_path?: string | null;
  session_id?: string | null;
  agent_id?: string | null;
  contact_id?: string | null;
  run_id?: string | null;
}

interface ExtractedSource {
  id: string;
  extractor_name: string;
  extractor_version: string;
  content_text: string;
  metadata_json: string;
  created_at: string;
}

interface AuditEvent {
  id: string;
  actor: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

interface MemoryPromotion {
  id: string;
  source_path: string;
  target_path: string;
  status: string;
  actor: string;
  reviewer: string | null;
  reason: string | null;
  candidate_node_id: string | null;
  created_at: string;
}

interface MemoryCandidate {
  id: string;
  node_id: string;
  memory_text: string;
  type: string;
  scope: string;
  source_refs: Array<{ source_path: string; raw_ref: string; source_location?: Record<string, unknown> | null }>;
  confidence: number;
  risk_flags: string[];
  status: string;
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

interface ReasoningMemoryCandidate {
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
  source_refs: Array<{ path: string; raw_ref: string | null }>;
  confidence: number;
  status: string;
  reason: string;
}

interface SnapshotRecord {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

interface MemoryHealth {
  overall_score: number;
  source_coverage: number;
  contradiction_count: number;
  unresolved_promotion_count: number;
  orphan_node_count: number;
  raw_missing_count: number;
  low_confidence_count: number;
  rejected_node_count: number;
  stale_node_count: number;
  old_node_count?: number;
  unconfirmed_node_count?: number;
  superseded_node_count?: number;
  conflicted_node_count?: number;
}

interface SyncStatus {
  mode: string;
  enabled: boolean;
  pending_events: number;
  unresolved_conflicts: number;
  object_storage: { configured: boolean; bucket: string | null };
}

interface ConflictRecord {
  id: string;
  object_type: string;
  object_id: string;
  conflict_type: string;
  status: string;
  created_at: string;
}

interface TeamMember {
  handle: string;
  role: string;
  display_name: string | null;
}

interface AgentRun {
  id: string;
  title: string;
  task: string;
  actor: string;
  status: string;
  run_path: string;
  created_at: string;
  completed_at: string | null;
}

interface BriefResponse {
  brief_markdown: string;
  sections?: Record<string, unknown>;
  memory_results?: RecallResult[];
  run_id?: string;
}

const defaultApiUrl = "http://localhost:3131";

export async function runCli(argv: string[], options: CliRunOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const io = options.io ?? {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`)
  };
  const parsed = parseArgs(argv);
  const [root, subcommand, ...rest] = parsed.args;
  const client = new MemoryFSClient(env.MEMFS_API_URL ?? defaultApiUrl);

  try {
    switch (root) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        output(io, parsed, helpText(), { help: helpText() });
        return 0;
      case "init":
        await writeConfig(env, {});
        output(io, parsed, `MemFS config initialized at ${configPath(env)}`, {
          config_path: configPath(env)
        });
        return 0;
      case "status":
        return await status(client, env, io, parsed);
      case "workspace":
        return await workspaceCommand(client, env, io, parsed, subcommand, rest);
      case "use":
        return await useWorkspace(client, env, io, parsed, required(subcommand, "memfs use requires a workspace name or id."));
      case "ls":
        return await withWorkspace(client, env, io, parsed, async (workspaceId) => {
          const prefix = subcommand ?? "/";
          const files = (await client.listFiles(workspaceId)) as FileRecord[];
          const filtered = files.filter(
            (file) => prefix === "/" || file.path === prefix || file.path.startsWith(`${prefix.replace(/\/$/, "")}/`)
          );
          output(io, parsed, filtered.map((file) => file.path).join("\n") || "(no files)", filtered);
        });
      case "cat":
        return await withWorkspace(client, env, io, parsed, async (workspaceId) => {
          const response = (await client.readFile(
            workspaceId,
            required(subcommand, "memfs cat requires a path.")
          )) as FileReadResponse;
          output(io, parsed, response.content, response);
        });
      case "write":
        return await writeCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString), false);
      case "append":
        return await writeCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString), true);
      case "rm":
        return await withWorkspace(client, env, io, parsed, async (workspaceId) => {
          const filePath = required(subcommand, "memfs rm requires a path.");
          const response = await client.deleteFile(workspaceId, filePath, {
            actor: "human:cli",
            allow_protected_write: parsed.allowProtected
          });
          output(io, parsed, `Deleted ${filePath}`, response);
        });
      case "upload":
        return await uploadCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString));
      case "extract":
        return await extractCommand(client, env, io, parsed, required(subcommand, "memfs extract requires a MemFS path."));
      case "extracted":
        return await extractedCommand(client, env, io, parsed, required(subcommand, "memfs extracted requires a MemFS path."));
      case "grep":
        return await memoryGrepCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString), "grep", "literal");
      case "search":
        return await memoryGrepCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString), "search", "hybrid");
      case "sgrep":
        return await memoryGrepCommand(client, env, io, parsed, ["--semantic", subcommand, ...rest].filter(isString), "sgrep", "hybrid");
      case "recall":
        return await recallCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString));
      case "node":
        return await nodeCommand(client, env, io, parsed, subcommand, rest);
      case "nodes":
        return await nodeCommand(client, env, io, parsed, "list", [subcommand, ...rest].filter(isString));
      case "raw":
        return await withWorkspace(client, env, io, parsed, async (workspaceId) => {
          const nodeId = required(subcommand, "memfs raw requires a node id.");
          const response = (await client.readRaw(workspaceId, nodeId)) as { content: string };
          output(io, parsed, response.content, response);
        });
      case "audit":
        return await auditCommand(client, env, io, parsed, subcommand);
      case "promote":
        return await promoteCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString));
      case "promotions":
        return await promotionsCommand(client, env, io, parsed);
      case "candidates":
        return await candidatesCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString));
      case "candidate":
        return await candidateCommand(client, env, io, parsed, subcommand, rest);
      case "memory":
        return await memoryCommand(client, env, io, parsed, subcommand, rest);
      case "graph":
        return await graphCommand(client, env, io, parsed, subcommand, rest);
      case "approve":
        return await approvalCommand(client, env, io, parsed, required(subcommand, "memfs approve requires a promotion id."), true);
      case "reject":
        return await approvalCommand(client, env, io, parsed, required(subcommand, "memfs reject requires a promotion id."), false);
      case "snapshot":
        return await snapshotCommand(client, env, io, parsed, subcommand, rest);
      case "rollback":
        return await rollbackCommand(client, env, io, parsed, required(subcommand, "memfs rollback requires a snapshot id."));
      case "health":
        return await healthCommand(client, env, io, parsed);
      case "brief":
        return await briefCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString));
      case "run":
        return await runCommand(client, env, io, parsed, subcommand, rest);
      case "runs":
        return await runsCommand(client, env, io, parsed);
      case "archive":
        return await archiveCommand(client, env, io, parsed, subcommand, rest);
      case "handoff":
        return await handoffCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString));
      case "stale":
        return await staleCommand(client, env, io, parsed);
      case "sync":
        return await syncCommand(client, env, io, parsed, subcommand, rest);
      case "team":
        return await teamCommand(client, env, io, parsed, subcommand, rest);
      case "mount":
        return await mountCommand(env, io, parsed, subcommand, rest);
      case "unmount":
        return await unmountCommand(env, io, parsed, required(subcommand, "memfs unmount requires a mountpoint."));
      default:
        throw new Error(`Unknown command: ${root}\n\n${helpText()}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.json) {
      io.stdout(JSON.stringify({ error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

async function mountCommand(
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "status") {
    const entries = await listMountRegistry(env);
    output(io, parsed, formatMountStatus(entries), entries);
    return 0;
  }

  const workspace = required(subcommand, "memfs mount requires a workspace name or id.");
  const mountpoint = required(rest[0], "memfs mount requires a mountpoint.");
  const mountArgs = [workspace, mountpoint, ...rest.slice(1)];
  if (parsed.allowProtected && !mountArgs.includes("--allow-protected-write")) {
    mountArgs.push("--allow-protected-write");
  }
  if (!mountArgs.includes("--api-url")) {
    mountArgs.push("--api-url", env.MEMFS_API_URL ?? defaultApiUrl);
  }

  if (mountArgs.includes("--daemon")) {
    const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../mountd/src/index.ts");
    const child = spawn("tsx", [entry, ...mountArgs], {
      detached: true,
      stdio: "ignore",
      env
    });
    child.unref();
    output(io, parsed, `Mount daemon starting for ${workspace} at ${mountpoint}`, {
      workspace,
      mountpoint,
      pid: child.pid ?? null
    });
    return 0;
  }

  await runMountd(mountArgs, env);
  return 0;
}

async function unmountCommand(
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  mountpoint: string
): Promise<number> {
  const result = await unmountMount(mountpoint, env);
  output(io, parsed, result.message, result);
  return result.ok ? 0 : 1;
}

async function briefCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  args: string[]
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const briefArgs = parseBriefArgs(args);
    const cleaned = required(briefArgs.task.trim(), "memfs brief requires a task.");
    const response = (await client.createBrief(workspaceId, cleaned, {
      actor: "human:cli",
      project_hint: briefArgs.project_slug,
      scope: briefArgs.scope,
      project_slug: briefArgs.project_slug,
      repo_path: briefArgs.repo_path,
      session_id: briefArgs.session_id,
      agent_id: briefArgs.agent_id,
      contact_id: briefArgs.contact_id,
      run_id: briefArgs.run_id,
      files: briefArgs.files,
      include_candidates: briefArgs.include_candidates,
      limit: briefArgs.limit,
      create_run: briefArgs.create_run
    })) as BriefResponse;
    output(io, parsed, response.brief_markdown, response);
  });
}

async function runCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "create") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const task = required(rest.join(" ").trim(), "memfs run create requires a task.");
      const run = (await client.createRun(workspaceId, task, { actor: "human:cli" })) as AgentRun;
      output(io, parsed, formatRun(run), run);
    });
  }

  if (subcommand === "complete") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const runId = required(rest[0], "memfs run complete requires a run id.");
      const result = rest.slice(1).join(" ");
      const run = (await client.completeRun(workspaceId, runId, {
        actor: "human:cli",
        result: result || undefined
      })) as AgentRun;
      output(io, parsed, formatRun(run), run);
    });
  }

  if (subcommand === "compile") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const runId = required(rest[0], "memfs run compile requires a run id.");
      const response = await client.compileRun(workspaceId, runId, {
        actor: "human:cli",
        reasoning: rest.includes("--reasoning")
      });
      output(io, parsed, JSON.stringify(response, null, 2), response);
    });
  }

  if (subcommand === "lessons") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const runId = required(rest[0], "memfs run lessons requires a run id.");
      const lessons = (await client.listRunLessons(workspaceId, runId)) as ReasoningMemoryCandidate[];
      output(io, parsed, lessons.map(formatReasoningLesson).join("\n\n") || "(no reasoning lessons)", lessons);
    });
  }

  if (subcommand === "show") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const runId = required(rest[0], "memfs run show requires a run id.");
      const response = await client.readRun(workspaceId, runId);
      output(io, parsed, JSON.stringify(response, null, 2), response);
    });
  }

  if (subcommand === "path") {
    const runId = required(rest[0], "memfs run path requires a run id.");
    output(io, parsed, `/runs/${runId}`, { path: `/runs/${runId}` });
    return 0;
  }

  if (subcommand === "today") {
    const date = new Date().toISOString().slice(0, 10);
    output(io, parsed, `/runs/${date}`, { path: `/runs/${date}` });
    return 0;
  }

  throw new Error("Usage: memfs run create <task> | memfs run complete <run_id> | memfs run compile <run_id> [--reasoning] | memfs run lessons <run_id> | memfs run show <run_id> | memfs run path <run_id> | memfs run today");
}

async function runsCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const runs = (await client.listRuns(workspaceId)) as AgentRun[];
    output(io, parsed, runs.map(formatRun).join("\n") || "(no runs)", runs);
  });
}

async function archiveCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "add") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const localPath = required(rest[0], "memfs archive add requires a local text file.");
      const content = await readFile(localPath, "utf8");
      const archiveType = optionValue(rest, "--type") ?? "imported";
      const title = optionValue(rest, "--title") ?? path.basename(localPath);
      const entry = (await client.importArchiveText(workspaceId, content, {
        archive_type: archiveType as "conversation" | "transcript" | "imported" | "agent-run" | "raw",
        title,
        actor: "human:cli",
        metadata: { imported_from: localPath }
      })) as ArchiveEntry;
      output(io, parsed, formatArchiveEntry(entry), entry);
    });
  }

  if (subcommand === "list") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const entries = (await client.listArchive(workspaceId)) as ArchiveEntry[];
      output(io, parsed, entries.map(formatArchiveEntry).join("\n") || "(no archive entries)", entries);
    });
  }

  if (subcommand === "show") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const archiveId = required(rest[0], "memfs archive show requires an archive id.");
      const response = (await client.readArchive(workspaceId, archiveId)) as ArchiveReadResponse;
      output(io, parsed, response.content, response);
    });
  }

  if (subcommand === "extract") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const archiveId = required(rest[0], "memfs archive extract requires an archive id.");
      const response = (await client.extractArchive(workspaceId, archiveId, {
        actor: "human:cli"
      })) as ArchiveExtractResponse;
      output(io, parsed, formatArchiveExtract(response), response);
    });
  }

  if (subcommand === "search") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const query = required(rest.join(" ").trim(), "memfs archive search requires a query.");
      const response = (await client.searchArchive(workspaceId, query, {
        mode: "hybrid",
        scope: ["archive"],
        include_sources: true
      })) as MemoryGrepResponse;
      output(io, parsed, formatMemoryGrep(response), response);
    });
  }

  throw new Error("Usage: memfs archive add <local_path> --type conversation|transcript|imported|agent-run|raw --title <title> | memfs archive list | memfs archive show <archive_id> | memfs archive extract <archive_id> | memfs archive search <query>");
}

async function handoffCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  args: string[]
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const response = await client.createHandoff(workspaceId, {
      actor: "human:cli",
      project_hint: optionValue(args, "--project"),
      run_id: optionValue(args, "--run")
    });
    output(io, parsed, JSON.stringify(response, null, 2), response);
  });
}

async function staleCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const stale = await client.listStaleMemory(workspaceId);
    output(io, parsed, JSON.stringify(stale, null, 2), stale);
  });
}

async function syncCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "status") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const status = (await client.syncStatus(workspaceId)) as SyncStatus;
      output(io, parsed, formatSyncStatus(status), status);
    });
  }

  if (subcommand === "pull") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const response = await client.syncPull(workspaceId, { actor: "human:cli" });
      output(io, parsed, JSON.stringify(response, null, 2), response);
    });
  }

  if (subcommand === "push") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const response = await client.syncPush(workspaceId, { actor: "human:cli" });
      output(io, parsed, JSON.stringify(response, null, 2), response);
    });
  }

  if (subcommand === "conflicts") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const conflicts = (await client.listSyncConflicts(workspaceId)) as ConflictRecord[];
      output(io, parsed, conflicts.map(formatConflict).join("\n") || "(no sync conflicts)", conflicts);
    });
  }

  if (subcommand === "resolve") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const conflictId = required(rest[0], "memfs sync resolve requires a conflict id.");
      const mode = (optionValue(parsed.args, "--mode") ?? "keep_both") as
        | "keep_local"
        | "keep_remote"
        | "manual_merge"
        | "keep_both";
      const response = (await client.resolveSyncConflict(workspaceId, conflictId, {
        mode,
        actor: "human:cli"
      })) as ConflictRecord;
      output(io, parsed, formatConflict(response), response);
    });
  }

  throw new Error("Usage: memfs sync status | memfs sync pull | memfs sync push | memfs sync conflicts | memfs sync resolve <conflict_id> --mode keep_local|keep_remote|keep_both");
}

async function teamCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "members") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const members = (await client.listTeamMembers(workspaceId)) as TeamMember[];
      output(io, parsed, members.map(formatTeamMember).join("\n") || "(no team members)", members);
    });
  }

  if (subcommand === "invite") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const handle = required(rest[0], "memfs team invite requires a handle.");
      const role = (optionValue(parsed.args, "--role") ?? "viewer") as "owner" | "admin" | "editor" | "agent" | "viewer";
      const member = (await client.addTeamMember(workspaceId, {
        handle,
        role,
        actor: "human:cli"
      })) as TeamMember;
      output(io, parsed, formatTeamMember(member), member);
    });
  }

  if (subcommand === "role" && rest[0] === "set") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const handle = required(rest[1], "memfs team role set requires a handle.");
      const role = required(rest[2], "memfs team role set requires a role.") as "owner" | "admin" | "editor" | "agent" | "viewer";
      const member = (await client.setTeamRole(workspaceId, {
        handle,
        role,
        actor: "human:cli"
      })) as TeamMember;
      output(io, parsed, formatTeamMember(member), member);
    });
  }

  throw new Error("Usage: memfs team members | memfs team invite <handle> --role viewer|agent|editor|admin|owner | memfs team role set <handle> <role>");
}

async function promoteCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  args: string[]
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const sourcePath = required(args[0], "memfs promote requires a source path.");
    const targetPath = required(optionValue(args, "--to"), "memfs promote requires --to <target_path>.");
    const promotion = (await client.promoteMemory(workspaceId, sourcePath, targetPath, {
      actor: "human:cli",
      reason: optionValue(args, "--reason"),
      source_node_id: optionValue(args, "--node"),
      require_review: true
    })) as MemoryPromotion;
    output(io, parsed, formatPromotion(promotion), promotion);
  });
}

async function promotionsCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const promotions = (await client.listPromotions(workspaceId)) as MemoryPromotion[];
    output(
      io,
      parsed,
      promotions.map(formatPromotion).join("\n\n") || "(no promotions)",
      promotions
    );
  });
}

async function candidatesCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  args: string[]
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const candidates = (await client.listCandidates(workspaceId, candidateListOptions(args))) as MemoryCandidate[];
    output(io, parsed, candidates.map(formatCandidate).join("\n\n") || "(no candidates)", candidates);
  });
}

async function candidateCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "show") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const id = required(rest[0], "memfs candidate show requires a candidate id.");
      const candidate = (await client.readCandidate(workspaceId, id)) as MemoryCandidate;
      output(io, parsed, formatCandidate(candidate), candidate);
    });
  }

  if (subcommand === "edit") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const id = required(rest[0], "memfs candidate edit requires a candidate id.");
      const body = candidateEditBody(rest.slice(1));
      if (Object.keys(body).length === 1 && body.actor) {
        throw new Error("Usage: memfs candidate edit <id> [--summary <text>] [--detail <text>] [--status stale|conflicted|candidate|observed|superseded] [--target <path>] [--reason <text>]");
      }
      const candidate = (await client.updateCandidate(workspaceId, id, body)) as MemoryCandidate;
      output(io, parsed, formatCandidate(candidate), candidate);
    });
  }

  if (subcommand === "approve") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const id = required(rest[0], "memfs candidate approve requires a candidate id.");
      const candidate = (await client.approveCandidate(workspaceId, id, {
        reviewer: "human:cli",
        comment: optionValue(rest, "--comment"),
        target_path: optionValue(rest, "--target") ?? optionValue(rest, "--to"),
        apply: true
      })) as MemoryCandidate;
      output(io, parsed, formatCandidate(candidate), candidate);
    });
  }

  if (subcommand === "reject") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const id = required(rest[0], "memfs candidate reject requires a candidate id.");
      const candidate = (await client.rejectCandidate(workspaceId, id, {
        reviewer: "human:cli",
        comment: optionValue(rest, "--comment")
      })) as MemoryCandidate;
      output(io, parsed, formatCandidate(candidate), candidate);
    });
  }

  if (subcommand === "resolve-conflict") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const id = required(rest[0], "memfs candidate resolve-conflict requires a candidate id.");
      const mode = required(optionValue(rest, "--mode"), "memfs candidate resolve-conflict requires --mode keep_new|keep_old|keep_both|mark_superseded.");
      if (!["keep_new", "keep_old", "keep_both", "mark_superseded"].includes(mode)) {
        throw new Error("memfs candidate resolve-conflict --mode must be keep_new, keep_old, keep_both, or mark_superseded.");
      }
      const candidate = (await client.resolveCandidateConflict(workspaceId, id, {
        mode: mode as "keep_new" | "keep_old" | "keep_both" | "mark_superseded",
        actor: "human:cli",
        reason: optionValue(rest, "--reason"),
        target_path: optionValue(rest, "--target") ?? optionValue(rest, "--to")
      })) as MemoryCandidate;
      output(io, parsed, formatCandidate(candidate), candidate);
    });
  }

  throw new Error("Usage: memfs candidate show|edit|approve|reject|resolve-conflict <candidate_id>");
}

async function memoryCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "mark-stale") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const nodeId = required(rest[0], "memfs memory mark-stale requires a node id.");
      const reason = (optionValue(rest, "--reason") ?? rest.slice(1).join(" ").trim()) || "Marked stale.";
      const node = (await client.markMemoryStale(workspaceId, nodeId, {
        actor: "human:cli",
        reason
      })) as MemoryNode;
      output(io, parsed, formatNode(node), node);
    });
  }

  if (subcommand === "confirm") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const nodeId = required(rest[0], "memfs memory confirm requires a node id.");
      const node = (await client.confirmMemory(workspaceId, nodeId, { actor: "human:cli" })) as MemoryNode;
      output(io, parsed, formatNode(node), node);
    });
  }

  if (subcommand === "supersede") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const oldNodeId = required(rest[0], "memfs memory supersede requires an old node id.");
      const newNodeId = required(rest[1], "memfs memory supersede requires a new node id.");
      const link = await client.supersedeMemory(workspaceId, oldNodeId, newNodeId, {
        actor: "human:cli",
        reason: optionValue(rest, "--reason")
      });
      output(io, parsed, JSON.stringify(link, null, 2), link);
    });
  }

  throw new Error("Usage: memfs memory mark-stale <node_id> --reason <text> | memfs memory confirm <node_id> | memfs memory supersede <old_node_id> <new_node_id>");
}

async function graphCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "node") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const nodeId = required(rest[0], "memfs graph node requires a node id.");
      const response = (await client.getMemoryGraphNode(workspaceId, nodeId)) as MemoryGraphNodeResponse;
      output(io, parsed, formatGraphNode(response), response);
    });
  }

  if (subcommand === "related") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const nodeId = required(rest[0], "memfs graph related requires a node id.");
      const response = (await client.findRelatedMemories(workspaceId, nodeId, graphRelatedOptions(rest.slice(1)))) as RelatedMemoryResult[];
      output(io, parsed, response.map(formatRelatedMemory).join("\n\n") || "(no related memories)", response);
    });
  }

  if (subcommand === "link") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const fromId = required(rest[0], "memfs graph link requires a from id.");
      const relationType = required(rest[1], "memfs graph link requires a relation type.");
      const toId = required(rest[2], "memfs graph link requires a to id.");
      const confidence = optionValue(rest, "--confidence");
      const edge = (await client.createGraphEdge(workspaceId, {
        from_type: optionValue(rest, "--from-type") ?? "memory_node",
        from_id: fromId,
        to_type: optionValue(rest, "--to-type") ?? "memory_node",
        to_id: toId,
        relation_type: relationType,
        confidence: confidence ? Number(confidence) : undefined,
        reason: optionValue(rest, "--reason"),
        source_ref: optionValue(rest, "--source-ref") ?? undefined,
        actor: "human:cli"
      })) as MemoryGraphEdge;
      output(io, parsed, formatGraphEdge(edge), edge);
    });
  }

  if (subcommand === "unlink") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const edgeId = required(rest[0], "memfs graph unlink requires an edge id.");
      const response = (await client.deleteGraphEdge(workspaceId, edgeId, { actor: "human:cli" })) as DeleteGraphEdgeResponse;
      output(io, parsed, `Deleted graph edge ${response.edge.id}`, response);
    });
  }

  if (subcommand === "path") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const fromId = required(rest[0], "memfs graph path requires a from node id.");
      const toId = required(rest[1], "memfs graph path requires a to node id.");
      const maxDepth = optionValue(rest, "--max-depth");
      const response = (await client.explainGraphPath(workspaceId, fromId, toId, {
        max_depth: maxDepth ? Number(maxDepth) : undefined,
        relation_types: optionValue(rest, "--relation-types")?.split(",").map((entry) => entry.trim()).filter(Boolean)
      })) as RelationshipPathResponse;
      output(io, parsed, formatGraphPath(response), response);
    });
  }

  throw new Error("Usage: memfs graph node <node_id> | memfs graph related <node_id> | memfs graph link <from> <type> <to> | memfs graph unlink <edge_id> | memfs graph path <from_node_id> <to_node_id>");
}

async function approvalCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  promotionId: string,
  approve: boolean
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const response = (approve
      ? await client.approvePromotion(workspaceId, promotionId, { reviewer: "human:cli", apply: true })
      : await client.rejectPromotion(workspaceId, promotionId, { reviewer: "human:cli" })) as MemoryPromotion;
    output(io, parsed, formatPromotion(response), response);
  });
}

async function snapshotCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "create") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const name = required(rest[0], "memfs snapshot create requires a name.");
      const snapshot = (await client.createSnapshot(workspaceId, name, { actor: "human:cli" })) as SnapshotRecord;
      output(io, parsed, formatSnapshot(snapshot), snapshot);
    });
  }

  if (subcommand === "list") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const snapshots = (await client.listSnapshots(workspaceId)) as SnapshotRecord[];
      output(io, parsed, snapshots.map(formatSnapshot).join("\n") || "(no snapshots)", snapshots);
    });
  }

  if (subcommand === "diff") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const snapshotId = required(rest[0], "memfs snapshot diff requires a snapshot id.");
      const diff = await client.diffSnapshot(workspaceId, snapshotId);
      output(io, parsed, JSON.stringify(diff, null, 2), diff);
    });
  }

  throw new Error("Usage: memfs snapshot create <name> | memfs snapshot list | memfs snapshot diff <snapshot_id>");
}

async function rollbackCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  snapshotId: string
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const response = await client.rollbackSnapshot(workspaceId, snapshotId, {
      dry_run: parsed.dryRun,
      actor: "human:cli"
    });
    output(io, parsed, JSON.stringify(response, null, 2), response);
  });
}

async function healthCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const health = (await client.getMemoryHealth(workspaceId)) as MemoryHealth;
    output(io, parsed, formatHealth(health), health);
  });
}

async function status(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs
): Promise<number> {
  const config = await readConfig(env);
  const workspaces = (await client.listWorkspaces()) as Workspace[];
  const selected = workspaces.find((workspace) => workspace.id === config.selectedWorkspaceId);
  const text = [
    `API: ${env.MEMFS_API_URL ?? defaultApiUrl}`,
    `Config: ${configPath(env)}`,
    `Workspace: ${selected ? `${selected.name} (${selected.id})` : "none selected"}`,
    selected ? "" : "Select one with: memfs workspace list && memfs use <workspace>"
  ]
    .filter(Boolean)
    .join("\n");
  output(io, parsed, text, {
    api_url: env.MEMFS_API_URL ?? defaultApiUrl,
    config_path: configPath(env),
    selected_workspace: selected ?? null
  });
  return 0;
}

async function workspaceCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "create") {
    const name = required(rest[0], "memfs workspace create requires a name.");
    const workspace = (await client.createWorkspace(name)) as Workspace;
    output(io, parsed, `Created workspace ${workspace.name} (${workspace.id})\nSelect it with: memfs use ${workspace.name}`, workspace);
    return 0;
  }

  if (subcommand === "list") {
    const workspaces = (await client.listWorkspaces()) as Workspace[];
    const config = await readConfig(env);
    const text =
      workspaces
        .map((workspace) => `${workspace.id === config.selectedWorkspaceId ? "*" : " "} ${workspace.name} ${workspace.id}`)
        .join("\n") || "(no workspaces)";
    output(io, parsed, text, workspaces);
    return 0;
  }

  throw new Error("Usage: memfs workspace create <name> | memfs workspace list");
}

async function useWorkspace(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  selector: string
): Promise<number> {
  const workspaces = (await client.listWorkspaces()) as Workspace[];
  const workspace = workspaces.find((entry) => entry.id === selector || entry.name === selector);
  if (!workspace) {
    throw new Error(`Workspace not found: ${selector}`);
  }

  await writeConfig(env, {
    selectedWorkspaceId: workspace.id,
    selectedWorkspaceName: workspace.name
  });
  output(io, parsed, `Using workspace ${workspace.name} (${workspace.id})`, workspace);
  return 0;
}

async function writeCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  rest: string[],
  append: boolean
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const filePath = required(rest[0], `memfs ${append ? "append" : "write"} requires a path.`);
    const content = rest.slice(1).join(" ");
    if (!content) {
      throw new Error(`memfs ${append ? "append" : "write"} requires content.`);
    }

    const nextContent = append
      ? `${await readExistingContent(client, workspaceId, filePath)}${content}`
      : content;
    const response = await client.writeFile(workspaceId, filePath, nextContent, {
      actor: "human:cli",
      ingest: parsed.ingest,
      allow_protected_write: parsed.allowProtected
    });
    output(io, parsed, `${append ? "Appended" : "Wrote"} ${filePath}`, response);
  });
}

async function readExistingContent(client: MemoryFSClient, workspaceId: string, filePath: string): Promise<string> {
  try {
    const existing = (await client.readFile(workspaceId, filePath)) as FileReadResponse;
    return existing.content ? `${existing.content}\n` : "";
  } catch {
    return "";
  }
}

async function uploadCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  args: string[]
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const localPath = required(args[0], "memfs upload requires a local file path.");
    const targetPath = optionValue(args, "--to") ?? `/uploads/${path.basename(localPath)}`;
    const bytes = await readFile(localPath);
    const response = await client.uploadFile(workspaceId, targetPath, bytes.toString("base64"), {
      actor: "human:cli",
      ingest: parsed.ingest,
      allow_protected_write: parsed.allowProtected,
      mime_type: inferMimeType(targetPath)
    });
    output(io, parsed, `Uploaded ${localPath} to ${targetPath}`, response);
  });
}

async function extractCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  filePath: string
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const response = (await client.extractFile(workspaceId, filePath, "human:cli")) as ExtractedSource;
    output(io, parsed, formatExtractedSource(response), response);
  });
}

async function extractedCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  filePath: string
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const files = (await client.listFiles(workspaceId)) as FileRecord[];
    const file = files.find((entry) => entry.path === filePath);
    if (!file) {
      throw new Error(`File not found: ${filePath}`);
    }
    const sources = (await client.readExtractedSources(workspaceId, file.id)) as ExtractedSource[];
    output(
      io,
      parsed,
      sources.map(formatExtractedSource).join("\n\n") || "(no extracted sources)",
      sources
    );
  });
}

async function memoryGrepCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  args: string[],
  commandName: "grep" | "search" | "sgrep",
  defaultMode: "literal" | "semantic" | "hybrid"
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const grep = parseGrepArgs(args, defaultMode);
    const cleaned = required(grep.query.trim(), `memfs ${commandName} requires a query.`);
    const response = (await client.grepMemory(workspaceId, cleaned, {
      mode: grep.mode,
      scope: grep.scope,
      project_slug: grep.project_slug,
      repo_path: grep.repo_path,
      session_id: grep.session_id,
      agent_id: grep.agent_id,
      contact_id: grep.contact_id,
	      run_id: grep.run_id,
	      trust_min: grep.trust_min,
	      include_runs: grep.include_runs,
	      include_sources: grep.include_sources,
	      include_stale: grep.include_stale,
	      limit: grep.limit,
	      project_hint: grep.project_hint
    })) as MemoryGrepResponse;
    output(io, parsed, formatMemoryGrep(response), response);
  });
}

async function recallCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  args: string[]
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const scoped = parseScopedQueryArgs(args);
    const cleaned = required(scoped.query.trim(), "memfs recall requires a query.");
    const response = (await client.recallMemory(workspaceId, cleaned, {
      include_detail: true,
      include_raw: false,
      scope: scoped.scope,
      project_slug: scoped.project_slug,
      repo_path: scoped.repo_path,
      session_id: scoped.session_id,
      agent_id: scoped.agent_id,
      contact_id: scoped.contact_id,
      run_id: scoped.run_id,
      include_related: scoped.include_related
    })) as RecallResponse;
    output(io, parsed, formatRecall(response), response);
  });
}

async function nodeCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined,
  rest: string[]
): Promise<number> {
  if (subcommand === "list") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const sourceFilter = optionValue(parsed.args, "--source");
      const scopeFilter = optionValue(parsed.args, "--scope");
      const projectFilter = optionValue(parsed.args, "--project");
      const runFilter = optionValue(parsed.args, "--run");
      const nodes = ((await client.listMemoryNodes(workspaceId)) as MemoryNode[]).filter((node) =>
        (sourceFilter ? node.source_path === sourceFilter : true) &&
        (scopeFilter ? node.scope === scopeFilter : true) &&
        (projectFilter ? node.project_slug === projectFilter : true) &&
        (runFilter ? node.run_id === runFilter : true)
      );
      output(
        io,
        parsed,
        nodes.map((node) => `${node.id} ${node.memory_type} scope=${node.scope ?? "workspace"} ${node.source_path}\n  ${node.summary}`).join("\n") || "(no nodes)",
        nodes
      );
    });
  }

  if (subcommand === "read") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const node = (await client.readMemoryNode(
        workspaceId,
        required(rest[0], "memfs node read requires a node id.")
      )) as MemoryNode;
      output(io, parsed, formatNode(node), node);
    });
  }

  throw new Error("Usage: memfs node list | memfs node read <node_id>");
}

async function auditCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  subcommand: string | undefined
): Promise<number> {
  if (subcommand !== "list") {
    throw new Error("Usage: memfs audit list");
  }

  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const events = (await client.listAuditEvents(workspaceId)) as AuditEvent[];
    output(
      io,
      parsed,
      events.map((event) => `${event.created_at} ${event.event_type} ${event.actor}`).join("\n") || "(no audit events)",
      events
    );
  });
}

async function withWorkspace(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  handler: (workspaceId: string) => Promise<void>
): Promise<number> {
  const config = await readConfig(env);
  if (!config.selectedWorkspaceId) {
    throw new Error("No workspace selected. Run: memfs workspace list && memfs use <workspace>");
  }

  await handler(config.selectedWorkspaceId);
  return 0;
}

function formatMemoryGrep(response: MemoryGrepResponse): string {
  return (
    response.results
      .map((result, index) => {
        const location = result.line ? `${result.path}:${result.line}` : result.path;
        const node = result.node_id ? ` node=${result.node_id}` : "";
        const raw = result.raw_ref ? `\n  raw_ref: ${result.raw_ref}` : "";
        return (
          `${index + 1}. ${location}\n` +
          `   match: ${displayMatchType(result.match_type)}\n` +
          `   trust: ${result.trust ?? "unknown"}${node}\n` +
          `   why: ${matchReason(result.match_type)}\n` +
          `   snippet: ${result.snippet}\n` +
          `   source: ${result.source_path}${raw}`
        );
      })
      .join("\n\n") || "(no results)"
  );
}

function displayMatchType(matchType: string): string {
  if (matchType === "literal" || matchType === "extracted" || matchType === "archive") return "exact";
  if (matchType === "lexical") return "lexical";
  if (matchType === "memory" || matchType === "run" || matchType === "handoff") return "memory";
  return "semantic";
}

function matchReason(matchType: string): string {
  switch (matchType) {
    case "literal":
      return "exact text match in source file";
    case "lexical":
      return "related words matched in source file";
    case "extracted":
      return "match in extracted source text";
    case "archive":
      return "exact text match in archived source";
    case "run":
      return "semantic match in run memory";
    case "handoff":
      return "semantic match in handoff memory";
    case "memory":
      return "semantic match in memory index";
    default:
      return "semantic memory search match";
  }
}

function formatRecall(response: RecallResponse): string {
  const header = `Recall: ${response.query}`;
  const body = response.results
    .map(
      (result, index) =>
        `${index + 1}. ${result.summary}\n` +
        `   when: ${result.trigger}\n` +
        `   source: ${result.source_path}\n` +
        `   raw_ref: ${result.raw_ref}\n` +
        `   score: ${result.score.toFixed(2)} type=${result.memory_type} importance=${result.importance}` +
        `${result.detail ? `\n   detail: ${result.detail}` : ""}`
    )
    .join("\n\n");
  return `${header}\n\n${body || "(no results)"}`;
}

function formatNode(node: MemoryNode): string {
  return [
    `${node.id} ${node.memory_type} importance=${node.importance} confidence=${node.confidence}`,
    `summary: ${node.summary}`,
    `trigger: ${node.trigger}`,
	    node.detail ? `detail: ${node.detail}` : "",
	    `status: ${node.status ?? "unknown"} trust=${node.trust_level ?? "unknown"}`,
	    node.stale_reason ? `stale_reason: ${node.stale_reason}` : "",
	    node.valid_from ? `valid_from: ${node.valid_from}` : "",
	    node.valid_until ? `valid_until: ${node.valid_until}` : "",
	    node.last_confirmed_at ? `last_confirmed_at: ${node.last_confirmed_at}` : "",
	    node.last_used_at ? `last_used_at: ${node.last_used_at}` : "",
	    node.supersedes?.length ? `supersedes: ${node.supersedes.join(", ")}` : "",
	    node.superseded_by?.length ? `superseded_by: ${node.superseded_by.join(", ")}` : "",
	    `source: ${node.source_path}`,
    `raw_ref: ${node.raw_ref}`,
    `tags: ${node.tags.join(", ")}`
  ]
    .filter(Boolean)
    .join("\n");
}

function formatGraphNode(response: MemoryGraphNodeResponse): string {
  const edges = response.edges.map((edge) => `  ${formatGraphEdge(edge)}`).join("\n");
  return [
    formatNode(response.node),
    "edges:",
    edges || "  (none)"
  ].join("\n");
}

function formatGraphEdge(edge: MemoryGraphEdge): string {
  const direction = edge.direction ? ` ${edge.direction}` : "";
  const source = edge.source_ref ? ` source_ref=${edge.source_ref}` : "";
  const reason = edge.reason ? `\n    reason: ${edge.reason}` : "";
  return (
    `${edge.id} ${edge.edge_kind}${direction} ${edge.from_type}:${edge.from_id} -[${edge.relation_type} ${edge.confidence.toFixed(2)}]-> ${edge.to_type}:${edge.to_id}${source}` +
    `${edge.from_source_path || edge.to_source_path ? `\n    sources: ${edge.from_source_path ?? "?"} -> ${edge.to_source_path ?? "?"}` : ""}` +
    reason
  );
}

function formatRelatedMemory(result: RelatedMemoryResult): string {
  const path = result.path.map((edge) => edge.relation_type).join(" -> ");
  return [
    `${result.node.id} depth=${result.depth} score=${result.score.toFixed(2)} ${result.node.memory_type}`,
    `  ${result.node.summary}`,
    `  source: ${result.node.source_path}`,
    `  raw_ref: ${result.node.raw_ref}`,
    path ? `  path: ${path}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatGraphPath(response: RelationshipPathResponse): string {
  return [
    response.found ? "Relationship path found" : "No relationship path found",
    `from: ${response.from_node.id} ${response.from_node.summary}`,
    `to: ${response.to_node.id} ${response.to_node.summary}`,
    `explanation: ${response.explanation}`,
    ...response.path.map((edge) => `  ${formatGraphEdge(edge)}`)
  ].join("\n");
}

function formatPromotion(promotion: MemoryPromotion): string {
  return [
    `${promotion.id} ${promotion.status}`,
    `  ${promotion.source_path} -> ${promotion.target_path}`,
    promotion.candidate_node_id ? `  candidate: ${promotion.candidate_node_id}` : "",
    promotion.reviewer ? `  reviewer: ${promotion.reviewer}` : "",
    promotion.reason ? `  reason: ${promotion.reason}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCandidate(candidate: MemoryCandidate): string {
  const source = candidate.source_refs[0];
  return [
    `${candidate.id} ${candidate.status} type=${candidate.type} confidence=${candidate.confidence}`,
    `  memory: ${candidate.node.summary}`,
    source ? `  source: ${source.source_path}` : "",
    source?.raw_ref ? `  raw_ref: ${source.raw_ref}` : "",
    candidate.promotion_target_path ? `  target: ${candidate.promotion_target_path}` : "",
    candidate.promotion_id ? `  promotion: ${candidate.promotion_id}` : "",
    candidate.duplicate_of ? `  duplicate_of: ${candidate.duplicate_of}` : "",
    candidate.conflicts_with.length ? `  conflicts_with: ${candidate.conflicts_with.join(", ")}` : "",
    candidate.conflict_reason ? `  conflict_reason: ${candidate.conflict_reason}` : "",
	    candidate.reviewed_by ? `  reviewed_by: ${candidate.reviewed_by}` : "",
	    candidate.risk_flags.length ? `  risk: ${candidate.risk_flags.join(", ")}` : "",
	    candidate.node.stale_reason ? `  stale_reason: ${candidate.node.stale_reason}` : "",
	    candidate.node.valid_until ? `  valid_until: ${candidate.node.valid_until}` : "",
	    candidate.reason ? `  reason: ${candidate.reason}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSnapshot(snapshot: SnapshotRecord): string {
  return `${snapshot.id} ${snapshot.name} ${snapshot.created_at}`;
}

function formatHealth(health: MemoryHealth): string {
  return [
    `Memory health: ${health.overall_score}/100`,
    `source coverage: ${health.source_coverage}%`,
    `contradictions: ${health.contradiction_count}`,
    `pending promotions: ${health.unresolved_promotion_count}`,
    `orphans: ${health.orphan_node_count}`,
    `raw missing: ${health.raw_missing_count}`,
	    `low confidence: ${health.low_confidence_count}`,
	    `rejected: ${health.rejected_node_count}`,
	    `stale: ${health.stale_node_count}`,
	    `old: ${health.old_node_count ?? 0}`,
	    `unconfirmed: ${health.unconfirmed_node_count ?? 0}`,
	    `superseded: ${health.superseded_node_count ?? 0}`,
	    `conflicted: ${health.conflicted_node_count ?? 0}`
	  ].join("\n");
}

function formatSyncStatus(status: SyncStatus): string {
  return [
    `Sync: ${status.enabled ? "enabled" : "disabled"} (${status.mode})`,
    `pending events: ${status.pending_events}`,
    `unresolved conflicts: ${status.unresolved_conflicts}`,
    `object storage: ${status.object_storage.configured ? status.object_storage.bucket : "local blobs"}`
  ].join("\n");
}

function formatConflict(conflict: ConflictRecord): string {
  return [
    `${conflict.id} ${conflict.status}`,
    `  ${conflict.object_type}/${conflict.object_id}`,
    `  type: ${conflict.conflict_type}`,
    `  created: ${conflict.created_at}`
  ].join("\n");
}

function formatTeamMember(member: TeamMember): string {
  return `${member.handle} ${member.role}${member.display_name ? ` (${member.display_name})` : ""}`;
}

function formatMountStatus(entries: MountRegistryEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${entry.mountpoint} ${entry.mode} ${entry.workspaceName ?? entry.workspaceId}\n` +
        `  pid: ${entry.pid}\n` +
        `  actor: ${entry.actor}\n` +
        `  api: ${entry.apiUrl}\n` +
        `  started: ${entry.startedAt}`
    )
    .join("\n\n") || "(no active MemFS mounts)";
}

function formatExtractedSource(source: ExtractedSource): string {
  const metadata = JSON.parse(source.metadata_json) as {
    unsupported?: boolean;
    reason?: string;
    sections?: Array<{ sourceLocation?: Record<string, unknown> | null }>;
  };
  const locations = (metadata.sections ?? [])
    .map((section) => compactSourceLocation(section.sourceLocation))
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
  return [
    `${source.extractor_name}@${source.extractor_version} ${source.created_at}`,
    `sections: ${Array.isArray(metadata.sections) ? metadata.sections.length : 0}`,
    locations ? `locations: ${locations}` : "",
    metadata.unsupported ? `unsupported: ${metadata.reason ?? "Unsupported file type."}` : "",
    source.content_text ? source.content_text.slice(0, 800) : "(no extracted text)"
  ]
    .filter(Boolean)
    .join("\n");
}

function compactSourceLocation(location: Record<string, unknown> | null | undefined): string {
  if (!location) return "";
  const type = typeof location.type === "string" ? `${location.type}:` : "";
  const fields = Object.entries(location)
    .filter(([key]) => key !== "type")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return `${type}${fields}`;
}

function formatRun(run: AgentRun): string {
  return `${run.id} ${run.status} ${run.title}\n  ${run.run_path}`;
}

function formatReasoningLesson(lesson: ReasoningMemoryCandidate): string {
  return [
    `${lesson.id} ${lesson.status} confidence=${lesson.confidence}`,
    `  title: ${lesson.title}`,
    `  trigger: ${lesson.trigger}`,
    `  strategy: ${lesson.strategy}`,
    `  source_run: ${lesson.source_run}`,
    lesson.source_refs.length ? `  source_refs: ${lesson.source_refs.map((ref) => ref.path).join(", ")}` : "",
    lesson.reason ? `  reason: ${lesson.reason}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatArchiveEntry(entry: ArchiveEntry): string {
  return `${entry.id} ${entry.archive_type} ${entry.title}\n  ${entry.path}\n  raw_ref: ${entry.raw_ref}`;
}

function formatArchiveExtract(response: ArchiveExtractResponse): string {
  return [
    response.summary,
    `archive: ${response.archive.path}`,
    ...response.candidate_nodes.map((node) =>
      `${node.id} ${node.memory_type} status=${node.status} trust=${node.trust_level}\n  ${node.summary}\n  raw_ref: ${node.raw_ref}`
    )
  ].join("\n");
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: string[] = [];
  let json = false;
  let allowProtected = false;
  let ingest = true;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg === "--allow-protected" || arg === "--allow-protected-write") allowProtected = true;
    else if (arg === "--no-ingest") ingest = false;
    else if (arg === "--ingest") ingest = true;
    else if (arg === "--dry-run") dryRun = true;
    else args.push(arg);
  }

  return { args, json, allowProtected, ingest, dryRun };
}

function parseGrepArgs(args: string[], defaultMode: "literal" | "semantic" | "hybrid" = "literal"): {
  query: string;
  mode: "literal" | "semantic" | "hybrid";
  scope?: string[];
  project_slug?: string;
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
} {
  const scoped = parseScopedQueryArgs(args);
  let mode: "literal" | "semantic" | "hybrid" = defaultMode;
  let trustMin: string | undefined;
  let includeRuns: boolean | undefined;
  let includeSources: boolean | undefined;
  let includeStale: boolean | undefined;
  let limit: number | undefined;

  for (let index = 0; index < scoped.remainingFlags.length; index += 1) {
    const arg = scoped.remainingFlags[index]!;
    if (arg === "--literal" || arg === "-F") {
      mode = "literal";
    } else if (arg === "--semantic") {
      mode = "semantic";
    } else if (arg === "--hybrid") {
      mode = "hybrid";
    } else if (arg === "--trusted-only") {
      trustMin = "reviewed";
    } else if (arg === "--trust-min") {
      trustMin = scoped.remainingFlags[++index];
    } else if (arg === "--include-runs") {
      includeRuns = true;
    } else if (arg === "--no-runs") {
      includeRuns = false;
    } else if (arg === "--include-sources") {
      includeSources = true;
    } else if (arg === "--no-sources") {
      includeSources = false;
    } else if (arg === "--include-stale") {
      includeStale = true;
    } else if (arg === "--limit") {
      const value = Number(scoped.remainingFlags[++index]);
      if (Number.isFinite(value)) limit = value;
    }
  }

  return {
    query: scoped.query,
    mode,
    scope: scoped.scope,
    project_slug: scoped.project_slug,
    repo_path: scoped.repo_path,
    session_id: scoped.session_id,
    agent_id: scoped.agent_id,
    contact_id: scoped.contact_id,
    run_id: scoped.run_id,
    trust_min: trustMin,
    include_runs: includeRuns,
    include_sources: includeSources,
    include_stale: includeStale,
    limit,
    project_hint: scoped.project_slug
  };
}

function parseScopedQueryArgs(args: string[]): {
  query: string;
  scope?: string[];
  project_slug?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
  include_related?: boolean;
  remainingFlags: string[];
} {
  const queryParts: string[] = [];
  const scope: string[] = [];
  const remainingFlags: string[] = [];
  let projectSlug: string | undefined;
  let repoPath: string | undefined;
  let sessionId: string | undefined;
  let agentId: string | undefined;
  let contactId: string | undefined;
  let runId: string | undefined;
  let includeRelated = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--scope") {
      const value = args[++index];
      if (value) scope.push(...value.split(",").map((entry) => entry.trim()).filter(Boolean));
    } else if (arg === "--project") {
      projectSlug = args[++index];
    } else if (arg === "--repo") {
      repoPath = args[++index];
    } else if (arg === "--session") {
      sessionId = args[++index];
    } else if (arg === "--agent") {
      agentId = args[++index];
    } else if (arg === "--contact") {
      contactId = args[++index];
    } else if (arg === "--run") {
      runId = args[++index];
    } else if (arg === "--include-related") {
      includeRelated = true;
    } else if (arg.startsWith("--") || arg === "-F") {
      remainingFlags.push(arg);
      if (["--trust-min", "--limit"].includes(arg) && args[index + 1]) {
        remainingFlags.push(args[++index]!);
      }
    } else {
      queryParts.push(arg);
    }
  }

  return {
    query: queryParts.join(" "),
    scope: scope.length ? scope : runId ? ["run"] : undefined,
    project_slug: projectSlug,
    repo_path: repoPath,
    session_id: sessionId,
    agent_id: agentId,
    contact_id: contactId,
    run_id: runId,
    include_related: includeRelated || undefined,
    remainingFlags
  };
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function candidateListOptions(args: string[]): Record<string, unknown> {
  return compactObject({
    status: optionValue(args, "--status"),
    duplicates: args.includes("--duplicates") ? true : undefined,
    conflicts: args.includes("--conflicts") ? true : undefined,
    scope: optionValue(args, "--scope"),
    project_slug: optionValue(args, "--project") ?? optionValue(args, "--project-slug"),
    repo_path: optionValue(args, "--repo") ?? optionValue(args, "--repo-path"),
    session_id: optionValue(args, "--session"),
    agent_id: optionValue(args, "--agent"),
    contact_id: optionValue(args, "--contact"),
    run_id: optionValue(args, "--run")
  });
}

function graphRelatedOptions(args: string[]): {
  depth?: number;
  limit?: number;
  relation_types?: string[];
  include_stale?: boolean;
} {
  const depth = optionValue(args, "--depth");
  const limit = optionValue(args, "--limit");
  const relationTypes = optionValue(args, "--relation-types")?.split(",").map((entry) => entry.trim()).filter(Boolean);
  return {
    ...(depth ? { depth: Number(depth) } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
    ...(relationTypes?.length ? { relation_types: relationTypes } : {}),
    ...(args.includes("--include-stale") ? { include_stale: true } : {})
  };
}

function candidateEditBody(args: string[]): Record<string, unknown> {
  const confidence = optionValue(args, "--confidence");
  const tags = optionValue(args, "--tags");
  return compactObject({
    actor: "human:cli",
    summary: optionValue(args, "--summary"),
    trigger: optionValue(args, "--trigger"),
    detail: optionValue(args, "--detail"),
    memory_text: optionValue(args, "--memory"),
    memory_type: optionValue(args, "--type"),
    confidence: confidence ? Number(confidence) : undefined,
    tags: tags ? tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined,
    status: optionValue(args, "--status"),
    target_path: optionValue(args, "--target") ?? optionValue(args, "--to"),
    reason: optionValue(args, "--reason")
  });
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function parseBriefArgs(args: string[]): {
  task: string;
  scope?: string[];
  project_slug?: string;
  repo_path?: string;
  session_id?: string;
  agent_id?: string;
  contact_id?: string;
  run_id?: string;
  files?: string[];
  include_candidates?: boolean;
  create_run?: boolean;
  limit?: number;
} {
  const taskParts: string[] = [];
  const scope: string[] = [];
  const files: string[] = [];
  let projectSlug: string | undefined;
  let repoPath: string | undefined;
  let sessionId: string | undefined;
  let agentId: string | undefined;
  let contactId: string | undefined;
  let runId: string | undefined;
  let includeCandidates = false;
  let createRun = false;
  let limit: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--include-candidates") {
      includeCandidates = true;
    } else if (arg === "--run") {
      createRun = true;
    } else if (arg === "--scope") {
      const value = args[++index];
      if (value) scope.push(value);
    } else if (arg === "--project" || arg === "--project-slug") {
      projectSlug = args[++index];
      if (!scope.includes("project")) scope.push("project");
    } else if (arg === "--repo" || arg === "--repo-path") {
      repoPath = args[++index];
      if (!scope.includes("repo")) scope.push("repo");
    } else if (arg === "--session") {
      sessionId = args[++index];
      if (!scope.includes("session")) scope.push("session");
    } else if (arg === "--agent") {
      agentId = args[++index];
      if (!scope.includes("agent")) scope.push("agent");
    } else if (arg === "--contact") {
      contactId = args[++index];
      if (!scope.includes("contact")) scope.push("contact");
    } else if (arg === "--run-id") {
      runId = args[++index];
      if (!scope.includes("run")) scope.push("run");
    } else if (arg === "--file") {
      const value = args[++index];
      if (value) files.push(value);
    } else if (arg === "--limit") {
      const value = args[++index];
      limit = value ? Number(value) : undefined;
    } else {
      taskParts.push(arg);
    }
  }

  return {
    task: taskParts.join(" "),
    scope: scope.length > 0 ? scope : undefined,
    project_slug: projectSlug,
    repo_path: repoPath,
    session_id: sessionId,
    agent_id: agentId,
    contact_id: contactId,
    run_id: runId,
    files: files.length > 0 ? files : undefined,
    include_candidates: includeCandidates || undefined,
    create_run: createRun || undefined,
    limit
  };
}

async function readConfig(env: NodeJS.ProcessEnv): Promise<CliConfig> {
  try {
    return JSON.parse(await readFile(configPath(env), "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

async function writeConfig(env: NodeJS.ProcessEnv, config: CliConfig): Promise<void> {
  await mkdir(configDir(env), { recursive: true });
  await writeFile(configPath(env), `${JSON.stringify(config, null, 2)}\n`);
}

function configDir(env: NodeJS.ProcessEnv): string {
  return env.MEMFS_CONFIG_DIR ?? path.join(env.HOME ?? homedir(), ".memfs");
}

function configPath(env: NodeJS.ProcessEnv): string {
  return path.join(configDir(env), "config.json");
}

function output(io: CliIo, parsed: ParsedArgs, text: string, jsonValue: unknown): void {
  io.stdout(parsed.json ? JSON.stringify(jsonValue, null, 2) : text);
}

function required(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

function inferMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
    case "markdown":
      return "text/markdown";
    case "txt":
    case "log":
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
    default:
      return "application/octet-stream";
  }
}

function helpText(): string {
  return `memfs commands:
  memfs init
  memfs status
  memfs workspace create <name>
  memfs workspace list
  memfs use <workspace>
  memfs ls [path]
  memfs cat <path>
  memfs write <path> <content>
  memfs append <path> <content>
  memfs rm <path>
  memfs upload <local_path> [--to <memfs_path>]
  memfs extract <path>
  memfs extracted <path>
  memfs grep [--literal|-F] [--scope <scope>] [--project <slug>] [--trusted-only] [--include-runs] [--include-stale] [--json] <query>
  memfs search [--semantic|--hybrid] [--scope <scope>] [--project <slug>] [--trusted-only] [--include-runs] [--include-stale] [--json] <query>
  memfs recall <query> [--scope <scope>] [--include-related]
  memfs node list [--scope <scope>]
  memfs node read <node_id>
  memfs nodes --source <path>
  memfs raw <node_id>
  memfs audit list
  memfs promote <source_path> --to <target_path>
  memfs promotions
	  memfs candidates [--status <status>] [--duplicates] [--conflicts] [--scope <scope>]
	  memfs candidate show <candidate_id>
	  memfs candidate edit <candidate_id>
	  memfs candidate approve <candidate_id> [--target <path>]
	  memfs candidate reject <candidate_id>
	  memfs candidate resolve-conflict <candidate_id> --mode keep_new|keep_old|keep_both|mark_superseded
	  memfs memory mark-stale <node_id> --reason <text>
	  memfs memory confirm <node_id>
	  memfs memory supersede <old_node_id> <new_node_id>
  memfs graph node <node_id>
  memfs graph related <node_id>
  memfs graph link <from_node_id> <relation_type> <to_node_id>
  memfs graph unlink <edge_id>
  memfs graph path <from_node_id> <to_node_id>
  memfs approve <promotion_id>
  memfs reject <promotion_id>
  memfs snapshot create <name>
  memfs snapshot list
  memfs snapshot diff <snapshot_id>
  memfs rollback <snapshot_id> --dry-run
  memfs health
  memfs brief "<task>" [--project <slug>] [--include-candidates] [--json]
  memfs run create "<task>"
  memfs run complete <run_id>
  memfs run compile <run_id> [--reasoning]
  memfs run lessons <run_id>
  memfs runs
  memfs run show <run_id>
  memfs run path <run_id>
  memfs run today
  memfs archive add <local_path> --type conversation --title <title>
  memfs archive list
  memfs archive show <archive_id>
  memfs archive extract <archive_id>
  memfs archive search <query>
  memfs handoff --project <name>
  memfs stale
  memfs mount <workspace> <mountpoint> [--read-only|--read-write]
  memfs mount status
  memfs unmount <mountpoint>
  memfs sync status
  memfs sync pull
  memfs sync push
  memfs sync conflicts
  memfs sync resolve <conflict_id> --mode keep_local|keep_remote|keep_both
  memfs team members
  memfs team invite <handle> --role viewer|agent|editor|admin|owner
  memfs team role set <handle> <role>

Flags: --json, --no-ingest, --allow-protected, --dry-run
Mount flags: --read-only, --read-write, --ingest-on-write, --allow-protected-write, --trust-level <level>, --default-run-folder <path>, --actor <actor>, --create-mountpoint, --allow-non-empty, --daemon`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const code = await runCli(process.argv.slice(2));
  process.exitCode = code;
}
