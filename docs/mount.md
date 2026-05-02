# VeriFS Mount

VeriFS can expose a workspace as a local filesystem mount through `apps/mountd`. The mount is backed by `@verifs/mount-core`, so file writes still go through the VeriFS API/core path, protected path checks, blob storage, ingestion options, and audit events.

Mount support is optional. If FUSE is not available, `mount-core` and the regular API/CLI continue to work.

## Install FUSE Support

The daemon dynamically loads the optional `fuse-native` package.

On macOS:

1. Install macFUSE from <https://macfuse.github.io/>.
2. Allow the system extension if macOS prompts for it.
3. Reboot if macFUSE asks.

On Linux:

1. Install FUSE 3 with your package manager.
2. Make sure `fusermount3` or `fusermount` is available.

If FUSE is unavailable, mount smoke tests print a skip reason unless `VERIFS_REQUIRE_FUSE_TEST=1` is set.

## Read-Only Mode

Read-only is the default.

```bash
pnpm dev
mkdir -p ~/VeriFS/demo
pnpm exec verifs mount demo ~/VeriFS/demo --read-only
```

Expected behavior:

- `ls ~/VeriFS/demo` lists workspace files and directories.
- `cat ~/VeriFS/demo/runs/.../result.md` reads VeriFS file content.
- `ls ~/VeriFS/demo/.verifs` shows virtual control files.
- `cat ~/VeriFS/demo/.verifs/README.md` and `status.json` work.

Read-only mode rejects normal file writes with a read-only filesystem error.

## Read-Write Mode

Write-through mode must be explicit:

```bash
pnpm exec verifs mount demo ~/VeriFS/demo --read-write
```

Mounted writes call VeriFS file APIs. The mount never writes directly to the workspace data directory.

Examples:

```bash
mkdir -p ~/VeriFS/demo/runs/today
echo "hello" > ~/VeriFS/demo/runs/today/result.md
echo "again" >> ~/VeriFS/demo/runs/today/result.md
pnpm exec verifs cat /runs/today/result.md
```

Append uses per-file-handle buffering and commits on `flush` or `release`, so a `flush` followed by `release` does not duplicate content.

## Ingestion

By default, mount writes do not ingest memory:

```bash
pnpm exec verifs mount demo ~/VeriFS/demo --read-write
```

Enable ingestion explicitly:

```bash
pnpm exec verifs mount demo ~/VeriFS/demo --read-write --ingest-on-write
```

Every write uses the mount actor. The default actor is `mount:<os-username>` when available, otherwise `mount:local`.

Override it:

```bash
pnpm exec verifs mount demo ~/VeriFS/demo --read-write --actor mount:agent
```

When ingestion is enabled, VeriFS core applies the existing path-based trust policy:

- `/scratch/` ingested nodes are ephemeral.
- `/runs/` ingested nodes are agent-generated.
- Durable paths are source-backed, and protected durable paths still require explicit write permission.

The mount accepts `--trust-level <level>` as metadata for status and audit records, but it does not override core's path-based trust policy.

## Protected Paths

Protected paths are denied by default, even in read-write mode:

- `/profile.md`
- `/preferences.md`
- `/projects/*/decisions.md`
- `/projects/*/constraints.md`

Denied protected writes and deletes are audited by core/API.

Allow protected writes only when you mean it:

```bash
pnpm exec verifs mount demo ~/VeriFS/demo --read-write --allow-protected-write
```

Protected path errors are reported as:

```text
Protected path denied. Re-run mount with --allow-protected-write or write to /runs/ and promote later.
```

The structured mount error code is `MOUNT_PROTECTED_PATH_DENIED`.

## Run Folders

Agents should write task output under `/runs/` by default:

```bash
mkdir -p ~/VeriFS/demo/runs/today
echo "Implemented mount lifecycle checks." >> ~/VeriFS/demo/runs/today/result.md
```

The CLI also has helpers:

```bash
pnpm exec verifs run today
pnpm exec verifs run path <run_id>
```

## Control Directory

`/.verifs` is reserved and cannot be overwritten as normal workspace files.

Virtual files:

- `/.verifs/README.md`
- `/.verifs/status.json`
- `/.verifs/recall.query`
- `/.verifs/recall.results.md`
- `/.verifs/search.query`
- `/.verifs/search.results.md`
- `/.verifs/brief.query`
- `/.verifs/brief.results.md`
- `/.verifs/audit.md`
- `/.verifs/health.md`

`README.md` includes examples for using the control directory through ordinary file reads and writes.

`status.json` includes the workspace id/name, mount mode, actor, `ingestOnWrite`, `allowProtectedWrite`, `mountedAt`, API URL, and the most recent recall/search/brief query times for this mount session.

Writing `search.query` runs meaning-oriented hybrid search and updates `search.results.md` for this mount session only.

```bash
echo "OAuth refresh tokens" > ~/VeriFS/demo/.verifs/search.query
cat ~/VeriFS/demo/.verifs/search.results.md
```

Writing `recall.query` runs normal trusted recall rules and updates `recall.results.md`. Stale, rejected, and superseded memories are excluded by default; raw source content is not returned.

```bash
echo "backend preference" > ~/VeriFS/demo/.verifs/recall.query
cat ~/VeriFS/demo/.verifs/recall.results.md
```

Writing `brief.query` creates a compact pre-task memory brief and updates `brief.results.md`.

```bash
echo "Fix OAuth refresh token flow" > ~/VeriFS/demo/.verifs/brief.query
cat ~/VeriFS/demo/.verifs/brief.results.md
```

Search, recall, and brief results include `source_path`, trust level, score, memory node id, and `raw_ref`. They also include a warning that raw source must be read explicitly by opening the referenced source file or using raw-source tools.

Control query writes emit `mount.recall.query`, `mount.search.query`, or `mount.brief.query` audit events when audit support is available.

The `.verifs` namespace is reserved:

- control files are not normal workspace files
- `rm .verifs` and `rm .verifs/*` fail
- rename into or out of `.verifs` fails
- normal writes cannot overwrite control files, except query writes to `recall.query`, `search.query`, and `brief.query`

## Audit Events

Mount lifecycle and file operations use the regular VeriFS audit table when supported:

- `mount.started`
- `mount.stopped`
- `mount.file.read`
- `mount.file.write`
- `mount.file.delete`
- `mount.protected_write.denied`
- `mount.recall.query`
- `mount.search.query`
- `mount.brief.query`

Core/API file events such as `file_write`, `file_delete`, `protected_write_denied`, and `memory_ingest_file` are still emitted by the underlying VeriFS operations.

## Unmount and Status

```bash
pnpm exec verifs mount status
pnpm exec verifs unmount ~/VeriFS/demo
```

The CLI records active mount metadata under `~/.verifs/mounts.json` or `VERIFS_CONFIG_DIR/mounts.json`.

## Smoke Test

```bash
pnpm mount:smoke:readwrite
```

The smoke test:

1. Starts the API.
2. Creates a demo workspace.
3. Mounts read-write.
4. Writes and appends through the mounted filesystem.
5. Verifies API visibility.
6. Attempts a protected write and checks the audit event.
7. Unmounts.

If FUSE is unavailable, it prints `SKIP` and exits successfully. Set `VERIFS_REQUIRE_FUSE_TEST=1` to make missing FUSE fail the test.

## Known Limitations

- Directory metadata is transient and synthesized from file paths.
- Empty directories are not durable workspace objects.
- Directory rename is not supported in this MVP.
- File rename is implemented as read, write new path, then delete old path.
- Sparse writes zero-fill gaps.
- Binary writes use the existing upload API; text reads remain the common path for current VeriFS files.
