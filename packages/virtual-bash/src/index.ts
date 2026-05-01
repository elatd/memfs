import { MemoryFS, normalizeMemoryPath, type RecallResponse } from "@memoryfs/core";

export interface MemoryFsShellOptions {
  memoryfs: MemoryFS;
  workspaceId: string;
  actor?: string;
  ingestWrites?: boolean;
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
}

interface LiteralMatch {
  path: string;
  line: number;
  text: string;
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
        return this.grep(requiredArg(args[0], "grep requires a query."));
      case "sgrep":
        return this.sgrep(requiredArg(args[0], "sgrep requires a query."));
      case "recall":
        return this.recall(requiredArg(args[0], "recall requires a query."));
      case "node":
        return this.node(args);
      case "raw":
        return this.raw(requiredArg(args[0], "raw requires a node id."));
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
      allow_protected_write: true
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
      allow_protected_write: true
    });
    return result("append", file, `Appended ${file.path}`);
  }

  private async rm(filePath: string): Promise<ShellExecResult> {
    const normalizedPath = normalizeMemoryPath(filePath);
    await this.options.memoryfs.deleteFile(this.options.workspaceId, normalizedPath, {
      actor: this.options.actor ?? "agent:virtual-bash",
      allow_protected_write: true
    });
    return result("rm", { path: normalizedPath }, `Deleted ${normalizedPath}`);
  }

  private mkdir(filePath: string): ShellExecResult {
    const normalizedPath = normalizeMemoryPath(filePath);
    return result("mkdir", { path: normalizedPath }, `Directory marker accepted for ${normalizedPath}`);
  }

  private async grep(query: string): Promise<ShellExecResult> {
    const literalMatches = await this.literalMatches(query);
    const search = await this.options.memoryfs.searchMemory(this.options.workspaceId, query, {
      include_detail: true,
      include_raw: false
    });
    return result(
      "grep",
      { literal_matches: literalMatches, memory: search.results },
      [
        ...literalMatches.map((match) => `${match.path}:${match.line}:${match.text}`),
        ...search.results.map((item) => `${item.source_path} [${item.score.toFixed(2)}] ${item.summary}`)
      ].join("\n") || "(no results)"
    );
  }

  private async sgrep(query: string): Promise<ShellExecResult<RecallResponse>> {
    const recall = await this.options.memoryfs.recallMemory(this.options.workspaceId, query, {
      include_detail: true,
      include_raw: false,
      limit: 8
    });
    return result(
      "sgrep",
      recall,
      recall.results
        .map((item) => `${item.source_path} [${item.score.toFixed(2)}] ${item.summary}\n  raw_ref: ${item.raw_ref}`)
        .join("\n") || "(no results)"
    );
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

  private async literalMatches(query: string): Promise<LiteralMatch[]> {
    const matches: LiteralMatch[] = [];
    for (const file of this.options.memoryfs.listFiles(this.options.workspaceId)) {
      if (file.path.toLowerCase().includes(query.toLowerCase())) {
        matches.push({ path: file.path, line: 0, text: "(path match)" });
      }
      const content = (await this.options.memoryfs.readFile(this.options.workspaceId, file.path)).content;
      content.split(/\n/).forEach((line, index) => {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          matches.push({ path: file.path, line: index + 1, text: line });
        }
      });
    }
    return matches;
  }
}

export class VirtualBash extends MemoryFsShell {
  constructor(memoryfs: MemoryFS, workspaceId: string, options: VirtualBashOptions = {}) {
    super({
      memoryfs,
      workspaceId,
      actor: options.actor,
      ingestWrites: options.ingestWrites
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
