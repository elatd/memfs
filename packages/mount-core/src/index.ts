import { MemoryFS, normalizeMemoryPath, type AuditEvent, type BriefRequest, type BriefResponse, type FileRecord, type MemoryGrepOptions, type MemoryGrepResponse, type MemoryHealthReport, type RecallOptions, type RecallResponse, type Workspace } from "@memoryfs/core";
import { MemoryFSClient } from "@memoryfs/sdk";
import path from "node:path";

export type MountMode = "read-only" | "read-write";
export type MountNodeType = "file" | "directory";
export type MountCoreErrorCode =
  | "ENOENT"
  | "EISDIR"
  | "ENOTDIR"
  | "EROFS"
  | "EACCES"
  | "EINVAL"
  | "ENOTEMPTY"
  | "ENOTSUP"
  | "EBUSY"
  | "RESERVED_PATH";
export type StructuredMountErrorCode =
  | "MOUNT_READ_ONLY"
  | "MOUNT_PROTECTED_PATH_DENIED"
  | "MOUNT_PATH_TRAVERSAL_REJECTED"
  | "MOUNT_RESERVED_NAMESPACE"
  | "MOUNT_WRITE_FAILED"
  | "MOUNT_RECALL_FAILED"
  | "MOUNT_SEARCH_FAILED"
  | "MOUNT_BRIEF_FAILED"
  | "MOUNT_FUSE_UNAVAILABLE";

export interface MountCoreOptions {
  workspaceId: string;
  actor?: string;
  coreClient?: MountClient;
  apiClient?: MountClient;
  client?: MountClient;
  mode: MountMode;
  ingestOnWrite?: boolean;
  allowProtectedWrite?: boolean;
  enableControlDir?: boolean;
  trustLevel?: string;
  defaultRunFolder?: string;
  apiUrl?: string;
}

export interface MountClient {
  getWorkspace?(workspaceId: string): Workspace | Promise<Workspace>;
  listFiles(workspaceId: string): FileRecord[] | Promise<FileRecord[] | unknown>;
  readFile(workspaceId: string, filePath: string, options?: { actor?: string }): Promise<{ file: FileRecord; content: string } | unknown>;
  writeFile?(
    workspaceId: string,
    filePath: string,
    content: string,
    options?: { actor?: string; ingest?: boolean; allow_protected_write?: boolean }
  ): Promise<FileRecord | unknown>;
  uploadFile?(
    workspaceId: string,
    filePath: string,
    bytes: Uint8Array | string,
    options?: { actor?: string; ingest?: boolean; allow_protected_write?: boolean; mime_type?: string }
  ): Promise<FileRecord | unknown>;
  deleteFile?(workspaceId: string, filePath: string, options?: { actor?: string; allow_protected_write?: boolean }): Promise<void | unknown>;
  recallMemory?(workspaceId: string, query: string, options?: RecallOptions): Promise<RecallResponse | unknown>;
  searchMemory?(workspaceId: string, query: string, options?: RecallOptions): Promise<RecallResponse | unknown>;
  grepMemory?(workspaceId: string, query: string, options?: MemoryGrepOptions): Promise<MemoryGrepResponse | unknown>;
  createBrief?(workspaceId: string, request: BriefRequest): Promise<BriefResponse | unknown>;
  listAuditEvents?(workspaceId: string, limit?: number): AuditEvent[] | Promise<AuditEvent[] | unknown>;
  getMemoryHealth?(workspaceId: string): MemoryHealthReport | Promise<MemoryHealthReport | unknown>;
  recordAuditEvent?(workspaceId: string, actor: string, eventType: string, payload?: unknown): AuditEvent | Promise<AuditEvent | unknown>;
}

export interface MountStat {
  path: string;
  type: MountNodeType;
  size: number;
  mtime: Date;
  ctime: Date;
  atime: Date;
}

export interface MountDirEntry {
  name: string;
  path: string;
  type: MountNodeType;
}

export interface MountStatus {
  workspaceId: string;
  workspaceName: string | null;
  actor: string;
  mode: MountMode;
  ingestOnWrite: boolean;
  allowProtectedWrite: boolean;
  enableControlDir: boolean;
  fileCount: number;
  transientDirectoryCount: number;
  lastRecallQuery: string | null;
  lastSearchQuery: string | null;
  lastRecallAt: string | null;
  lastSearchAt: string | null;
  lastBriefQuery: string | null;
  lastBriefAt: string | null;
  requestedTrustLevel: string | null;
  defaultRunFolder: string | null;
  mountedAt: string;
  apiUrl: string | null;
}

export interface MountWriteResult {
  path: string;
  bytesWritten: number;
}

export interface MountOpResult {
  ok: true;
  path?: string;
}

interface ControlState {
  recallQuery: string;
  recallResponse: RecallResponse | null;
  recallUpdatedAt: string | null;
  searchQuery: string;
  searchResponse: RecallResponse | MemoryGrepResponse | null;
  searchUpdatedAt: string | null;
  briefQuery: string;
  briefResponse: BriefResponse | null;
  briefUpdatedAt: string | null;
}

export class MountCoreError extends Error {
  constructor(
    public readonly code: MountCoreErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly mountCode?: StructuredMountErrorCode
  ) {
    super(message);
    this.name = "MountCoreError";
  }
}

export interface MountCore {
  stat(filePath: string): Promise<MountStat>;
  list(filePath: string): Promise<MountDirEntry[]>;
  read(filePath: string): Promise<Uint8Array>;
  write(filePath: string, bytes: Uint8Array, options?: { offset?: number; flush?: boolean }): Promise<MountWriteResult>;
  append(filePath: string, bytes: Uint8Array): Promise<MountWriteResult>;
  mkdir(filePath: string): Promise<MountOpResult>;
  unlink(filePath: string): Promise<MountOpResult>;
  rmdir(filePath: string): Promise<MountOpResult>;
  rename(from: string, to: string): Promise<MountOpResult>;
  truncate(filePath: string, size: number): Promise<MountOpResult>;
  flush(filePath: string): Promise<MountOpResult>;
  getStatus(): Promise<MountStatus>;
  dispose(): Promise<void>;
}

export function createMountCore(options: MountCoreOptions): MountCore {
  return new MemoryFsMountCore(options);
}

export function createCoreMountClient(memoryfs: MemoryFS): MountClient {
  return {
    getWorkspace: (workspaceId) => memoryfs.getWorkspace(workspaceId),
    listFiles: (workspaceId) => memoryfs.listFiles(workspaceId),
    readFile: (workspaceId, filePath, options) => memoryfs.readFile(workspaceId, filePath, options),
    writeFile: (workspaceId, filePath, content, options) => memoryfs.writeFile(workspaceId, filePath, content, options),
    uploadFile: (workspaceId, filePath, bytes, options) =>
      memoryfs.uploadFile(workspaceId, filePath, typeof bytes === "string" ? Buffer.from(bytes, "base64") : bytes, options),
    deleteFile: (workspaceId, filePath, options) => memoryfs.deleteFile(workspaceId, filePath, options),
    recallMemory: (workspaceId, query, options) => memoryfs.recallMemory(workspaceId, query, options),
    searchMemory: (workspaceId, query, options) => memoryfs.searchMemory(workspaceId, query, options),
    grepMemory: (workspaceId, query, options) => memoryfs.grepMemory(workspaceId, query, options),
    createBrief: (workspaceId, request) => memoryfs.createBrief(workspaceId, request),
    listAuditEvents: (workspaceId, limit) => memoryfs.listAuditEvents(workspaceId, limit),
    getMemoryHealth: (workspaceId) => memoryfs.getMemoryHealth(workspaceId),
    recordAuditEvent: (workspaceId, actor, eventType, payload) => memoryfs.recordAuditEvent(workspaceId, actor, eventType, payload)
  };
}

export function createHttpMountClient(options: { baseUrl?: string; client?: MemoryFSClient }): MountClient {
  const client = options.client ?? new MemoryFSClient(options.baseUrl);
  return {
    getWorkspace: (workspaceId) => client.listWorkspaces().then((workspaces) => {
      const workspace = asArray<Workspace>(workspaces).find((entry) => entry.id === workspaceId);
      if (!workspace) throw new MountCoreError("ENOENT", `Workspace not found: ${workspaceId}`);
      return workspace;
    }),
    listFiles: (workspaceId) => client.listFiles(workspaceId),
    readFile: (workspaceId, filePath, options) => client.readFile(workspaceId, filePath, options),
    writeFile: (workspaceId, filePath, content, writeOptions) => client.writeFile(workspaceId, filePath, content, writeOptions),
    uploadFile: (workspaceId, filePath, bytes, uploadOptions) =>
      client.uploadFile(
        workspaceId,
        filePath,
        typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("base64"),
        uploadOptions
      ),
    deleteFile: (workspaceId, filePath, deleteOptions) => client.deleteFile(workspaceId, filePath, deleteOptions),
    recallMemory: (workspaceId, query, recallOptions) => client.recallMemory(workspaceId, query, recallOptions),
    searchMemory: (workspaceId, query, recallOptions) => client.searchMemory(workspaceId, query, recallOptions),
    grepMemory: (workspaceId, query, grepOptions) => client.grepMemory(workspaceId, query, grepOptions),
    createBrief: (workspaceId, request) => client.createBrief(workspaceId, request.task, request),
    listAuditEvents: (workspaceId, limit) => client.listAuditEvents(workspaceId, limit),
    getMemoryHealth: (workspaceId) => client.getMemoryHealth(workspaceId),
    recordAuditEvent: (workspaceId, actor, eventType, payload) => client.recordAuditEvent(workspaceId, { actor, event_type: eventType, payload })
  };
}

class MemoryFsMountCore implements MountCore {
  private readonly client: MountClient;
  private readonly actor: string;
  private readonly mode: MountMode;
  private readonly ingestOnWrite: boolean;
  private readonly allowProtectedWrite: boolean;
  private readonly enableControlDir: boolean;
  private readonly mountedAt = new Date().toISOString();
  private readonly transientDirs = new Set<string>();
  private readonly control: ControlState = {
    recallQuery: "",
    recallResponse: null,
    recallUpdatedAt: null,
    searchQuery: "",
    searchResponse: null,
    searchUpdatedAt: null,
    briefQuery: "",
    briefResponse: null,
    briefUpdatedAt: null
  };

  constructor(private readonly options: MountCoreOptions) {
    const client = options.client ?? options.coreClient ?? options.apiClient;
    if (!client) {
      throw new MountCoreError("EINVAL", "createMountCore requires a coreClient, apiClient, or client.", undefined, "MOUNT_WRITE_FAILED");
    }
    this.client = client;
    this.actor = options.actor ?? "mount:local";
    this.mode = options.mode;
    this.ingestOnWrite = options.ingestOnWrite ?? false;
    this.allowProtectedWrite = options.allowProtectedWrite ?? false;
    this.enableControlDir = options.enableControlDir ?? true;
  }

  async stat(inputPath: string): Promise<MountStat> {
    const filePath = normalizeMountPath(inputPath);
    const now = new Date();
    if (filePath === "/") return statFor(filePath, "directory", 0, now);

    if (this.isControlPath(filePath)) {
      return this.statControlPath(filePath);
    }

    const file = await this.findFile(filePath);
    if (file) return statFor(file.path, "file", file.size_bytes, new Date(file.updated_at));

    if (await this.directoryExists(filePath)) return statFor(filePath, "directory", 0, now);
    throw new MountCoreError("ENOENT", `No such file or directory: ${filePath}`);
  }

  async list(inputPath: string): Promise<MountDirEntry[]> {
    const dirPath = normalizeMountPath(inputPath);
    if (this.isControlPath(dirPath)) return this.listControlPath(dirPath);
    if ((await this.findFile(dirPath)) && !(await this.directoryExists(dirPath))) {
      throw new MountCoreError("ENOTDIR", `Not a directory: ${dirPath}`);
    }

    const entries = new Map<string, MountDirEntry>();
    if (dirPath === "/" && this.enableControlDir) {
      entries.set(".memfs", { name: ".memfs", path: "/.memfs", type: "directory" });
    }

    for (const file of await this.files()) {
      addChildEntry(entries, dirPath, file.path, "file");
    }
    for (const transientDir of this.transientDirs) {
      addChildEntry(entries, dirPath, transientDir, "directory");
    }

    if (entries.size === 0 && dirPath !== "/" && !(await this.directoryExists(dirPath))) {
      throw new MountCoreError("ENOENT", `No such directory: ${dirPath}`);
    }

    return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async read(inputPath: string): Promise<Uint8Array> {
    const filePath = normalizeMountPath(inputPath);
    if (this.isControlPath(filePath)) return Buffer.from(await this.readControlPath(filePath), "utf8");
    if (await this.directoryExists(filePath)) throw new MountCoreError("EISDIR", `Is a directory: ${filePath}`);
    const response = asFileRead(await this.client.readFile(this.options.workspaceId, filePath, { actor: this.actor }));
    await this.recordAudit("mount.file.read", { path: filePath, size_bytes: response.file.size_bytes });
    return Buffer.from(response.content, "utf8");
  }

  async write(inputPath: string, bytes: Uint8Array): Promise<MountWriteResult> {
    const filePath = normalizeMountPath(inputPath);
    if (this.isControlPath(filePath)) return this.writeControlPath(filePath, bytes);
    this.ensureWritable(filePath);
    if (filePath === "/") throw new MountCoreError("EISDIR", "Cannot write to workspace root.");
    await this.writeBytes(filePath, bytes);
    return { path: filePath, bytesWritten: bytes.byteLength };
  }

  async append(inputPath: string, bytes: Uint8Array): Promise<MountWriteResult> {
    const filePath = normalizeMountPath(inputPath);
    if (this.isControlPath(filePath)) return this.writeControlPath(filePath, bytes);
    this.ensureWritable(filePath);
    let existing = Buffer.alloc(0);
    try {
      existing = Buffer.from(await this.read(filePath));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const next = Buffer.concat([existing, Buffer.from(bytes)]);
    await this.writeBytes(filePath, next);
    return { path: filePath, bytesWritten: bytes.byteLength };
  }

  async mkdir(inputPath: string): Promise<MountOpResult> {
    const dirPath = normalizeMountPath(inputPath);
    this.ensureWritable(dirPath);
    this.ensureNotReserved(dirPath);
    if (await this.findFile(dirPath)) throw new MountCoreError("ENOTDIR", `File exists at directory path: ${dirPath}`);
    this.transientDirs.add(dirPath);
    return { ok: true, path: dirPath };
  }

  async unlink(inputPath: string): Promise<MountOpResult> {
    const filePath = normalizeMountPath(inputPath);
    this.ensureWritable(filePath);
    this.ensureNotReserved(filePath);
    if (!this.client.deleteFile) throw new MountCoreError("ENOTSUP", "Client does not support deleteFile.");
    await this.wrapClientError(() =>
      this.client.deleteFile!(this.options.workspaceId, filePath, {
        actor: this.actor,
        allow_protected_write: this.allowProtectedWrite
      })
    );
    await this.recordAudit("mount.file.delete", {
      path: filePath,
      allow_protected_write: this.allowProtectedWrite
    });
    return { ok: true, path: filePath };
  }

  async rmdir(inputPath: string): Promise<MountOpResult> {
    const dirPath = normalizeMountPath(inputPath);
    this.ensureWritable(dirPath);
    this.ensureNotReserved(dirPath);
    if (dirPath === "/") throw new MountCoreError("EACCES", "Cannot remove workspace root.");
    const hasFiles = (await this.files()).some((file) => file.path.startsWith(`${dirPath.replace(/\/$/, "")}/`));
    const hasTransientChildren = [...this.transientDirs].some((entry) => entry !== dirPath && entry.startsWith(`${dirPath.replace(/\/$/, "")}/`));
    if (hasFiles || hasTransientChildren) throw new MountCoreError("ENOTEMPTY", `Directory is not empty: ${dirPath}`);
    if (!this.transientDirs.delete(dirPath)) throw new MountCoreError("ENOENT", `No such transient directory: ${dirPath}`);
    return { ok: true, path: dirPath };
  }

  async rename(fromInput: string, toInput: string): Promise<MountOpResult> {
    const from = normalizeMountPath(fromInput);
    const to = normalizeMountPath(toInput);
    this.ensureWritable(from);
    this.ensureWritable(to);
    this.ensureNotReserved(from);
    this.ensureNotReserved(to);
    if (await this.directoryExists(from)) throw new MountCoreError("ENOTSUP", "Directory rename is not supported in this MVP.");
    const bytes = await this.read(from);
    await this.write(to, bytes);
    await this.unlink(from);
    return { ok: true, path: to };
  }

  async truncate(inputPath: string, size: number): Promise<MountOpResult> {
    const filePath = normalizeMountPath(inputPath);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new MountCoreError("EINVAL", `Invalid truncate size: ${size}`);
    }
    this.ensureWritable(filePath);
    this.ensureNotReserved(filePath);
    const existing = Buffer.from(await this.read(filePath));
    const next =
      existing.byteLength >= size
        ? existing.subarray(0, size)
        : Buffer.concat([existing, Buffer.alloc(size - existing.byteLength)]);
    await this.writeBytes(filePath, next);
    return { ok: true, path: filePath };
  }

  async flush(inputPath: string): Promise<MountOpResult> {
    return { ok: true, path: normalizeMountPath(inputPath) };
  }

  async getStatus(): Promise<MountStatus> {
    const workspace = this.client.getWorkspace ? await this.client.getWorkspace(this.options.workspaceId) : null;
    return {
      workspaceId: this.options.workspaceId,
      workspaceName: workspace?.name ?? null,
      actor: this.actor,
      mode: this.mode,
      ingestOnWrite: this.ingestOnWrite,
      allowProtectedWrite: this.allowProtectedWrite,
      enableControlDir: this.enableControlDir,
      fileCount: (await this.files()).length,
      transientDirectoryCount: this.transientDirs.size,
      lastRecallQuery: this.control.recallQuery || null,
      lastSearchQuery: this.control.searchQuery || null,
      lastRecallAt: this.control.recallUpdatedAt,
      lastSearchAt: this.control.searchUpdatedAt,
      lastBriefQuery: this.control.briefQuery || null,
      lastBriefAt: this.control.briefUpdatedAt,
      requestedTrustLevel: this.options.trustLevel ?? null,
      defaultRunFolder: this.options.defaultRunFolder ?? null,
      mountedAt: this.mountedAt,
      apiUrl: this.options.apiUrl ?? null
    };
  }

  async dispose(): Promise<void> {
    this.transientDirs.clear();
  }

  private async writeBytes(filePath: string, bytes: Uint8Array): Promise<void> {
    await this.wrapClientError(async () => {
      const options = {
        actor: this.actor,
        ingest: this.ingestOnWrite,
        allow_protected_write: this.allowProtectedWrite
      };
      if (this.client.uploadFile) {
        await this.client.uploadFile(this.options.workspaceId, filePath, bytes, options);
      } else if (this.client.writeFile) {
        await this.client.writeFile(this.options.workspaceId, filePath, Buffer.from(bytes).toString("utf8"), options);
      } else {
        throw new MountCoreError("ENOTSUP", "Client does not support file writes.");
      }
      await this.recordAudit("mount.file.write", {
        path: filePath,
        size_bytes: bytes.byteLength,
        ingest: this.ingestOnWrite,
        allow_protected_write: this.allowProtectedWrite,
        trust_level: this.options.trustLevel ?? null,
        default_run_folder: this.options.defaultRunFolder ?? null
      });
    });
  }

  private ensureWritable(filePath: string): void {
    if (this.mode !== "read-write") {
      throw new MountCoreError("EROFS", `Mount is read-only: ${filePath}`, undefined, "MOUNT_READ_ONLY");
    }
  }

  private ensureNotReserved(filePath: string): void {
    if (this.isControlPath(filePath)) {
      throw new MountCoreError("RESERVED_PATH", `Reserved mount control path: ${filePath}`, undefined, "MOUNT_RESERVED_NAMESPACE");
    }
  }

  private isControlPath(filePath: string): boolean {
    return this.enableControlDir && (filePath === "/.memfs" || filePath.startsWith("/.memfs/"));
  }

  private async statControlPath(filePath: string): Promise<MountStat> {
    const now = new Date();
    if (filePath === "/.memfs") return statFor(filePath, "directory", 0, now);
    const content = await this.readControlPath(filePath);
    return statFor(filePath, "file", Buffer.byteLength(content), now);
  }

  private async listControlPath(filePath: string): Promise<MountDirEntry[]> {
    if (filePath !== "/.memfs") throw new MountCoreError("ENOTDIR", `Not a control directory: ${filePath}`);
    return controlFiles.map((name) => ({
      name,
      path: `/.memfs/${name}`,
      type: "file"
    }));
  }

  private async readControlPath(filePath: string): Promise<string> {
    switch (filePath) {
      case "/.memfs/README.md":
        return controlReadme;
      case "/.memfs/status.json":
        return `${JSON.stringify(await this.getStatus(), null, 2)}\n`;
      case "/.memfs/recall.query":
        return this.control.recallQuery;
      case "/.memfs/recall.results.md":
        return renderRecallResults("Recall results", this.control.recallResponse);
      case "/.memfs/search.query":
        return this.control.searchQuery;
      case "/.memfs/search.results.md":
        return renderSearchResults("Search results", this.control.searchResponse);
      case "/.memfs/brief.query":
        return this.control.briefQuery;
      case "/.memfs/brief.results.md":
        return renderBriefResults(this.control.briefResponse);
      case "/.memfs/audit.md":
        return this.renderAudit();
      case "/.memfs/health.md":
        return this.renderHealth();
      default:
        throw new MountCoreError("ENOENT", `Unknown control file: ${filePath}`);
    }
  }

  private async writeControlPath(filePath: string, bytes: Uint8Array): Promise<MountWriteResult> {
    const query = Buffer.from(bytes).toString("utf8").trim();
    if (filePath === "/.memfs/recall.query") {
      if (!this.client.recallMemory) throw new MountCoreError("ENOTSUP", "Client does not support recall.");
      this.control.recallQuery = query;
      try {
        this.control.recallResponse = asRecallResponse(await this.client.recallMemory(this.options.workspaceId, query, {
          include_detail: true,
          include_raw: false,
          include_trust: true,
          include_rejected: false,
          include_stale: false,
          limit: 8
        }));
      } catch (error) {
        throw new MountCoreError("EINVAL", "Mount recall query failed.", error, "MOUNT_RECALL_FAILED");
      }
      await this.recordAudit("mount.recall.query", { query, result_count: this.control.recallResponse.results.length });
      this.control.recallUpdatedAt = new Date().toISOString();
      return { path: filePath, bytesWritten: bytes.byteLength };
    }
    if (filePath === "/.memfs/search.query") {
      if (!this.client.grepMemory && !this.client.searchMemory) throw new MountCoreError("ENOTSUP", "Client does not support memory search.");
      this.control.searchQuery = query;
      try {
        this.control.searchResponse = this.client.grepMemory
          ? asGrepResponse(await this.client.grepMemory(this.options.workspaceId, query, {
              mode: "hybrid",
              include_sources: true,
              include_runs: true,
              limit: 8
            }))
          : asRecallResponse(await this.client.searchMemory!(this.options.workspaceId, query, {
              include_detail: true,
              include_raw: false,
              limit: 8
            }));
      } catch (error) {
        throw new MountCoreError("EINVAL", "Mount search query failed.", error, "MOUNT_SEARCH_FAILED");
      }
      await this.recordAudit("mount.search.query", { query, result_count: this.control.searchResponse.results.length });
      this.control.searchUpdatedAt = new Date().toISOString();
      return { path: filePath, bytesWritten: bytes.byteLength };
    }
    if (filePath === "/.memfs/brief.query") {
      if (!this.client.createBrief) throw new MountCoreError("ENOTSUP", "Client does not support briefs.");
      this.control.briefQuery = query;
      try {
        this.control.briefResponse = asBriefResponse(await this.client.createBrief(this.options.workspaceId, {
          task: query,
          actor: this.actor,
          create_run: false,
          include_candidates: false,
          include_raw: false,
          include_recent_runs: true,
          include_open_questions: true,
          include_contradictions: true,
          limit: 8
        }));
      } catch (error) {
        throw new MountCoreError("EINVAL", "Mount brief query failed.", error, "MOUNT_BRIEF_FAILED");
      }
      await this.recordAudit("mount.brief.query", {
        query,
        result_count: this.control.briefResponse.memory_results.length
      });
      this.control.briefUpdatedAt = new Date().toISOString();
      return { path: filePath, bytesWritten: bytes.byteLength };
    }
    throw new MountCoreError("RESERVED_PATH", `Control file is read-only: ${filePath}`, undefined, "MOUNT_RESERVED_NAMESPACE");
  }

  private async renderAudit(): Promise<string> {
    if (!this.client.listAuditEvents) return "# Audit\n\nAudit events are not supported by this mount client.\n";
    const events = asArray<AuditEvent>(await this.client.listAuditEvents(this.options.workspaceId, 50));
    if (events.length === 0) return "# Audit\n\nNo audit events.\n";
    return `# Audit\n\n${events.map((event) => `- ${event.created_at} ${event.actor} ${event.event_type}`).join("\n")}\n`;
  }

  private async renderHealth(): Promise<string> {
    if (!this.client.getMemoryHealth) return "# Memory Health\n\nMemory health is not supported by this mount client.\n";
    const health = await this.client.getMemoryHealth(this.options.workspaceId) as MemoryHealthReport;
    return [
      "# Memory Health",
      "",
      `overall_score: ${health.overall_score}`,
      `source_coverage: ${health.source_coverage}`,
      `contradiction_count: ${health.contradiction_count}`,
      `unresolved_promotion_count: ${health.unresolved_promotion_count}`,
      `orphan_node_count: ${health.orphan_node_count}`,
      `raw_missing_count: ${health.raw_missing_count}`,
      `low_confidence_count: ${health.low_confidence_count}`,
      `rejected_node_count: ${health.rejected_node_count}`,
      `stale_node_count: ${health.stale_node_count}`,
      `old_node_count: ${health.old_node_count ?? 0}`,
      `unconfirmed_node_count: ${health.unconfirmed_node_count ?? 0}`,
      `superseded_node_count: ${health.superseded_node_count ?? 0}`,
      `conflicted_node_count: ${health.conflicted_node_count ?? 0}`,
      ""
    ].join("\n");
  }

  private async files(): Promise<FileRecord[]> {
    return asArray<FileRecord>(await this.client.listFiles(this.options.workspaceId));
  }

  private async findFile(filePath: string): Promise<FileRecord | null> {
    return (await this.files()).find((file) => file.path === filePath) ?? null;
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    if (dirPath === "/") return true;
    if (this.transientDirs.has(dirPath)) return true;
    const prefix = `${dirPath.replace(/\/$/, "")}/`;
    return (await this.files()).some((file) => file.path.startsWith(prefix)) ||
      [...this.transientDirs].some((entry) => entry.startsWith(prefix));
  }

  private async wrapClientError<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof MountCoreError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/protected path/i.test(message)) {
        await this.recordAudit("mount.protected_write.denied", {
          message,
          allow_protected_write: this.allowProtectedWrite
        });
        throw new MountCoreError(
          "EACCES",
          "Protected path denied. Re-run mount with --allow-protected-write or write to /runs/ and promote later.",
          error,
          "MOUNT_PROTECTED_PATH_DENIED"
        );
      }
      if (/not found|no such|does not exist/i.test(message)) throw new MountCoreError("ENOENT", message, error);
      throw new MountCoreError("EINVAL", message, error, "MOUNT_WRITE_FAILED");
    }
  }

  private async recordAudit(eventType: string, payload: unknown): Promise<void> {
    if (!this.client.recordAuditEvent) return;
    await this.client.recordAuditEvent(this.options.workspaceId, this.actor, eventType, {
      mount: true,
      ...asObject(payload)
    });
  }
}

export function normalizeMountPath(inputPath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(inputPath)) {
    throw new MountCoreError("EINVAL", "Host drive paths are not valid MemFS mount paths.", undefined, "MOUNT_PATH_TRAVERSAL_REJECTED");
  }
  const withSlash = inputPath.startsWith("/") ? inputPath : `/${inputPath}`;
  if (withSlash.includes("\0")) throw new MountCoreError("EINVAL", "Path cannot include null bytes.");
  if (withSlash.replace(/\\/g, "/").split("/").includes("..")) {
    throw new MountCoreError("EINVAL", "Path traversal is not allowed.", undefined, "MOUNT_PATH_TRAVERSAL_REJECTED");
  }
  return normalizeMemoryPath(path.posix.normalize(withSlash.replace(/\\/g, "/")));
}

function statFor(filePath: string, type: MountNodeType, size: number, timestamp: Date): MountStat {
  return {
    path: filePath,
    type,
    size,
    mtime: timestamp,
    ctime: timestamp,
    atime: timestamp
  };
}

function addChildEntry(entries: Map<string, MountDirEntry>, dirPath: string, candidatePath: string, candidateType: MountNodeType): void {
  const normalizedDir = dirPath === "/" ? "/" : dirPath.replace(/\/$/, "");
  if (candidatePath === normalizedDir) return;
  const prefix = normalizedDir === "/" ? "/" : `${normalizedDir}/`;
  if (!candidatePath.startsWith(prefix)) return;
  const relative = candidatePath.slice(prefix.length);
  if (!relative) return;
  const [name, ...rest] = relative.split("/");
  if (!name) return;
  entries.set(name, {
    name,
    path: path.posix.join(normalizedDir, name),
    type: rest.length > 0 ? "directory" : candidateType
  });
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asFileRead(value: unknown): { file: FileRecord; content: string } {
  if (value && typeof value === "object" && "content" in value && "file" in value) {
    return value as { file: FileRecord; content: string };
  }
  throw new MountCoreError("EINVAL", "Client returned an invalid file read response.");
}

function asRecallResponse(value: unknown): RecallResponse {
  if (value && typeof value === "object" && "results" in value) {
    return value as RecallResponse;
  }
  return { query: "", results: [] };
}

function asGrepResponse(value: unknown): MemoryGrepResponse {
  if (value && typeof value === "object" && "results" in value) {
    return value as MemoryGrepResponse;
  }
  return { query: "", mode: "hybrid", workspace_id: "", results: [] };
}

function asBriefResponse(value: unknown): BriefResponse {
  if (value && typeof value === "object" && "brief_markdown" in value && "memory_results" in value) {
    return value as BriefResponse;
  }
  return {
    brief_markdown: "",
    sections: {
      facts: [],
      decisions: [],
      constraints: [],
      preferences: [],
      previous_failures: [],
      previous_errors: [],
      successful_patterns: [],
      reasoning_memories: [],
      stale_or_conflicted: [],
      open_questions: [],
      suggested_files: [],
      likely_paths: [],
      suggested_actions: [],
      warnings: []
    },
    memory_results: []
  };
}

function isMissing(error: unknown): boolean {
  return error instanceof MountCoreError && error.code === "ENOENT";
}

function renderRecallResults(title: string, response: RecallResponse | null): string {
  if (!response) return `# ${title}\n\nNo query has been run.\n`;
  if (response.results.length === 0) return `# ${title}\n\nQuery: ${response.query}\n\nNo results.\n`;
  return [
    `# ${title}`,
    "",
    `Query: ${response.query}`,
    "",
    rawSourceWarning,
    "",
    ...response.results.map((result, index) =>
      [
        `## ${index + 1}. ${result.summary}`,
        "",
        `- score: ${result.score.toFixed(3)}`,
        `- trust: ${result.trust_level ?? "unknown"}`,
        `- node_id: ${result.node_id}`,
        `- type: ${result.memory_type}`,
        `- tags: ${result.tags.join(", ") || "(none)"}`,
        `- source_path: ${result.source_path}`,
        `- raw_ref: ${result.raw_ref}`,
        `- trigger: ${result.trigger}`,
        result.detail ? `- detail: ${result.detail}` : null
      ].filter(Boolean).join("\n")
    ),
    ""
  ].join("\n");
}

function renderSearchResults(title: string, response: RecallResponse | MemoryGrepResponse | null): string {
  if (!response) return `# ${title}\n\nNo query has been run.\n`;
  if (response.results.length === 0) return `# ${title}\n\nQuery: ${response.query}\n\nNo results.\n`;
  const first = response.results[0] as unknown;
  if (first && typeof first === "object" && "snippet" in first) {
    const grep = response as MemoryGrepResponse;
    return [
      `# ${title}`,
      "",
      `Query: ${grep.query}`,
      `Mode: ${grep.mode}`,
      "",
      rawSourceWarning,
      "",
      ...grep.results.map((result, index) =>
        [
          `## ${index + 1}. ${result.line ? `${result.path}:${result.line}` : result.path}`,
          "",
          `- score: ${result.score.toFixed(3)}`,
          `- match_type: ${result.match_type}`,
          `- trust: ${result.trust ?? "unknown"}`,
          result.node_id ? `- node_id: ${result.node_id}` : null,
          `- source_path: ${result.source_path}`,
          `- raw_ref: ${result.raw_ref ?? "(none)"}`,
          `- snippet: ${result.snippet}`
        ].filter(Boolean).join("\n")
      ),
      ""
    ].join("\n");
  }
  return renderRecallResults(title, response as RecallResponse);
}

function renderBriefResults(response: BriefResponse | null): string {
  if (!response) return "# Brief results\n\nNo query has been run.\n";
  const recalled = response.memory_results;
  return [
    "# Brief results",
    "",
    rawSourceWarning,
    "",
    response.brief_markdown.trim(),
    "",
    "## Source-backed memory used",
    "",
    ...(recalled.length
      ? recalled.map((result, index) =>
          [
            `### ${index + 1}. ${result.summary}`,
            "",
            `- score: ${result.score.toFixed(3)}`,
            `- trust: ${result.trust_level ?? "unknown"}`,
            `- node_id: ${result.node_id}`,
            `- type: ${result.memory_type}`,
            `- source_path: ${result.source_path}`,
            `- raw_ref: ${result.raw_ref}`,
            result.warnings?.length ? `- warnings: ${result.warnings.join("; ")}` : null
          ].filter(Boolean).join("\n")
        )
      : ["No memory results were used."]),
    ""
  ].join("\n");
}

const rawSourceWarning = "> Raw source content is not returned here. Read the source file or use explicit raw-source tools when needed.";

const controlFiles = [
  "README.md",
  "status.json",
  "recall.query",
  "recall.results.md",
  "search.query",
  "search.results.md",
  "brief.query",
  "brief.results.md",
  "audit.md",
  "health.md"
];

const controlReadme = `# MemFS Mount Control

This virtual directory is provided by the MemFS mount layer.

Examples:

\`\`\`bash
echo "What should I remember before changing onboarding?" > .memfs/recall.query
cat .memfs/recall.results.md

echo "onboarding decision" > .memfs/search.query
cat .memfs/search.results.md

echo "Fix OAuth refresh token flow" > .memfs/brief.query
cat .memfs/brief.results.md

cat .memfs/status.json
cat .memfs/audit.md
cat .memfs/health.md
\`\`\`

Files:

- recall.query: write a query to run memory recall for this mount session.
- recall.results.md: read markdown recall results with source_path and raw_ref.
- search.query: write a query to run meaning-oriented hybrid search for this mount session.
- search.results.md: read markdown search results with source_path and raw_ref.
- brief.query: write a task to generate a pre-task memory brief for this mount session.
- brief.results.md: read a compact brief with source paths, trust, scores, node ids, and raw refs.
- status.json: read workspace and mount state.
- audit.md: read recent audit events when supported.
- health.md: read memory health when supported.

Recall/search/brief results do not include raw source content by default. Read the source file or use explicit raw-source tools when needed.

Control files do not create normal workspace files.
.memfs is reserved and cannot be removed, renamed, or overwritten as normal memory.
`;
