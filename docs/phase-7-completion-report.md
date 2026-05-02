# Mounted Filesystem Completion Report

Date: 2026-05-01

## Implemented Capabilities

- CLI mount workflow: `memfs mount`, `memfs unmount`, and `memfs mount status`.
- Mount core: pure TypeScript `@memoryfs/mount-core` with read-only, read-write, protected-path checks, write-through API/core calls, and `.memfs` virtual controls.
- Mount daemon: optional FUSE-backed `@memoryfs/mountd` with read and write operations where `fuse-native` is available.
- `.memfs` control directory: status, recall query/results, search query/results, audit, health, and README files.
- Audit coverage for mount lifecycle, reads, writes, deletes, protected denials, recall queries, and search queries where audit support is available.
- Virtual bash agent UX: file operations, exact grep, meaning-oriented search, recall, brief, run lifecycle, promotions, health, and sync status.

## Safety Fixes

- Virtual bash no longer bypasses protected paths.
- `write`, `append`, and `rm` now default to `allow_protected_write=false`, matching CLI and mount behavior.
- Protected write override is only available through shell construction with `allowProtectedWrite: true`; it is not exposed as a virtual bash command flag.
- Protected denials continue to flow through MemFS core, preserving core audit events such as `protected_write_denied` and `protected_delete_denied`.

## CI Behavior

- `.github/workflows/ci.yml` runs on push and pull request.
- The standard CI job uses Node 20 and `pnpm install --frozen-lockfile`.
- Mount-core tests always run explicitly with:

```bash
pnpm exec vitest run packages/mount-core/src/mount-core.test.ts
```

- The standard CI job also runs:

```bash
pnpm test
pnpm typecheck
```

- OS mount smoke tests run on `ubuntu-latest` and `macos-14` with:

```bash
pnpm mount:smoke:readwrite
```

- The smoke script exits successfully with a clear `SKIP` message when FUSE or the native adapter is unavailable. Set `MEMFS_REQUIRE_FUSE_TEST=1` to make missing FUSE fail.

## FUSE Verification

### macOS Local Attempt

Environment:

- OS: Darwin arm64, kernel `25.4.0`
- Node: `v24.14.0`
- Command: `pnpm mount:smoke:readwrite`

Result:

```text
SKIP: FUSE is unavailable in this environment: No native build was found for platform=darwin arch=arm64 runtime=node abi=137 uv=1 armv=8 libc=glibc node=24.14.0
    loaded from: /Users/abasa/Projects/memfs/node_modules/.pnpm/fuse-native@2.2.6/node_modules/fuse-native
```

No real macOS mount success is claimed from this run because the native `fuse-native` adapter did not load in the local Node 24 environment.

### Linux

No local Linux FUSE host was available in this session. Linux coverage is configured through the `ubuntu-latest` CI smoke job. If FUSE is unavailable or blocked in CI, the job reports `SKIP` with the reason and exits successfully unless `MEMFS_REQUIRE_FUSE_TEST=1` is set.

## Known Limitations

- Directory metadata is transient and synthesized from file paths.
- Empty directories are not durable workspace objects.
- Directory rename is not supported in the current mount layer.
- File rename is implemented as read, write new path, then delete old path.
- Sparse mounted writes zero-fill gaps.
- Real OS mount behavior depends on platform FUSE support and a compatible `fuse-native` native build.
