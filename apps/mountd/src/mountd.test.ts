import { constants as fsConstants } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MountCoreError, type MountCore } from "@memoryfs/mount-core";
import {
  createFuseOperations,
  fuseErrorCode,
  isWriteFlag,
  listMountRegistry,
  mountRegistryPath,
  parseMountdArgs,
  type FuseOperations
} from "./index.js";

describe("mountd config", () => {
  it("parses read-write flags and defaults safely", () => {
    const parsed = parseMountdArgs([
      "demo",
      "~/MemFS/demo",
      "--read-write",
      "--ingest-on-write",
      "--allow-protected-write",
      "--trust-level",
      "agent_generated",
      "--default-run-folder",
      "/runs/today"
    ], {
      HOME: "/tmp/home",
      MEMFS_API_URL: "http://127.0.0.1:3131"
    });

    expect(parsed.workspace).toBe("demo");
    expect(parsed.mountpoint).toBe("/tmp/home/MemFS/demo");
    expect(parsed.mode).toBe("read-write");
    expect(parsed.ingestOnWrite).toBe(true);
    expect(parsed.allowProtectedWrite).toBe(true);
    expect(parsed.trustLevel).toBe("agent_generated");
    expect(parsed.defaultRunFolder).toBe("/runs/today");
  });

  it("defaults to read-only and rejects mutually exclusive mode flags", () => {
    expect(parseMountdArgs(["demo", "/tmp/mount"]).mode).toBe("read-only");
    expect(() => parseMountdArgs(["demo", "/tmp/mount", "--read-only", "--read-write"])).toThrow(/mutually exclusive/);
  });
});

describe("mountd FUSE operations", () => {
  it("detects write flags", () => {
    expect(isWriteFlag(fsConstants.O_RDONLY)).toBe(false);
    expect(isWriteFlag(fsConstants.O_WRONLY)).toBe(true);
    expect(isWriteFlag(fsConstants.O_RDWR)).toBe(true);
    expect(isWriteFlag(fsConstants.O_RDONLY | fsConstants.O_TRUNC)).toBe(true);
  });

  it("rejects writes on read-only mounts", async () => {
    const core = fakeCore();
    const ops: FuseOperations = createFuseOperations(core, { mode: "read-only" });

    const [code] = await invoke(ops.open, "/runs/today/result.md", fsConstants.O_WRONLY);

    expect(code).toBe(-30);
  });

  it("creates, writes, flushes, and releases once", async () => {
    const core = fakeCore();
    const ops: FuseOperations = createFuseOperations(core, { mode: "read-write" });

    const [createCode, fd] = await invoke(ops.create, "/runs/today/result.md", 0o644);
    expect(createCode).toBe(0);
    if (typeof fd !== "number") throw new Error("create did not return a file descriptor.");
    const [written] = await invoke(ops.write, "/runs/today/result.md", fd, Buffer.from("hello"), 5, 0);
    expect(written).toBe(5);
    expect((await invoke(ops.flush, "/runs/today/result.md", fd))[0]).toBe(0);
    expect((await invoke(ops.release, "/runs/today/result.md", fd))[0]).toBe(0);

    expect(core.writes).toEqual([{ path: "/runs/today/result.md", content: "hello" }]);
  });

  it("appends to the end of the handle buffer", async () => {
    const core = fakeCore({ "/runs/today/result.md": "hello" });
    const ops: FuseOperations = createFuseOperations(core, { mode: "read-write" });

    const [openCode, fd] = await invoke(ops.open, "/runs/today/result.md", fsConstants.O_WRONLY | fsConstants.O_APPEND);
    expect(openCode).toBe(0);
    if (typeof fd !== "number") throw new Error("open did not return a file descriptor.");
    await invoke(ops.write, "/runs/today/result.md", fd, Buffer.from("\nagain"), 6, 0);
    await invoke(ops.release, "/runs/today/result.md", fd);

    expect(core.writes.at(-1)).toEqual({ path: "/runs/today/result.md", content: "hello\nagain" });
  });

  it("maps unlink, rename, and truncate to mount-core", async () => {
    const core = fakeCore({ "/runs/today/result.md": "hello" });
    const ops: FuseOperations = createFuseOperations(core, { mode: "read-write" });

    expect((await invoke(ops.unlink, "/runs/today/result.md"))[0]).toBe(0);
    expect(core.unlinks).toEqual(["/runs/today/result.md"]);

    expect((await invoke(ops.rename, "/runs/today/a.md", "/runs/today/b.md"))[0]).toBe(0);
    expect(core.renames).toEqual([{ from: "/runs/today/a.md", to: "/runs/today/b.md" }]);

    expect((await invoke(ops.truncate, "/runs/today/b.md", 0))[0]).toBe(0);
    expect(core.truncates).toEqual([{ path: "/runs/today/b.md", size: 0 }]);
  });

  it("maps mount-core errors to FUSE errors", () => {
    expect(fuseErrorCode(new MountCoreError("EACCES", "denied"))).toBe(-13);
    expect(fuseErrorCode(new MountCoreError("RESERVED_PATH", "reserved"))).toBe(-13);
    expect(fuseErrorCode(new MountCoreError("ENOENT", "missing"))).toBe(-2);
  });
});

describe("mount registry", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("ignores missing registry files", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "memfs-mountd-test-"));
    const env = { MEMFS_CONFIG_DIR: tempDir };

    expect(mountRegistryPath(env)).toBe(path.join(tempDir, "mounts.json"));
    expect(await listMountRegistry(env)).toEqual([]);
  });

  it("filters dead pids from status", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "memfs-mountd-test-"));
    const env = { MEMFS_CONFIG_DIR: tempDir };
    await writeFile(
      mountRegistryPath(env),
      JSON.stringify([
        {
          mountpoint: "/tmp/memfs",
          workspaceId: "ws",
          workspaceName: "demo",
          pid: 99999999,
          mode: "read-write",
          apiUrl: "http://localhost:3131",
          actor: "mount:test",
          startedAt: new Date().toISOString()
        }
      ])
    );

    expect(await listMountRegistry(env)).toEqual([]);
  });
});

function fakeCore(initialFiles: Record<string, string> = {}): MountCore & {
  writes: Array<{ path: string; content: string }>;
  unlinks: string[];
  renames: Array<{ from: string; to: string }>;
  truncates: Array<{ path: string; size: number }>;
} {
  const files = new Map(Object.entries(initialFiles));
  return {
    writes: [],
    unlinks: [],
    renames: [],
    truncates: [],
    async stat(filePath) {
      return { path: filePath, type: "file", size: files.get(filePath)?.length ?? 0, atime: new Date(), ctime: new Date(), mtime: new Date() };
    },
    async list() {
      return [];
    },
    async read(filePath) {
      if (!files.has(filePath)) throw new MountCoreError("ENOENT", "missing");
      return Buffer.from(files.get(filePath)!);
    },
    async write(filePath, bytes) {
      const content = Buffer.from(bytes).toString("utf8");
      files.set(filePath, content);
      this.writes.push({ path: filePath, content });
      return { path: filePath, bytesWritten: bytes.byteLength };
    },
    async append(filePath, bytes) {
      const content = `${files.get(filePath) ?? ""}${Buffer.from(bytes).toString("utf8")}`;
      files.set(filePath, content);
      return { path: filePath, bytesWritten: bytes.byteLength };
    },
    async mkdir(filePath) {
      return { ok: true, path: filePath };
    },
    async unlink(filePath) {
      this.unlinks.push(filePath);
      return { ok: true, path: filePath };
    },
    async rmdir(filePath) {
      return { ok: true, path: filePath };
    },
    async rename(from, to) {
      this.renames.push({ from, to });
      return { ok: true, path: to };
    },
    async truncate(filePath, size) {
      this.truncates.push({ path: filePath, size });
      return { ok: true, path: filePath };
    },
    async flush(filePath) {
      return { ok: true, path: filePath };
    },
    async getStatus() {
      return {
        workspaceId: "ws",
        workspaceName: "demo",
        actor: "mount:test",
        mode: "read-write",
        ingestOnWrite: false,
        allowProtectedWrite: false,
        enableControlDir: true,
        fileCount: files.size,
        transientDirectoryCount: 0,
        lastRecallQuery: null,
        lastSearchQuery: null,
        lastRecallAt: null,
        lastSearchAt: null,
        lastBriefQuery: null,
        lastBriefAt: null,
        requestedTrustLevel: null,
        defaultRunFolder: null,
        mountedAt: new Date().toISOString(),
        apiUrl: null
      };
    },
    async dispose() {}
  };
}

type FuseTestOperation<TArgs extends unknown[], TResult extends unknown[]> = (
  ...args: [...TArgs, (...callbackArgs: TResult) => void]
) => void | Promise<void>;

async function invoke<TArgs extends unknown[], TResult extends unknown[]>(
  fn: FuseTestOperation<TArgs, TResult>,
  ...args: TArgs
): Promise<TResult> {
  return new Promise((resolve) => {
    void fn(...args, (...callbackArgs: TResult) => resolve(callbackArgs));
  });
}
