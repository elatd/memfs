#!/usr/bin/env node
import { MemoryFSClient } from "@memoryfs/sdk";
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
        return await memorySearch(client, env, io, parsed, [subcommand, ...rest].filter(isString).join(" "), false);
      case "sgrep":
        return await memorySearch(client, env, io, parsed, [subcommand, ...rest].filter(isString).join(" "), true);
      case "recall":
        return await recallCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString).join(" "));
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
        return await briefCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString).join(" "));
      case "run":
        return await runCommand(client, env, io, parsed, subcommand, rest);
      case "runs":
        return await runsCommand(client, env, io, parsed);
      case "handoff":
        return await handoffCommand(client, env, io, parsed, [subcommand, ...rest].filter(isString));
      case "stale":
        return await staleCommand(client, env, io, parsed);
      case "sync":
        return await syncCommand(client, env, io, parsed, subcommand, rest);
      case "team":
        return await teamCommand(client, env, io, parsed, subcommand, rest);
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

async function briefCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  task: string
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const cleaned = required(task.trim(), "memfs brief requires a task.");
    const response = (await client.createBrief(workspaceId, cleaned, {
      actor: "human:cli",
      project_hint: optionValue(parsed.args, "--project"),
      create_run: parsed.args.includes("--run")
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
      const response = await client.compileRun(workspaceId, runId, { actor: "human:cli" });
      output(io, parsed, JSON.stringify(response, null, 2), response);
    });
  }

  if (subcommand === "show") {
    return withWorkspace(client, env, io, parsed, async (workspaceId) => {
      const runId = required(rest[0], "memfs run show requires a run id.");
      const response = await client.readRun(workspaceId, runId);
      output(io, parsed, JSON.stringify(response, null, 2), response);
    });
  }

  throw new Error("Usage: memfs run create <task> | memfs run complete <run_id> | memfs run compile <run_id> | memfs run show <run_id>");
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

async function memorySearch(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  query: string,
  semantic: boolean
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const cleaned = required(query.trim(), `memfs ${semantic ? "sgrep" : "grep"} requires a query.`);
    const response = (semantic
      ? await client.recallMemory(workspaceId, cleaned, { include_detail: true, include_raw: false })
      : await client.searchMemory(workspaceId, cleaned, { include_detail: true, include_raw: false })) as RecallResponse;
    const literal_matches = semantic ? [] : await literalMatches(client, workspaceId, cleaned);
    output(
      io,
      parsed,
      semantic ? formatSearchResults(response.results) : formatGrepResults(literal_matches, response.results),
      semantic ? response : { ...response, literal_matches }
    );
  });
}

async function recallCommand(
  client: MemoryFSClient,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  parsed: ParsedArgs,
  query: string
): Promise<number> {
  return withWorkspace(client, env, io, parsed, async (workspaceId) => {
    const cleaned = required(query.trim(), "memfs recall requires a query.");
    const response = (await client.recallMemory(workspaceId, cleaned, {
      include_detail: true,
      include_raw: false
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
      const nodes = ((await client.listMemoryNodes(workspaceId)) as MemoryNode[]).filter((node) =>
        sourceFilter ? node.source_path === sourceFilter : true
      );
      output(
        io,
        parsed,
        nodes.map((node) => `${node.id} ${node.memory_type} ${node.source_path}\n  ${node.summary}`).join("\n") || "(no nodes)",
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

function formatSearchResults(results: RecallResult[]): string {
  return (
    results
      .map(
        (result) =>
          `${result.source_path} [${result.score.toFixed(2)}] ${result.memory_type} importance=${result.importance}\n` +
          `  ${result.summary}\n` +
          `  trigger: ${result.trigger}\n` +
          `  raw_ref: ${result.raw_ref}`
      )
      .join("\n\n") || "(no results)"
  );
}

function formatGrepResults(literalMatches: Array<{ path: string; line: number; text: string }>, results: RecallResult[]): string {
  const literalText = literalMatches.map((match) => `${match.path}:${match.line}:${match.text}`).join("\n");
  const memoryText = formatSearchResults(results);
  return [literalText, memoryText === "(no results)" ? "" : memoryText].filter(Boolean).join("\n\n") || "(no results)";
}

async function literalMatches(
  client: MemoryFSClient,
  workspaceId: string,
  query: string
): Promise<Array<{ path: string; line: number; text: string }>> {
  const files = (await client.listFiles(workspaceId)) as FileRecord[];
  const matches: Array<{ path: string; line: number; text: string }> = [];
  for (const file of files) {
    if (file.path.toLowerCase().includes(query.toLowerCase())) {
      matches.push({ path: file.path, line: 0, text: "(path match)" });
    }
    const read = (await client.readFile(workspaceId, file.path)) as FileReadResponse;
    read.content.split(/\n/).forEach((line, index) => {
      if (line.toLowerCase().includes(query.toLowerCase())) {
        matches.push({ path: file.path, line: index + 1, text: line });
      }
    });
  }
  return matches;
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
    `source: ${node.source_path}`,
    `raw_ref: ${node.raw_ref}`,
    `tags: ${node.tags.join(", ")}`
  ]
    .filter(Boolean)
    .join("\n");
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
    `stale: ${health.stale_node_count}`
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

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
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
  memfs grep <query>
  memfs sgrep <query>
  memfs recall <query>
  memfs node list
  memfs node read <node_id>
  memfs nodes --source <path>
  memfs raw <node_id>
  memfs audit list
  memfs promote <source_path> --to <target_path>
  memfs promotions
  memfs approve <promotion_id>
  memfs reject <promotion_id>
  memfs snapshot create <name>
  memfs snapshot list
  memfs snapshot diff <snapshot_id>
  memfs rollback <snapshot_id> --dry-run
  memfs health
  memfs brief "<task>"
  memfs run create "<task>"
  memfs run complete <run_id>
  memfs run compile <run_id>
  memfs runs
  memfs run show <run_id>
  memfs handoff --project <name>
  memfs stale
  memfs sync status
  memfs sync pull
  memfs sync push
  memfs sync conflicts
  memfs sync resolve <conflict_id> --mode keep_local|keep_remote|keep_both
  memfs team members
  memfs team invite <handle> --role viewer|agent|editor|admin|owner
  memfs team role set <handle> <role>

Flags: --json, --no-ingest, --allow-protected, --dry-run`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const code = await runCli(process.argv.slice(2));
  process.exitCode = code;
}
