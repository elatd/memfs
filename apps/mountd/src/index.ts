#!/usr/bin/env node
import {
  MountCoreError,
  createHttpMountClient,
  createMountCore,
  normalizeMountPath,
  type MountCore,
  type MountMode,
  type MountNodeType
} from "@verifs/mount-core";
import { VeriFSClient } from "@verifs/sdk";
import { constants as fsConstants } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, platform, userInfo } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export interface MountdConfig {
  workspace: string;
  mountpoint: string;
  apiUrl: string;
  mode: MountMode;
  ingestOnWrite: boolean;
  allowProtectedWrite: boolean;
  trustLevel?: string;
  defaultRunFolder?: string;
  actor: string;
  createMountpoint: boolean;
  allowNonEmpty: boolean;
  daemon: boolean;
}

export interface MountRegistryEntry {
  mountpoint: string;
  workspaceId: string;
  workspaceName: string | null;
  pid: number;
  mode: MountMode;
  apiUrl: string;
  actor: string;
  startedAt: string;
}

interface FileHandle {
  path: string;
  buffer: Buffer | null;
  dirty: boolean;
  append: boolean;
  writing: boolean;
}

export interface FuseConstants {
  ENOENT: number;
  EISDIR: number;
  ENOTDIR: number;
  EROFS: number;
  EACCES: number;
  EINVAL: number;
  ENOTEMPTY: number;
  ENOTSUP: number;
  EBUSY: number;
  EBADF: number;
}

export interface FuseStat {
  mtime: Date;
  atime: Date;
  ctime: Date;
  size: number;
  mode: number;
  uid: number;
  gid: number;
}

export interface FuseMountOptions {
  debug?: boolean;
  force?: boolean;
  mkdir?: boolean;
  [option: string]: unknown;
}

export type FuseCallback<T = void> = (errorCode: number, arg?: T) => void;

type FuseOperationResult = void | Promise<void>;
type FuseResultCallback = (resultOrErrorCode: number) => void;

export interface FuseOperations {
  getattr(filePath: string, callback: FuseCallback<FuseStat>): FuseOperationResult;
  readdir(dirPath: string, callback: FuseCallback<string[]>): FuseOperationResult;
  open(filePath: string, flags: number, callback: FuseCallback<number>): FuseOperationResult;
  create(filePath: string, mode: number, callback: FuseCallback<number>): FuseOperationResult;
  read(
    filePath: string,
    fd: number,
    buffer: Buffer,
    length: number,
    position: number,
    callback: FuseResultCallback
  ): FuseOperationResult;
  write(
    filePath: string,
    fd: number,
    buffer: Buffer,
    length: number,
    position: number,
    callback: FuseResultCallback
  ): FuseOperationResult;
  flush(filePath: string, fd: number, callback: FuseCallback): FuseOperationResult;
  fsync(filePath: string, fd: number, datasync: number, callback: FuseCallback): FuseOperationResult;
  release(filePath: string, fd: number, callback: FuseCallback): FuseOperationResult;
  unlink(filePath: string, callback: FuseCallback): FuseOperationResult;
  mkdir(dirPath: string, mode: number, callback: FuseCallback): FuseOperationResult;
  rmdir(dirPath: string, callback: FuseCallback): FuseOperationResult;
  rename(from: string, to: string, callback: FuseCallback): FuseOperationResult;
  truncate(filePath: string, size: number, callback: FuseCallback): FuseOperationResult;
  ftruncate(filePath: string, fd: number, size: number, callback: FuseCallback): FuseOperationResult;
  destroy(callback: FuseCallback): FuseOperationResult;
}

interface FuseInstance {
  mount(callback: (error?: Error | null) => void): void;
  unmount(callback: (error?: Error | null) => void): void;
}

interface FuseConstructor extends Partial<FuseConstants> {
  new (mountpoint: string, operations: FuseOperations, options?: FuseMountOptions): FuseInstance;
  isConfigured?: (callback: (error: Error | null, configured?: boolean) => void) => void;
}

export function parseMountdArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): MountdConfig {
  const positional: string[] = [];
  let apiUrl = env.VERIFS_API_URL ?? "http://localhost:3131";
  let readOnly = false;
  let readWrite = false;
  let ingestOnWrite = false;
  let allowProtectedWrite = false;
  let trustLevel: string | undefined;
  let defaultRunFolder: string | undefined;
  let actor: string | undefined;
  let createMountpoint = false;
  let allowNonEmpty = false;
  let daemon = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--api-url") apiUrl = requireNext(argv, ++index, "--api-url requires a value.");
    else if (arg === "--read-only") readOnly = true;
    else if (arg === "--read-write") readWrite = true;
    else if (arg === "--ingest-on-write") ingestOnWrite = true;
    else if (arg === "--allow-protected-write") allowProtectedWrite = true;
    else if (arg === "--trust-level") trustLevel = requireNext(argv, ++index, "--trust-level requires a value.");
    else if (arg === "--default-run-folder") defaultRunFolder = requireNext(argv, ++index, "--default-run-folder requires a value.");
    else if (arg === "--actor") actor = requireNext(argv, ++index, "--actor requires a value.");
    else if (arg === "--create-mountpoint") createMountpoint = true;
    else if (arg === "--allow-non-empty") allowNonEmpty = true;
    else if (arg === "--daemon") daemon = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown mountd flag: ${arg}`);
    else positional.push(arg);
  }

  if (readOnly && readWrite) throw new Error("--read-only and --read-write are mutually exclusive.");
  const [workspace, mountpoint] = positional;
  if (!workspace || !mountpoint) {
    throw new Error("Usage: verifs-mountd <workspace> <mountpoint> [--read-only|--read-write]");
  }

  return {
    workspace,
    mountpoint: path.resolve(expandHome(mountpoint, env.HOME)),
    apiUrl,
    mode: readWrite ? "read-write" : "read-only",
    ingestOnWrite,
    allowProtectedWrite,
    trustLevel,
    defaultRunFolder,
    actor: actor ?? defaultMountActor(),
    createMountpoint,
    allowNonEmpty,
    daemon
  };
}

export function createFuseOperations(core: MountCore, options: { mode: MountMode; constants?: Partial<FuseConstants> }): FuseOperations {
  const constants = completeFuseConstants(options.constants);
  let nextFd = 42;
  const handles = new Map<number, FileHandle>();
  const run = (callback: (errorCode: number) => void, task: () => Promise<void>) =>
    runFuseOperation(task, callback, constants);
  const rejectReadOnly = (callback: (errorCode: number) => void): boolean => {
    if (options.mode !== "read-only") return false;
    callback(constants.EROFS);
    return true;
  };

  return {
    getattr: (filePath: string, callback: FuseCallback<FuseStat>) =>
      run(callback, async () => {
        const mountStat = await core.stat(filePath);
        callback(0, toFuseStat(mountStat.type, mountStat.size, mountStat.mtime));
      }),

    readdir: (dirPath: string, callback: FuseCallback<string[]>) =>
      run(callback, async () => {
        const entries = await core.list(dirPath);
        callback(0, entries.map((entry) => entry.name));
      }),

    open: (filePath: string, flags: number, callback: FuseCallback<number>) =>
      run(callback, async () => {
        const wantsWrite = isWriteFlag(flags);
        const normalized = normalizeMountPath(filePath);
        if (wantsWrite && options.mode === "read-only" && !isControlQueryPath(normalized)) {
          callback(constants.EROFS);
          return;
        }
        if (wantsWrite) {
          ensureNoDirtyHandle(handles, normalized);
          const truncate = Boolean(flags & fsConstants.O_TRUNC);
          const append = Boolean(flags & fsConstants.O_APPEND);
          let buffer = Buffer.alloc(0);
          if (!truncate) {
            try {
              buffer = Buffer.from(await core.read(normalized));
            } catch (error) {
              if (!(error instanceof MountCoreError && error.code === "ENOENT")) throw error;
            }
          }
          const fd = nextFd++;
          handles.set(fd, { path: normalized, buffer, dirty: false, append, writing: true });
          callback(0, fd);
          return;
        }

        await core.stat(normalized);
        const fd = nextFd++;
        handles.set(fd, { path: normalized, buffer: null, dirty: false, append: false, writing: false });
        callback(0, fd);
      }),

    create: (filePath: string, _mode: number, callback: FuseCallback<number>) =>
      run(callback, async () => {
        if (rejectReadOnly(callback)) return;
        const normalized = normalizeMountPath(filePath);
        ensureNoDirtyHandle(handles, normalized);
        const fd = nextFd++;
        handles.set(fd, { path: normalized, buffer: Buffer.alloc(0), dirty: true, append: false, writing: true });
        callback(0, fd);
      }),

    read: (filePath: string, fd: number, buffer: Buffer, length: number, position: number, callback: FuseResultCallback) =>
      run(callback, async () => {
        const handle = handles.get(fd);
        const bytes = handle?.buffer ?? Buffer.from(await core.read(filePath));
        if (position >= bytes.byteLength) {
          callback(0);
          return;
        }
        const slice = bytes.subarray(position, Math.min(position + length, bytes.byteLength));
        slice.copy(buffer);
        callback(slice.byteLength);
      }),

    write: (_filePath: string, fd: number, buffer: Buffer, length: number, position: number, callback: FuseResultCallback) =>
      run(callback, async () => {
        const handle = handles.get(fd);
        if (!handle || !handle.writing || !handle.buffer) {
          callback(constants.EBADF);
          return;
        }
        const chunk = Buffer.from(buffer.subarray(0, length));
        const offset = handle.append ? handle.buffer.byteLength : Math.max(0, position);
        handle.buffer = applyWrite(handle.buffer, chunk, offset);
        handle.dirty = true;
        callback(length);
      }),

    flush: (_filePath: string, fd: number, callback: FuseCallback) =>
      run(callback, async () => {
        await commitHandle(core, handles.get(fd));
        callback(0);
      }),

    fsync: (_filePath: string, fd: number, _datasync: number, callback: FuseCallback) =>
      run(callback, async () => {
        await commitHandle(core, handles.get(fd));
        callback(0);
      }),

    release: (_filePath: string, fd: number, callback: FuseCallback) =>
      run(callback, async () => {
        const handle = handles.get(fd);
        try {
          await commitHandle(core, handle);
        } finally {
          handles.delete(fd);
        }
        callback(0);
      }),

    unlink: (filePath: string, callback: FuseCallback) =>
      run(callback, async () => {
        if (rejectReadOnly(callback)) return;
        await core.unlink(filePath);
        callback(0);
      }),

    mkdir: (dirPath: string, _mode: number, callback: FuseCallback) =>
      run(callback, async () => {
        if (rejectReadOnly(callback)) return;
        await core.mkdir(dirPath);
        callback(0);
      }),

    rmdir: (dirPath: string, callback: FuseCallback) =>
      run(callback, async () => {
        if (rejectReadOnly(callback)) return;
        await core.rmdir(dirPath);
        callback(0);
      }),

    rename: (from: string, to: string, callback: FuseCallback) =>
      run(callback, async () => {
        if (rejectReadOnly(callback)) return;
        await core.rename(from, to);
        callback(0);
      }),

    truncate: (filePath: string, size: number, callback: FuseCallback) =>
      run(callback, async () => {
        if (rejectReadOnly(callback)) return;
        await core.truncate(filePath, size);
        callback(0);
      }),

    ftruncate: (_filePath: string, fd: number, size: number, callback: FuseCallback) =>
      run(callback, async () => {
        const handle = handles.get(fd);
        if (!handle || !handle.writing || !handle.buffer) {
          callback(constants.EBADF);
          return;
        }
        handle.buffer = resizeBuffer(handle.buffer, size);
        handle.dirty = true;
        callback(0);
      }),

    destroy: (callback: FuseCallback) =>
      run(callback, async () => {
        await core.dispose();
        callback(0);
      })
  };
}

export function isWriteFlag(flags: number): boolean {
  const accessMode = flags & 3;
  return accessMode === fsConstants.O_WRONLY ||
    accessMode === fsConstants.O_RDWR ||
    Boolean(flags & fsConstants.O_TRUNC) ||
    Boolean(flags & fsConstants.O_APPEND) ||
    Boolean(flags & fsConstants.O_CREAT);
}

export function fuseErrorCode(error: unknown, constants: Partial<FuseConstants> = fallbackFuseConstants): number {
  const complete = completeFuseConstants(constants);
  if (error instanceof MountCoreError) {
    switch (error.code) {
      case "ENOENT":
        return complete.ENOENT;
      case "EISDIR":
        return complete.EISDIR;
      case "ENOTDIR":
        return complete.ENOTDIR;
      case "EROFS":
        return complete.EROFS;
      case "EACCES":
      case "RESERVED_PATH":
        return complete.EACCES;
      case "EINVAL":
        return complete.EINVAL;
      case "ENOTEMPTY":
        return complete.ENOTEMPTY;
      case "ENOTSUP":
        return complete.ENOTSUP;
      case "EBUSY":
        return complete.EBUSY;
      default:
        return complete.EINVAL;
    }
  }
  return complete.EINVAL;
}

async function runFuseOperation(
  task: () => Promise<void>,
  callback: (errorCode: number) => void,
  constants: FuseConstants
): Promise<void> {
  try {
    await task();
  } catch (error) {
    callback(fuseErrorCode(error, constants));
  }
}

export async function runMountd(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = parseMountdArgs(argv, env);
  const Fuse = await loadFuse();
  await assertFuseConfigured(Fuse);
  await validateMountpoint(config);

  const client = new VeriFSClient(config.apiUrl);
  const workspaces = await client.listWorkspaces();
  const workspace = workspaces.find((entry) => entry.id === config.workspace || entry.name === config.workspace);
  if (!workspace) throw new Error(`Workspace not found: ${config.workspace}`);

  const core = createMountCore({
    workspaceId: workspace.id,
    apiClient: createHttpMountClient({ client }),
    mode: config.mode,
    ingestOnWrite: config.ingestOnWrite,
    allowProtectedWrite: config.allowProtectedWrite,
    trustLevel: config.trustLevel,
    defaultRunFolder: config.defaultRunFolder,
    apiUrl: config.apiUrl,
    actor: config.actor,
    enableControlDir: true
  });
  const operations = createFuseOperations(core, {
    mode: config.mode,
    constants: fuseConstantsFrom(Fuse)
  });
  const fuse = new Fuse(config.mountpoint, operations, {
    debug: false,
    force: config.allowNonEmpty,
    mkdir: false
  });

  await new Promise<void>((resolve, reject) => {
    fuse.mount((error?: Error | null) => error ? reject(error) : resolve());
  });

  const entry: MountRegistryEntry = {
    mountpoint: config.mountpoint,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    pid: process.pid,
    mode: config.mode,
    apiUrl: config.apiUrl,
    actor: config.actor,
    startedAt: new Date().toISOString()
  };
  await upsertMountRegistryEntry(entry, env);
  await client.recordAuditEvent(workspace.id, {
    actor: config.actor,
    event_type: "mount.started",
    payload: {
      mountpoint: config.mountpoint,
      mode: config.mode,
      ingest_on_write: config.ingestOnWrite,
      allow_protected_write: config.allowProtectedWrite,
      trust_level: config.trustLevel ?? null,
      default_run_folder: config.defaultRunFolder ?? null
    }
  }).catch(() => null);
  console.log(`VeriFS mounted ${workspace.name} at ${config.mountpoint} (${config.mode}).`);

  let unmounting = false;
  const unmount = async () => {
    if (unmounting) return;
    unmounting = true;
    await new Promise<void>((resolve) => {
      fuse.unmount(() => resolve());
    });
    await removeMountRegistryEntry(config.mountpoint, env);
    await core.dispose();
    await client.recordAuditEvent(workspace.id, {
      actor: config.actor,
      event_type: "mount.stopped",
      payload: {
        mountpoint: config.mountpoint,
        mode: config.mode
      }
    }).catch(() => null);
  };
  process.once("SIGINT", () => {
    void unmount().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void unmount().finally(() => process.exit(0));
  });

  await new Promise(() => undefined);
}

export async function listMountRegistry(env: NodeJS.ProcessEnv = process.env): Promise<MountRegistryEntry[]> {
  const entries = await readMountRegistry(env);
  return entries.filter((entry) => isPidAlive(entry.pid));
}

export async function unmountMount(mountpoint: string, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; message: string }> {
  const resolved = path.resolve(expandHome(mountpoint, env.HOME));
  const commands: Array<[string, string[]]> = platform() === "linux"
    ? [["fusermount3", ["-u", resolved]], ["fusermount", ["-u", resolved]], ["umount", [resolved]]]
    : [["diskutil", ["unmount", "force", resolved]], ["umount", [resolved]]];

  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8" });
    if (result.status === 0) {
      await removeMountRegistryEntry(resolved, env);
      return { ok: true, message: `Unmounted ${resolved}` };
    }
  }

  return { ok: false, message: `Unable to unmount ${resolved}. Try your platform unmount command manually.` };
}

export function mountRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.VERIFS_CONFIG_DIR ?? path.join(env.HOME ?? homedir(), ".verifs"), "mounts.json");
}

async function loadFuse(): Promise<FuseConstructor> {
  try {
    const require = createRequire(import.meta.url);
    return require("fuse-native") as FuseConstructor;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MountCoreError(
      "ENOTSUP",
      `FUSE is unavailable. Install macFUSE/FUSE and optional dependency fuse-native. Details: ${message}`,
      error,
      "MOUNT_FUSE_UNAVAILABLE"
    );
  }
}

async function assertFuseConfigured(Fuse: { isConfigured?: (callback: (error: Error | null, configured?: boolean) => void) => void }): Promise<void> {
  if (!Fuse.isConfigured) return;
  const configured = await new Promise<boolean>((resolve, reject) => {
    Fuse.isConfigured!((error, value) => error ? reject(error) : resolve(Boolean(value)));
  });
  if (!configured) throw new Error("FUSE is installed but not configured for this system.");
}

async function validateMountpoint(config: MountdConfig): Promise<void> {
  try {
    const mountpointStat = await stat(config.mountpoint);
    if (!mountpointStat.isDirectory()) throw new Error(`Mountpoint is not a directory: ${config.mountpoint}`);
  } catch (error) {
    if (config.createMountpoint) {
      await mkdir(config.mountpoint, { recursive: true });
    } else {
      throw new Error(`Mountpoint does not exist: ${config.mountpoint}. Pass --create-mountpoint to create it.`);
    }
  }

  if (!config.allowNonEmpty) {
    const entries = await readdir(config.mountpoint);
    if (entries.length > 0) throw new Error(`Mountpoint is not empty: ${config.mountpoint}. Pass --allow-non-empty to override.`);
  }
}

async function commitHandle(core: MountCore, handle: FileHandle | undefined): Promise<void> {
  if (!handle || !handle.writing || !handle.dirty || !handle.buffer) return;
  await core.write(handle.path, handle.buffer);
  handle.dirty = false;
}

function ensureNoDirtyHandle(handles: Map<number, FileHandle>, filePath: string): void {
  for (const handle of handles.values()) {
    if (handle.path === filePath && handle.dirty) {
      throw new MountCoreError("EBUSY", `A dirty write handle is already open for ${filePath}.`);
    }
  }
}

function applyWrite(existing: Buffer, chunk: Buffer, offset: number): Buffer {
  const size = Math.max(existing.byteLength, offset + chunk.byteLength);
  const next = Buffer.alloc(size);
  existing.copy(next);
  chunk.copy(next, offset);
  return next;
}

function resizeBuffer(existing: Buffer, size: number): Buffer {
  if (!Number.isSafeInteger(size) || size < 0) throw new MountCoreError("EINVAL", `Invalid truncate size: ${size}`);
  if (existing.byteLength >= size) return existing.subarray(0, size);
  return Buffer.concat([existing, Buffer.alloc(size - existing.byteLength)]);
}

function isControlQueryPath(filePath: string): boolean {
  return filePath === "/.verifs/recall.query" || filePath === "/.verifs/search.query" || filePath === "/.verifs/brief.query";
}

function toFuseStat(type: MountNodeType, size: number, timestamp: Date): FuseStat {
  return {
    mtime: timestamp,
    atime: timestamp,
    ctime: timestamp,
    size,
    mode: type === "directory" ? 0o040755 : 0o100644,
    uid: typeof process.getuid === "function" ? process.getuid() : 0,
    gid: typeof process.getgid === "function" ? process.getgid() : 0
  };
}

function fuseConstantsFrom(Fuse: Partial<FuseConstants>): Partial<FuseConstants> {
  return {
    ENOENT: Fuse.ENOENT,
    EISDIR: Fuse.EISDIR,
    ENOTDIR: Fuse.ENOTDIR,
    EROFS: Fuse.EROFS,
    EACCES: Fuse.EACCES,
    EINVAL: Fuse.EINVAL,
    ENOTEMPTY: Fuse.ENOTEMPTY,
    ENOTSUP: Fuse.ENOTSUP,
    EBUSY: Fuse.EBUSY,
    EBADF: Fuse.EBADF
  };
}

function completeFuseConstants(constants: Partial<FuseConstants> = {}): FuseConstants {
  const complete = { ...fallbackFuseConstants };
  for (const key of fuseConstantKeys) {
    const value = constants[key];
    if (typeof value === "number") complete[key] = value;
  }
  return complete;
}

async function readMountRegistry(env: NodeJS.ProcessEnv): Promise<MountRegistryEntry[]> {
  try {
    return JSON.parse(await readFile(mountRegistryPath(env), "utf8")) as MountRegistryEntry[];
  } catch {
    return [];
  }
}

async function writeMountRegistry(entries: MountRegistryEntry[], env: NodeJS.ProcessEnv): Promise<void> {
  const filePath = mountRegistryPath(env);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`);
}

async function upsertMountRegistryEntry(entry: MountRegistryEntry, env: NodeJS.ProcessEnv): Promise<void> {
  const entries = (await readMountRegistry(env)).filter((existing) => existing.mountpoint !== entry.mountpoint);
  entries.push(entry);
  await writeMountRegistry(entries, env);
}

async function removeMountRegistryEntry(mountpoint: string, env: NodeJS.ProcessEnv): Promise<void> {
  const resolved = path.resolve(expandHome(mountpoint, env.HOME));
  const entries = (await readMountRegistry(env)).filter((entry) => entry.mountpoint !== resolved);
  await writeMountRegistry(entries, env);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function requireNext(argv: string[], index: number, message: string): string {
  const value = argv[index];
  if (!value) throw new Error(message);
  return value;
}

function expandHome(inputPath: string, home = homedir()): string {
  return inputPath === "~" || inputPath.startsWith("~/")
    ? path.join(home ?? homedir(), inputPath.slice(2))
    : inputPath;
}

function defaultMountActor(): string {
  try {
    const username = userInfo().username;
    return username ? `mount:${username}` : "mount:local";
  } catch {
    return "mount:local";
  }
}

const fuseConstantKeys = [
  "ENOENT",
  "EISDIR",
  "ENOTDIR",
  "EROFS",
  "EACCES",
  "EINVAL",
  "ENOTEMPTY",
  "ENOTSUP",
  "EBUSY",
  "EBADF"
] as const satisfies readonly (keyof FuseConstants)[];

const fallbackFuseConstants: FuseConstants = {
  ENOENT: -2,
  EISDIR: -21,
  ENOTDIR: -20,
  EROFS: -30,
  EACCES: -13,
  EINVAL: -22,
  ENOTEMPTY: -39,
  ENOTSUP: -95,
  EBUSY: -16,
  EBADF: -9
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMountd(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
