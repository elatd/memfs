import {
  MemoryFS,
  normalizeMemoryPath,
  type AgentRun,
  type BriefResponse,
  type CompileRunResponse,
  type MemoryHealthReport,
  type MemoryGrepResponse,
  type MemoryPromotion,
  type RecallResponse,
  type SyncStatus
} from "@memoryfs/core";

export interface MemoryFsShellOptions {
  memoryfs: MemoryFS;
  workspaceId: string;
  actor?: string;
  ingestWrites?: boolean;
  allowProtectedWrite?: boolean;
}

export interface ShellExecResult<T = unknown> {
  ok: true;
  command: string;
  data: T;
  displayText: string;
}

export interface VirtualBashOptions {
  actor?: string;
  ingestWrites?: boolean;
  allowProtectedWrite?: boolean;
}

export class MemoryFsShell {
  constructor(private readonly options: MemoryFsShellOptions) {}

  async exec(command: string): Promise<ShellExecResult> {
    const trimmed = command.trim();
    if (!trimmed) {
      return result(command, null, "");
    }

    rejectInjection(trimmed);
    const [commandName, ...args] = splitArgs(trimmed);

    switch (commandName) {
      case "ls":
        return this.ls(args[0] ?? "/");
      case "cat":
        return this.cat(requiredArg(args[0], "cat requires a path."));
      case "write":
        return this.write(requiredArg(args[0], "write requires a path."), requiredArg(args[1], "write requires content."));
      case "append":
        return this.append(requiredArg(args[0], "append requires a path."), requiredArg(args[1], "append requires content."));
      case "rm":
        return this.rm(requiredArg(args[0], "rm requires a path."));
      case "mkdir":
        return this.mkdir(requiredArg(args[0], "mkdir requires a path."));
      case "grep":
        return this.grep(args);
      case "search":
        return this.search(args);
      case "sgrep":
        return this.sgrep(args);
      case "recall":
        return this.recall(requiredArg(args[0], "recall requires a query."));
      case "brief":
        return this.brief(args.join(" "));
      case "run":
        return this.run(args);
      case "node":
        return this.node(args);
      case "raw":
        return this.raw(requiredArg(args[0], "raw requires a node id."));
      case "promote":
        return this.promote(args);
      case "health":
        return this.health();
      case "sync":
        return this.sync(args);
      case "status":
        return this.status();
      default:
        throw new Error(`Unsupported virtual-bash command: ${commandName}`);
    }
  }

  private ls(prefix: string): ShellExecResult {
    const normalizedPrefix = normalizeMemoryPath(prefix);
    const files = this.options.memoryfs
      .listFiles(this.options.workspaceId)
      .filter(
        (file) =>
          normalizedPrefix === "/" ||
          file.path === normalizedPrefix ||
          file.path.startsWith(`${normalizedPrefix.replace(/\/$/, "")}/`)
      );
    return result("ls", files, files.map((file) => file.path).join("\n") || "(no files)");
  }

  private async cat(filePath: string): Promise<ShellExecResult> {
    const normalizedPath = normalizeMemoryPath(filePath);
    const file = await this.options.memoryfs.readFile(this.options.workspaceId, normalizedPath);
    return result("cat", file, file.content);
  }

  private async write(filePath: string, content: string): Promise<ShellExecResult> {
    const normalizedPath = normalizeMemoryPath(filePath);
    const file = await this.options.memoryfs.writeFile(this.options.workspaceId, normalizedPath, content, {
      actor: this.options.actor ?? "agent:virtual-bash",
      ingest: this.options.ingestWrites ?? true,
      allow_protected_write: this.options.allowProtectedWrite ?? false
    });
    return result("write", file, `Wrote ${file.path}`);
  }

  private async append(filePath: string, content: string): Promise<ShellExecResult> {
    const normalizedPath = normalizeMemoryPath(filePath);
    let existing = "";
    try {
      existing = (await this.options.memoryfs.readFile(this.options.workspaceId, normalizedPath)).content;
    } catch {
      existing = "";
    }

    const next = existing ? `${existing}\n${content}` : content;
    const file = await this.options.memoryfs.writeFile(this.options.workspaceId, normalizedPath, next, {
      actor: this.options.actor ?? "agent:virtual-bash",
      ingest: this.options.ingestWrites ?? true,
      allow_protected_write: this.options.allowProtectedWrite ?? false
    });
    return result("append", file, `Appended ${file.path}`);
  }

  private async rm(filePath: string): Promise<ShellExecResult> {
    const normalizedPath = normalizeMemoryPath(filePath);
    await this.options.memoryfs.deleteFile(this.options.workspaceId, normalizedPath, {
      actor: this.options.actor ?? "agent:virtual-bash",
      allow_protected_write: this.options.allowProtectedWrite ?? false
    });
    return result("rm", { path: normalizedPath }, `Deleted ${normalizedPath}`);
  }

  private mkdir(filePath: string): ShellExecResult {
    const normalizedPath = normalizeMemoryPath(filePath);
    return result("mkdir", { path: normalizedPath }, `Directory marker accepted for ${normalizedPath}`);
  }

  private async grep(args: string[]): Promise<ShellExecResult<MemoryGrepResponse>> {
    const parsed = parseGrepArgs(args, "literal");
    const query = requiredArg(parsed.query.trim(), "grep requires a query.");
    const search = await this.options.memoryfs.grepMemory(this.options.workspaceId, query, {
      mode: parsed.mode,
      trust_min: parsed.trust_min,
	      scope: parsed.scope,
	      include_runs: parsed.include_runs,
	      include_sources: parsed.include_sources,
	      include_stale: parsed.include_stale,
	      limit: parsed.limit
    });
    return result("grep", search, formatGrep(search));
  }

  private async search(args: string[]): Promise<ShellExecResult<MemoryGrepResponse>> {
    const parsed = parseGrepArgs(args, "hybrid");
    const query = requiredArg(parsed.query.trim(), "search requires a query.");
    const search = await this.options.memoryfs.grepMemory(this.options.workspaceId, query, {
      mode: parsed.mode,
      trust_min: parsed.trust_min,
      scope: parsed.scope,
      include_runs: parsed.include_runs,
      include_sources: parsed.include_sources,
      include_stale: parsed.include_stale,
      limit: parsed.limit
    });
    return result("search", search, formatGrep(search));
  }

  private async sgrep(args: string[]): Promise<ShellExecResult<MemoryGrepResponse>> {
    const search = await this.search(["--semantic", ...args]);
    return result("sgrep", search.data, search.displayText);
  }

  private async recall(query: string): Promise<ShellExecResult<RecallResponse>> {
    const recall = await this.options.memoryfs.recallMemory(this.options.workspaceId, query, {
      include_detail: true,
      include_raw: false,
      limit: 8
    });
    return result(
      "recall",
      recall,
      recall.results
        .map(
          (item, index) =>
            `${index + 1}. ${item.summary}\n` +
            `   trigger: ${item.trigger}\n` +
            `   source: ${item.source_path}\n` +
            `   raw_ref: ${item.raw_ref}`
        )
        .join("\n") || "(no results)"
    );
  }

  private async brief(task: string): Promise<ShellExecResult<BriefResponse>> {
    const cleaned = requiredArg(task.trim(), "brief requires a task.");
    const brief = await this.options.memoryfs.createBrief(this.options.workspaceId, {
      task: cleaned,
      actor: this.options.actor ?? "agent:virtual-bash",
      mode: "task_preparation",
      include_recent_runs: true,
      include_open_questions: true,
      include_contradictions: true
    });
    return result("brief", brief, brief.brief_markdown);
  }

  private async run(args: string[]): Promise<ShellExecResult> {
    const subcommand = args[0];
    const actor = this.options.actor ?? "agent:virtual-bash";

    if (subcommand === "create") {
      const task = requiredArg(args.slice(1).join(" ").trim(), "run create requires a task.");
      const run = await this.options.memoryfs.createRun(this.options.workspaceId, { task, actor });
      return result("run", run, formatRun(run));
    }

    if (subcommand === "complete") {
      const runId = requiredArg(args[1], "run complete requires a run id.");
      const resultText = args.slice(2).join(" ").trim();
      const run = await this.options.memoryfs.completeRun(this.options.workspaceId, runId, {
        actor,
        result: resultText || undefined
      });
      return result("run", run, formatRun(run));
    }

    if (subcommand === "compile") {
      const runId = requiredArg(args[1], "run compile requires a run id.");
      const compiled = await this.options.memoryfs.compileRun(this.options.workspaceId, runId, {
        actor,
        reasoning: args.includes("--reasoning")
      });
      return result("run", compiled, formatCompileRun(compiled));
    }

    if (subcommand === "show") {
      const runId = requiredArg(args[1], "run show requires a run id.");
      const run = this.options.memoryfs.getRun(this.options.workspaceId, runId);
      return result("run", run, formatRun(run));
    }

    if (subcommand === "list") {
      const runs = this.options.memoryfs.listRuns(this.options.workspaceId);
      return result("run", runs, runs.map(formatRun).join("\n") || "(no runs)");
    }

    if (subcommand === "path") {
      const runId = requiredArg(args[1], "run path requires a run id.");
      return result("run", { path: `/runs/${runId}` }, `/runs/${runId}`);
    }

    if (subcommand === "today") {
      const date = new Date().toISOString().slice(0, 10);
      return result("run", { path: `/runs/${date}` }, `/runs/${date}`);
    }

    throw new Error("Usage: run create <task> | run complete <run_id> [result] | run compile <run_id> | run show <run_id> | run list | run path <run_id> | run today");
  }

  private node(args: string[]): ShellExecResult {
    const subcommand = args[0];
    if (subcommand === "list") {
      const nodes = this.options.memoryfs.listMemoryNodes(this.options.workspaceId);
      return result(
        "node",
        nodes,
        nodes.map((node) => `${node.id} ${node.memory_type} ${node.source_path}\n  ${node.summary}`).join("\n") ||
          "(no nodes)"
      );
    }

    if (subcommand === "read") {
      const node = this.options.memoryfs.getMemoryNode(
        this.options.workspaceId,
        requiredArg(args[1], "node read requires a node id.")
      );
      return result(
        "node",
        node,
        `${node.id} ${node.memory_type}\nsummary: ${node.summary}\ntrigger: ${node.trigger}\nsource: ${node.source_path}\nraw_ref: ${node.raw_ref}`
      );
    }

    throw new Error("Usage: node list | node read <node_id>");
  }

  private async raw(nodeId: string): Promise<ShellExecResult> {
    const content = await this.options.memoryfs.readRawForNode(this.options.workspaceId, nodeId);
    return result("raw", { node_id: nodeId, content }, content);
  }

  private async promote(args: string[]): Promise<ShellExecResult<MemoryPromotion>> {
    const sourcePath = requiredArg(args[0], "promote requires a source path.");
    const targetPath = requiredArg(optionValue(args, "--to"), "promote requires --to <target_path>.");
    const promotion = await this.options.memoryfs.promoteMemory(this.options.workspaceId, {
      source_path: sourcePath,
      target_path: targetPath,
      source_node_id: optionValue(args, "--node"),
      reason: optionValue(args, "--reason"),
      actor: this.options.actor ?? "agent:virtual-bash",
      require_review: true
    });
    return result("promote", promotion, formatPromotion(promotion));
  }

  private health(): ShellExecResult<MemoryHealthReport> {
    const health = this.options.memoryfs.getMemoryHealth(this.options.workspaceId);
    return result("health", health, formatHealth(health));
  }

  private sync(args: string[]): ShellExecResult<SyncStatus> {
    if (args[0] !== "status") {
      throw new Error("Usage: sync status");
    }
    const status = this.options.memoryfs.getSyncStatus(this.options.workspaceId);
    return result("sync", status, formatSyncStatus(status));
  }

  private status(): ShellExecResult {
    const workspace = this.options.memoryfs.getWorkspace(this.options.workspaceId);
    const files = this.options.memoryfs.listFiles(this.options.workspaceId);
    const nodes = this.options.memoryfs.listMemoryNodes(this.options.workspaceId);
    return result(
      "status",
      { workspace, file_count: files.length, memory_node_count: nodes.length },
      `workspace: ${workspace.name} (${workspace.id})\nfiles: ${files.length}\nmemory nodes: ${nodes.length}`
    );
  }
}

export class VirtualBash extends MemoryFsShell {
  constructor(memoryfs: MemoryFS, workspaceId: string, options: VirtualBashOptions = {}) {
    super({
      memoryfs,
      workspaceId,
      actor: options.actor,
      ingestWrites: options.ingestWrites,
      allowProtectedWrite: options.allowProtectedWrite
    });
  }
}

export function createMemoryFsShell(options: MemoryFsShellOptions): MemoryFsShell {
  return new MemoryFsShell(options);
}

export function splitArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("Unterminated quote in virtual-bash command.");
  }

  if (escaped) {
    current += "\\";
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function rejectInjection(command: string): void {
  if (/(^|[^\\])(?:;|\|\||&&|`|\$\(|\||<|>)/.test(command)) {
    throw new Error("Unsupported shell syntax. MemFS virtual bash only accepts explicit supported commands.");
  }
}

function result<T>(command: string, data: T, displayText: string): ShellExecResult<T> {
  return {
    ok: true,
    command,
    data,
    displayText
  };
}

function requiredArg(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function optionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseGrepArgs(args: string[], defaultMode: "literal" | "semantic" | "hybrid" = "literal"): {
  query: string;
  mode: "literal" | "semantic" | "hybrid";
  scope?: string[];
  trust_min?: "ephemeral" | "agent_generated" | "source_backed" | "reviewed" | "trusted" | "superseded" | "rejected";
  include_runs?: boolean;
  include_sources?: boolean;
  include_stale?: boolean;
  limit?: number;
} {
  const queryParts: string[] = [];
  const scope: string[] = [];
  let mode: "literal" | "semantic" | "hybrid" = defaultMode;
  let trustMin: "ephemeral" | "agent_generated" | "source_backed" | "reviewed" | "trusted" | "superseded" | "rejected" | undefined;
  let includeRuns: boolean | undefined;
  let includeSources: boolean | undefined;
  let includeStale: boolean | undefined;
  let limit: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--literal" || arg === "-F") {
      mode = "literal";
    } else if (arg === "--semantic") {
      mode = "semantic";
    } else if (arg === "--hybrid") {
      mode = "hybrid";
    } else if (arg === "--trusted-only") {
      trustMin = "reviewed";
    } else if (arg === "--trust-min") {
      trustMin = args[++index] as typeof trustMin;
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
    } else if (arg === "--scope") {
      const value = args[++index];
      if (value) scope.push(...value.split(",").map((entry) => entry.trim()).filter(Boolean));
    } else if (arg === "--limit") {
      const value = Number(args[++index]);
      if (Number.isFinite(value)) limit = value;
    } else {
      queryParts.push(arg);
    }
  }

  return {
    query: queryParts.join(" "),
    mode,
    scope: scope.length ? scope : undefined,
    trust_min: trustMin,
    include_runs: includeRuns,
    include_sources: includeSources,
    include_stale: includeStale,
    limit
  };
}

function formatGrep(response: MemoryGrepResponse): string {
  return response.results
    .map((item, index) => {
      const location = item.line ? `${item.path}:${item.line}` : item.path;
      const node = item.node_id ? ` node=${item.node_id}` : "";
      const raw = item.raw_ref ? `\n  raw_ref: ${item.raw_ref}` : "";
      return [
        `${index + 1}. ${location}`,
        `   match: ${displayMatchType(item.match_type)}`,
        `   trust: ${item.trust ?? "unknown"}${node}`,
        `   why: ${matchReason(item.match_type)}`,
        `   snippet: ${item.snippet}`,
        raw ? `   ${raw.trim()}` : ""
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n") || "(no results)";
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

function formatRun(run: AgentRun): string {
  return `${run.id} ${run.status} ${run.run_path}\n  ${run.title}`;
}

function formatCompileRun(compiled: CompileRunResponse): string {
  return [
    compiled.summary,
    `candidate_nodes: ${compiled.candidate_nodes.length}`,
    `reasoning_candidates: ${compiled.reasoning_candidates.length}`,
    `suggested_promotions: ${compiled.suggested_promotions.length}`,
    `contradictions: ${compiled.contradictions.length}`,
    compiled.followups.length ? `followups: ${compiled.followups.join("; ")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatPromotion(promotion: MemoryPromotion): string {
  return [
    `${promotion.id} ${promotion.status}`,
    `${promotion.source_path} -> ${promotion.target_path}`,
    promotion.candidate_node_id ? `candidate: ${promotion.candidate_node_id}` : "",
    promotion.reason ? `reason: ${promotion.reason}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatHealth(health: MemoryHealthReport): string {
  return [
    `Memory health: ${health.overall_score}/100`,
    `source coverage: ${health.source_coverage}%`,
    `contradictions: ${health.contradiction_count}`,
    `pending promotions: ${health.unresolved_promotion_count}`,
    `orphans: ${health.orphan_node_count}`,
    `raw missing: ${health.raw_missing_count}`
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
