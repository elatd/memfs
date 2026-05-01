import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredBlob {
  sha256: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
}

export interface BlobStore {
  readonly kind: "local" | "object";
  put(bytes: Uint8Array, mimeType: string): Promise<StoredBlob>;
  get(sha256: string): Promise<Uint8Array>;
}

export class LocalBlobStore implements BlobStore {
  readonly kind = "local" as const;

  constructor(private readonly dataDir: string) {}

  async put(bytesInput: Uint8Array, mimeType: string): Promise<StoredBlob> {
    const bytes = Buffer.from(bytesInput);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storagePath = path.join("blobs", sha256.slice(0, 2), sha256);
    const absolutePath = path.join(this.dataDir, storagePath);
    if (!existsSync(absolutePath)) {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, bytes);
    }
    return {
      sha256,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: bytes.byteLength
    };
  }

  async get(sha256: string): Promise<Uint8Array> {
    const absolutePath = path.join(this.dataDir, "blobs", sha256.slice(0, 2), sha256);
    return readFile(absolutePath);
  }
}

export interface ObjectBlobClient {
  putObject(input: { bucket: string; key: string; body: Uint8Array; contentType: string }): Promise<void>;
  getObject(input: { bucket: string; key: string }): Promise<Uint8Array>;
}

export interface ObjectBlobStoreOptions {
  bucket: string;
  prefix?: string;
  client: ObjectBlobClient;
}

export class ObjectBlobStore implements BlobStore {
  readonly kind = "object" as const;

  constructor(private readonly options: ObjectBlobStoreOptions) {}

  async put(bytesInput: Uint8Array, mimeType: string): Promise<StoredBlob> {
    const bytes = Buffer.from(bytesInput);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const key = this.keyForSha(sha256);
    await this.options.client.putObject({
      bucket: this.options.bucket,
      key,
      body: bytes,
      contentType: mimeType
    });
    return {
      sha256,
      storage_path: key,
      mime_type: mimeType,
      size_bytes: bytes.byteLength
    };
  }

  async get(sha256: string): Promise<Uint8Array> {
    return this.options.client.getObject({
      bucket: this.options.bucket,
      key: this.keyForSha(sha256)
    });
  }

  private keyForSha(sha256: string): string {
    return [this.options.prefix?.replace(/\/$/, ""), "blobs", sha256.slice(0, 2), sha256]
      .filter(Boolean)
      .join("/");
  }
}

export interface WorkspaceFileStore {
  readonly kind: "local" | "remote-materialized";
  write(workspaceId: string, filePath: string, bytes: Uint8Array): Promise<void>;
  read(workspaceId: string, filePath: string): Promise<Uint8Array>;
  remove(workspaceId: string, filePath: string): Promise<void>;
}

export class LocalWorkspaceFileStore implements WorkspaceFileStore {
  readonly kind = "local" as const;

  constructor(private readonly rootDir: string) {}

  async write(workspaceId: string, filePath: string, bytes: Uint8Array): Promise<void> {
    const absolutePath = this.absolutePath(workspaceId, filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(bytes));
  }

  async read(workspaceId: string, filePath: string): Promise<Uint8Array> {
    return readFile(this.absolutePath(workspaceId, filePath));
  }

  async remove(workspaceId: string, filePath: string): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(this.absolutePath(workspaceId, filePath), { force: true });
  }

  private absolutePath(workspaceId: string, filePath: string): string {
    const root = path.resolve(this.rootDir, workspaceId);
    const absolutePath = path.resolve(root, filePath.replace(/^\/+/, ""));
    if (!absolutePath.startsWith(`${root}${path.sep}`) && absolutePath !== root) {
      throw new Error("Path escapes workspace root.");
    }
    return absolutePath;
  }
}

export interface SyncEventPacket {
  id: string;
  workspace_id: string;
  object_type: string;
  object_id: string;
  operation: string;
  object_version: string;
  payload_json: string;
  actor: string;
  created_at: string;
}

export interface SyncStore {
  push(events: SyncEventPacket[]): Promise<{ pushed: number }>;
  pull(workspaceId: string, since?: string): Promise<SyncEventPacket[]>;
}

export class InMemorySyncStore implements SyncStore {
  private readonly events: SyncEventPacket[] = [];

  async push(events: SyncEventPacket[]): Promise<{ pushed: number }> {
    this.events.push(...events);
    return { pushed: events.length };
  }

  async pull(workspaceId: string, since?: string): Promise<SyncEventPacket[]> {
    return this.events.filter((event) => {
      if (event.workspace_id !== workspaceId) return false;
      return since ? event.created_at > since : true;
    });
  }
}

export type PermissionAction =
  | "workspace.read"
  | "file.read"
  | "file.write"
  | "file.delete"
  | "memory.recall"
  | "memory.raw.read"
  | "memory.promote"
  | "memory.review"
  | "snapshot.create"
  | "snapshot.rollback"
  | "audit.read"
  | "sync.pull"
  | "sync.push";

export interface AuthzProvider {
  can(input: { actor: string; action: PermissionAction; workspaceId?: string; path?: string }): Promise<boolean> | boolean;
}

export class StaticAuthzProvider implements AuthzProvider {
  constructor(private readonly allowed = true) {}

  can(): boolean {
    return this.allowed;
  }
}
