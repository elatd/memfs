# MemFS Roadmap Implementation Map

Date: 2026-05-01

This audit covers the current `elatd/memfs` monorepo surfaces:

- Top-level: `README.md`, `package.json`, `pnpm-workspace.yaml`, `agents.md`
- Docs: `docs/*.md`
- Apps: `apps/api`, `apps/cli`, `apps/mcp`, `apps/mountd`, `apps/web`
- Packages: `packages/core`, `packages/db`, `packages/memory`, `packages/mount-core`, `packages/sdk`, `packages/virtual-bash`
- Scripts: `scripts/demo-seed.ts`, `scripts/mount-smoke-readwrite.ts`

## Current Implementation Landmarks

- Core memory API lives mostly in `packages/core/src/index.ts`.
- SQLite schema exists in both `packages/db/migrations/001_initial.sql` and the `initialMigrationSql` string in `packages/db/src/index.ts`.
- Postgres schema currently lives in `packages/db/migrations/postgres/001_initial.sql`, but it is narrower than SQLite.
- API routes are in `apps/api/src/server.ts`.
- CLI commands are in `apps/cli/src/index.ts`.
- MCP tools are in `apps/mcp/src/server.ts`.
- SDK HTTP wrapper is in `packages/sdk/src/index.ts`.
- Virtual shell commands are in `packages/virtual-bash/src/index.ts`.
- Web dashboard is in `apps/web/src/App.tsx`.
- Memory extraction, fallback embeddings, and recall planning are in `packages/memory/src/index.ts`.
- File extractors are in `packages/memory/src/extractors/index.ts`.
- Mount control files call recall/search through `packages/mount-core/src/index.ts`.

## Existing, Partial, Missing Summary

| Feature | Status | Short read |
| --- | --- | --- |
| Retrieval command split | Existing | `grep` is exact by default, `search` is meaning-oriented hybrid search, and `recall` is task context. |
| Verbatim archive mode | Missing | Raw blobs/files are canonical, but there is no explicit archive-only mode or archive surface. |
| Explicit memory scopes | Missing/partial | Workspaces, path zones, and `project_hint` exist; no durable `scope` model or scoped filters. |
| Memory candidate review workflow | Partial | Promotions and stale review exist; first-class candidate list/edit/approve/reject workflow is missing. |
| Reasoning memories from runs | Partial | Runs and compile-run exist; no dedicated reasoning artifact/type/policy. |
| Pre-task memory briefs | Existing/partial | Implemented across core/API/CLI/MCP/web; needs scope/temporal integration and stronger run linkage. |
| Temporal memory fields | Partial | `created_at`, `updated_at`, `ttl_expires_at`, run timestamps, and recency scoring exist; no explicit event/validity time model. |
| Associative memory graph | Existing/partial | Links, contradictions, supersession, graph score, and dashboard display exist; traversal and association APIs are missing. |
| Simple SDK ergonomics | Partial | HTTP client exists, but it returns `unknown` and lacks high-level workspace-bound helpers. |
| MCP tool coverage | Partial | Many tools exist; several current and proposed surfaces are not exposed. |

## 1. Retrieval Command Split

### Current Status

Existing.

Existing behavior:

- `apps/cli/src/index.ts` implements `memfs grep <query>` as exact text search by default and `memfs search <query>` as meaning-oriented hybrid search.
- `memfs sgrep <query>` is a deprecated compatibility alias for `memfs search --semantic <query>`.
- `packages/virtual-bash/src/index.ts` follows the same split: `grep` exact, `search` hybrid, `sgrep` as a semantic alias.
- `packages/core/src/index.ts` exposes `grepMemory(...)` with `literal`, `semantic`, and `hybrid` modes; the default mode is `literal`.
- `packages/core/src/index.ts` has `searchMemory(...)` as a recall-shaped meaning search for compatibility.
- `recallMemory(...)` scores trigger, summary, keyword, detail/raw excerpt embeddings, importance, recency, path/project match, and graph score.
- `apps/mcp/src/server.ts` exposes both `memfs_grep` and `memfs_memory_search`.
- `packages/mount-core/src/index.ts` exposes `.memfs/search.query` as meaning-oriented hybrid search.

Remaining possible improvements:

- Consider an SQLite FTS table if literal search over large workspaces becomes too slow.
- Keep API `/memory/search` response compatibility in mind if unifying all search result shapes later.

### Likely Model And DB Changes

- Add a shared search result model in `packages/core/src/index.ts`, for example `MemoryGrepOptions`, `MemoryGrepResult`, and `MemoryGrepResponse`.
- Optional but useful: add `memory_search_traces` or extend `recall_traces` to store `mode`, `scope`, and literal/semantic result ids.
- Add indexes only if needed after implementation:
  - `idx_files_workspace_path` already exists.
  - Consider FTS virtual table only if SQLite literal/BM25 grows beyond in-memory scans.
  - Consider `extracted_sources(workspace_id, file_id)` and `memory_nodes(workspace_id, trust_level, status)` already exist.

Files:

- `packages/db/migrations/001_initial.sql`
- `packages/db/src/index.ts`
- `packages/db/migrations/postgres/001_initial.sql`
- `packages/core/src/index.ts`

### Likely API Route Changes

- Add or extend:
  - `POST /workspaces/:id/memory/grep`
  - Or extend `POST /workspaces/:id/memory/search` with `mode`, `scope`, `trust_min`, `include_sources`, `include_literal`, `include_semantic`.
- Keep `/memory/search` backward compatible.

Files:

- `apps/api/src/server.ts`
- `docs/api.md`

### Likely CLI Changes

- Keep `memfs grep "query"` as the exact text command.
- Keep `memfs search "query"` as the meaning-oriented hybrid command.
- Add flags:
  - `--literal`
  - `--semantic`
  - `--hybrid`
  - `--trusted-only`
  - `--include-runs`
  - `--scope <scope>`
  - `--limit <n>`
- Keep `memfs sgrep` only as a compatibility alias for `memfs search --semantic`.

Files:

- `apps/cli/src/index.ts`
- `docs/cli.md`
- `apps/cli/src/cli.test.ts`

### Likely MCP Tool Changes

- Add `memfs_grep` with input:
  - `workspace_id`
  - `query`
  - `mode`
  - `scope`
  - `trust_min`
  - `limit`
  - `include_sources`
  - `include_runs`
- Keep `memfs_memory_search` as compatibility wrapper.

Files:

- `apps/mcp/src/server.ts`
- `apps/mcp/README.md`
- `docs/mcp.md`
- `apps/mcp/src/mcp.test.ts`

### Tests To Add

- Core: hybrid grep returns both exact literal matches and semantic-only matches.
- API: `/memory/grep` supports `literal`, `semantic`, and `hybrid` modes.
- CLI: `memfs grep --literal` excludes semantic-only results; default includes both.
- MCP: `memfs_grep` returns source paths, line/source locations, trust, and no raw source by default.
- Mount-core: `.memfs/search.query` either uses grep or clearly remains memory-search-only.

Files:

- `packages/core/src/memoryfs.test.ts`
- `apps/api/src/server.test.ts`
- `apps/cli/src/cli.test.ts`
- `apps/mcp/src/mcp.test.ts`
- `packages/mount-core/src/mount-core.test.ts`

## 2. Verbatim Archive Mode

### Current Status

Missing, with raw-storage primitives already present.

Existing behavior:

- Raw files and blobs are canonical.
- `blobs` preserve source bytes/content where possible.
- `readRawForNode(...)` gates raw reads.
- `validateExtractedNode(...)` enforces that `raw_excerpt` is an exact source excerpt when source content is available.
- Upload/extract flow stores derived extracted text separately in `extracted_sources`.

Missing behavior:

- No explicit "archive this verbatim and do not summarize/mutate" mode.
- No archive path or archive item model.
- No archive-only write option that skips memory extraction by default and records a no-transform guarantee.
- No archive CLI or MCP tools.
- No archive metadata such as `captured_at`, `source_uri`, `content_sha256`, `verbatim=true`, `redaction_status`, or `legal_hold`.

### Likely Model And DB Changes

Two viable designs:

1. Minimal file-backed archive:
   - Add columns to `files`: `archive_mode INTEGER DEFAULT 0`, `archive_metadata_json TEXT`.
   - Archive content remains in regular `files` and `blobs`.
   - Add `file_artifacts` entries for archive manifests.

2. Explicit archive table:
   - Add `archive_items` with `id`, `workspace_id`, `file_id`, `blob_sha256`, `source_uri`, `source_kind`, `metadata_json`, `captured_at`, `created_at`.
   - Keep raw blob/file canonical.

Recommended: use explicit `archive_items` so archives are queryable without overloading normal files.

Files:

- `packages/db/migrations/001_initial.sql`
- `packages/db/src/index.ts`
- `packages/db/migrations/postgres/001_initial.sql`
- `packages/db/src/adapters.ts`
- `packages/core/src/index.ts`
- `packages/core/src/adapters.ts`

### Likely API Route Changes

- Add:
  - `POST /workspaces/:id/archive`
  - `GET /workspaces/:id/archive`
  - `GET /workspaces/:id/archive/:archive_id`
  - `GET /workspaces/:id/archive/:archive_id/raw`
- Or add `archive: true` to `files/write` and `files/upload`, plus archive listing endpoints.

Files:

- `apps/api/src/server.ts`
- `docs/api.md`
- `docs/source-references.md`
- New or updated `docs/archive.md`

### Likely CLI Changes

- Add:
  - `memfs archive add <local_path> --to <path>`
  - `memfs archive write <path> <content>`
  - `memfs archive list`
  - `memfs archive raw <archive_id>`
- Make archive writes default to `ingest=false`.

Files:

- `apps/cli/src/index.ts`
- `docs/cli.md`
- `apps/cli/src/cli.test.ts`

### Likely MCP Tool Changes

- Add:
  - `memfs_archive_write`
  - `memfs_archive_upload`
  - `memfs_archive_list`
  - `memfs_archive_raw_read`
- Raw read should stay explicit and auditable.

Files:

- `apps/mcp/src/server.ts`
- `docs/mcp.md`
- `apps/mcp/README.md`
- `apps/mcp/src/mcp.test.ts`

### Tests To Add

- Archive preserves exact bytes/hash.
- Archive write does not create memory nodes unless explicitly ingested later.
- Archive raw read is explicit and audited.
- CLI and MCP archive flows do not leak raw content through recall/search.

Files:

- `packages/core/src/memoryfs.test.ts`
- `apps/api/src/server.test.ts`
- `apps/cli/src/cli.test.ts`
- `apps/mcp/src/mcp.test.ts`

## 3. Explicit Memory Scopes

### Current Status

Missing/partial.

Existing behavior:

- Workspaces are top-level containers.
- Path zones imply trust: `/scratch/`, `/runs/`, `/projects/`, `/memory/`, `/profile.md`, `/preferences.md`.
- Recall accepts `project_hint`.
- Memory curation docs show candidate `scope`, but `ExtractedMemoryNode` has no scope field.

Missing behavior:

- No explicit `scope_type`, `scope_id`, `scope_path`, or `visibility` on memory nodes.
- No `memory_scopes` table.
- No API/CLI/MCP scope filters beyond workspace and `project_hint`.
- No clear model for user, project, repo, run, team, global, or archive scopes.

### Likely Model And DB Changes

- Add `memory_scopes`:
  - `id`
  - `workspace_id`
  - `scope_type` (`workspace`, `project`, `run`, `user`, `team`, `global`, `archive`)
  - `scope_key`
  - `display_name`
  - `path_prefix`
  - `metadata_json`
  - `created_at`
  - unique `(workspace_id, scope_type, scope_key)`
- Add to `memory_nodes`:
  - `scope_id`
  - `scope_type`
  - `scope_key`
- Backfill from path:
  - `/projects/<name>/...` -> `project:<name>`
  - `/runs/<id>/...` -> `run:<id>`
  - `/profile.md`, `/preferences.md` -> `workspace`
  - `/memory/...` -> `workspace` or named memory scope
  - `/scratch/...` -> `workspace` ephemeral

Files:

- `packages/db/migrations/001_initial.sql`
- `packages/db/src/index.ts`
- `packages/db/migrations/postgres/001_initial.sql`
- `packages/core/src/index.ts`
- `packages/memory/src/index.ts`
- `packages/memory/src/prompts/extract-memory-nodes.ts`

### Likely API Route Changes

- Add:
  - `GET /workspaces/:id/memory/scopes`
  - `POST /workspaces/:id/memory/scopes`
- Extend:
  - `/memory/recall`
  - `/memory/search`
  - `/memory/grep`
  - `/memory/nodes`
  - `/brief`
  - `/runs/:run_id/compile`
with `scope`, `scopes`, or `scope_filter`.

Files:

- `apps/api/src/server.ts`
- `docs/api.md`
- `docs/memory-model.md`
- `docs/memory-curation.md`

### Likely CLI Changes

- Add flags to memory commands:
  - `--scope <scope>`
  - `--project <project>`
  - `--run <run_id>`
- Add:
  - `memfs scope list`
  - `memfs scope create <type> <key>`

Files:

- `apps/cli/src/index.ts`
- `docs/cli.md`
- `apps/cli/src/cli.test.ts`

### Likely MCP Tool Changes

- Add:
  - `memfs_memory_scope_list`
  - `memfs_memory_scope_create`
- Add `scope`/`scopes` inputs to recall, search/grep, brief, and candidate tools.

Files:

- `apps/mcp/src/server.ts`
- `docs/mcp.md`
- `apps/mcp/README.md`
- `apps/mcp/src/mcp.test.ts`

### Tests To Add

- Path-derived scope assignment during ingestion.
- Recall/search scoped to project/run excludes other scopes.
- Brief with project scope only uses relevant memory plus explicit global/workspace memory.
- SDK and MCP pass scope through correctly.

Files:

- `packages/core/src/memoryfs.test.ts`
- `packages/memory/src/planner.test.ts`
- `apps/api/src/server.test.ts`
- `apps/cli/src/cli.test.ts`
- `apps/mcp/src/mcp.test.ts`

## 4. Memory Candidate Review Workflow

### Current Status

Partial.

Existing behavior:

- `promoteMemory(...)` creates a candidate memory node with `status="pending"` and a `memory_promotions` row.
- `approvePromotion(...)` and `rejectPromotion(...)` write `memory_reviews` rows.
- Rejected candidate nodes are excluded from normal recall.
- `compileRun(...)` creates `agent_generated` candidate nodes and suggested promotions.
- `reviewStaleMemory(...)` records stale review rows.
- Web dashboard can approve/reject promotions.

Missing behavior:

- No first-class `memory_candidates` table or candidate endpoint.
- No candidate list command independent of promotions.
- No candidate edit workflow.
- No risk flags, scope, source refs array, review reason, verifier result, or duplicate target on candidates.
- Compile-run candidate nodes are `active`, not pending, so "candidate" semantics are mixed.

### Likely Model And DB Changes

Recommended: add a `memory_candidates` table rather than relying only on `memory_nodes.status`.

Fields:

- `id`
- `workspace_id`
- `node_id`
- `source_file_id`
- `source_blob_sha256`
- `candidate_json`
- `scope_id`
- `risk_flags_json`
- `dedupe_target_node_id`
- `status` (`pending`, `approved`, `edited`, `rejected`, `duplicate`, `unsafe`)
- `reviewer`
- `review_comment`
- `created_by`
- `created_at`
- `updated_at`

Also consider:

- Add `review_status` and `candidate_id` to `memory_nodes`.
- Extend `memory_reviews.status` to include `edited`, `duplicate`, `unsafe`.

Files:

- `packages/db/migrations/001_initial.sql`
- `packages/db/src/index.ts`
- `packages/db/migrations/postgres/001_initial.sql`
- `packages/core/src/index.ts`
- `packages/memory/src/index.ts`
- `packages/memory/src/prompts/extract-memory-nodes.ts`

### Likely API Route Changes

- Add:
  - `GET /workspaces/:id/memory/candidates`
  - `GET /workspaces/:id/memory/candidates/:candidate_id`
  - `POST /workspaces/:id/memory/candidates`
  - `POST /workspaces/:id/memory/candidates/:candidate_id/approve`
  - `POST /workspaces/:id/memory/candidates/:candidate_id/reject`
  - `POST /workspaces/:id/memory/candidates/:candidate_id/edit`
  - `POST /workspaces/:id/memory/candidates/:candidate_id/mark-duplicate`
- Keep promotions as "write candidate to durable path" rather than the only candidate workflow.

Files:

- `apps/api/src/server.ts`
- `docs/api.md`
- `docs/memory-curation.md`
- `docs/promotions.md`

### Likely CLI Changes

- Add:
  - `memfs candidates`
  - `memfs candidate read <id>`
  - `memfs candidate approve <id>`
  - `memfs candidate reject <id>`
  - `memfs candidate edit <id> --summary ...`
  - `memfs candidate duplicate <id> --of <node_id>`

Files:

- `apps/cli/src/index.ts`
- `docs/cli.md`
- `apps/cli/src/cli.test.ts`

### Likely MCP Tool Changes

Agent-safe tools:

- `memfs_memory_candidate_create`
- `memfs_memory_candidate_list`
- `memfs_memory_candidate_read`

Human/reviewer tools can remain off by default or be gated:

- `memfs_memory_candidate_approve`
- `memfs_memory_candidate_reject`
- `memfs_memory_candidate_edit`

Files:

- `apps/mcp/src/server.ts`
- `docs/mcp.md`
- `apps/mcp/README.md`
- `apps/mcp/src/mcp.test.ts`

### Tests To Add

- Candidate creation stores source refs, risk flags, and pending status.
- Normal recall excludes pending candidates unless explicitly requested.
- Approving a candidate marks a node active/reviewed without requiring a promotion.
- Rejecting a candidate excludes it from recall and preserves audit/review rows.
- Compile-run creates pending candidates or clearly marks active run memories separately.

Files:

- `packages/core/src/memoryfs.test.ts`
- `apps/api/src/server.test.ts`
- `apps/cli/src/cli.test.ts`
- `apps/mcp/src/mcp.test.ts`
- `apps/web` tests if a UI test harness is added later.

## 5. Reasoning Memories From Runs

### Current Status

Partial.

Existing behavior:

- `agent_runs`, `agent_run_events`, and `run_memory_usages` tables exist.
- `createRun(...)` creates `/runs/<run_id>/` artifacts.
- `recallMemory(..., run_id)` can log memory usage to `memory-used.md`.
- `completeRun(...)` writes `result.md`, `errors.md`, and `followups.md`.
- `compileRun(...)` reads run artifacts and creates candidate memories plus suggested promotions.

Missing behavior:

- No dedicated reasoning artifact such as `reasoning.md`.
- No distinction between final result, actions, chain-of-thought-like private reasoning, tool observations, and durable lessons.
- No policy for what reasoning is safe to store.
- No memory type for "reasoning pattern" or "run lesson"; current fallback uses `run_summary` for `/runs/`.
- No route/tool for logging reasoning summaries separately from raw private reasoning.

### Likely Model And DB Changes

- Add run artifact names:
  - `reasoning-summary.md`
  - `tool-observations.md`
  - `lessons.md`
- Avoid storing private chain-of-thought. Store concise reasoning summaries or decision rationale only.
- Add to `agent_run_events` or a new `run_reasoning_summaries` table:
  - `id`
  - `workspace_id`
  - `run_id`
  - `summary`
  - `source_event_ids_json`
  - `visibility`
  - `created_at`
- Consider adding memory types:
  - `run_lesson`
  - `rationale`
or map them to `run_summary`, `decision`, `error`, and `task`.

Files:

- `packages/db/migrations/001_initial.sql`
- `packages/db/src/index.ts`
- `packages/db/migrations/postgres/001_initial.sql`
- `packages/core/src/index.ts`
- `packages/memory/src/index.ts`
- `packages/memory/src/prompts/extract-memory-nodes.ts`

### Likely API Route Changes

- Add:
  - `POST /workspaces/:id/runs/:run_id/reasoning-summary`
  - Or extend `POST /workspaces/:id/runs/:run_id/events` with `event_type="reasoning_summary"` and first-class compile handling.
- Extend compile options:
  - `include_reasoning`
  - `include_tool_observations`
  - `candidate_status`

Files:

- `apps/api/src/server.ts`
- `docs/api.md`
- `docs/runs.md`
- `docs/compile-run.md`

### Likely CLI Changes

- Add:
  - `memfs run log <run_id> <event_type> <payload>`
  - `memfs run reason <run_id> <summary>`
  - `memfs run compile <run_id> --include-reasoning`

Files:

- `apps/cli/src/index.ts`
- `docs/cli.md`
- `apps/cli/src/cli.test.ts`

### Likely MCP Tool Changes

- Add:
  - `memfs_run_read`
  - `memfs_run_list`
  - `memfs_run_log_reasoning_summary`
- Extend `memfs_run_compile` with `include_reasoning` and `create_promotions`.

Files:

- `apps/mcp/src/server.ts`
- `docs/mcp.md`
- `apps/mcp/README.md`
- `apps/mcp/src/mcp.test.ts`

### Tests To Add

- Reasoning summaries are stored as run artifacts/events.
- Compile-run can include reasoning summaries without exposing raw private reasoning.
- Resulting memories point to `/runs/<run_id>/candidates.md` or the reasoning summary artifact.
- MCP run reasoning tool is safe and auditable.

Files:

- `packages/core/src/memoryfs.test.ts`
- `apps/api/src/server.test.ts`
- `apps/cli/src/cli.test.ts`
- `apps/mcp/src/mcp.test.ts`

## 6. Pre-Task Memory Briefs

### Current Status

Existing/partial.

Existing behavior:

- `createBrief(...)` exists in `packages/core/src/index.ts`.
- API route `POST /workspaces/:id/brief` exists.
- CLI command `memfs brief "<task>"` exists.
- MCP tool `memfs_brief` exists.
- Web dashboard can create a brief.
- Briefs can create runs and write `/runs/<run_id>/brief.md`.
- Brief sections include decisions, constraints, preferences, previous errors, open questions, suggested files, and warnings.

Missing behavior:

- Briefs are manual; they are not automatically attached to every run unless callers pass `create_run`.
- Briefs do not yet use explicit scopes or temporal filters.
- `createRun(...)` does not automatically generate a brief.
- Briefs do not rank "must inspect raw source" separately from normal suggested files.

### Likely Model And DB Changes

- No required schema change for the current feature.
- Optional: add `briefs` table if briefs need stable ids separate from run files:
  - `id`
  - `workspace_id`
  - `run_id`
  - `task`
  - `scope_json`
  - `result_node_ids_json`
  - `brief_markdown`
  - `created_at`

Files:

- `packages/db/migrations/001_initial.sql`
- `packages/db/src/index.ts`
- `packages/db/migrations/postgres/001_initial.sql`

### Likely API Route Changes

- Extend `POST /workspaces/:id/brief` with:
  - `scope`
  - `scopes`
  - `as_of`
  - `since`
  - `until`
  - `auto_start_run`
- Consider `POST /workspaces/:id/runs` option `create_brief=true`.

Files:

- `apps/api/src/server.ts`
- `docs/api.md`
- `docs/briefs.md`
- `docs/runs.md`

### Likely CLI Changes

- Add:
  - `memfs brief "<task>" --scope <scope> --since <date>`
  - `memfs run create "<task>" --brief`

Files:

- `apps/cli/src/index.ts`
- `docs/cli.md`
- `apps/cli/src/cli.test.ts`

### Likely MCP Tool Changes

- Extend `memfs_brief` with `scope`, `since`, `until`, `as_of`, and `create_run`.
- Add `memfs_run_create` option `create_brief`.

Files:

- `apps/mcp/src/server.ts`
- `docs/mcp.md`
- `apps/mcp/README.md`
- `apps/mcp/src/mcp.test.ts`

### Tests To Add

- Brief respects explicit scopes.
- Brief respects temporal filters.
- Run creation with `create_brief=true` writes prompt and brief artifacts.
- MCP brief can create or not create a run deterministically.

Files:

- `packages/core/src/memoryfs.test.ts`
- `apps/api/src/server.test.ts`
- `apps/cli/src/cli.test.ts`
- `apps/mcp/src/mcp.test.ts`

## 7. Temporal Memory Fields

### Current Status

Partial.

Existing behavior:

- `memory_nodes` has `created_at`, `updated_at`, and `ttl_expires_at`.
- Recall scoring uses `recencyScore(updated_at)`.
- Runs have `started_at`, `completed_at`, and `created_at`.
- Audit/events have `created_at`.

Missing behavior:

- No explicit `observed_at`, `occurred_at`, `valid_from`, `valid_until`, `superseded_at`, or `source_created_at`.
- No temporal filters in recall/search/grep.
- No "as of" memory view.
- No docs for temporal semantics beyond TTL.

### Likely Model And DB Changes

- Add to `memory_nodes`:
  - `observed_at`
  - `occurred_at`
  - `valid_from`
  - `valid_until`
  - `superseded_at`
  - `temporal_confidence`
  - `temporal_metadata_json`
- Add indexes:
  - `idx_memory_nodes_observed_at`
  - `idx_memory_nodes_validity`
- Extend `ExtractedMemoryNode` with optional temporal fields.

Files:

- `packages/db/migrations/001_initial.sql`
- `packages/db/src/index.ts`
- `packages/db/migrations/postgres/001_initial.sql`
- `packages/db/src/adapters.ts`
- `packages/core/src/index.ts`
- `packages/memory/src/index.ts`
- `packages/memory/src/prompts/extract-memory-nodes.ts`

### Likely API Route Changes

- Extend recall/search/grep/list nodes with:
  - `since`
  - `until`
  - `as_of`
  - `include_expired`
  - `valid_at`
- Add temporal metadata to recall packets when requested.

Files:

- `apps/api/src/server.ts`
- `docs/api.md`
- `docs/memory-model.md`
- `docs/explainable-recall.md`

### Likely CLI Changes

- Add flags:
  - `--since <date>`
  - `--until <date>`
  - `--as-of <date>`
  - `--include-expired`
- Apply to `grep`, `recall`, `brief`, `nodes`, and `stale`.

Files:

- `apps/cli/src/index.ts`
- `docs/cli.md`
- `apps/cli/src/cli.test.ts`

### Likely MCP Tool Changes

- Add temporal inputs to:
  - `memfs_grep`
  - `memfs_memory_search`
  - `memfs_memory_recall`
  - `memfs_brief`
  - candidate list tools

Files:

- `apps/mcp/src/server.ts`
- `docs/mcp.md`
- `apps/mcp/README.md`
- `apps/mcp/src/mcp.test.ts`

### Tests To Add

- Temporal fields persist through ingestion and promotion.
- Recall `as_of` excludes memories that were not valid at that time.
- Expired TTL memories remain auditable but are excluded unless requested.
- Superseded memories have `superseded_at` and lower score.

Files:

- `packages/core/src/memoryfs.test.ts`
- `packages/memory/src/planner.test.ts`
- `apps/api/src/server.test.ts`
- `apps/cli/src/cli.test.ts`
- `apps/mcp/src/mcp.test.ts`

## 8. Associative Memory Graph

### Current Status

Existing/partial.

Existing behavior:

- `memory_links` table exists.
- Relation types include `related_to`, `supports`, `contradicts`, `supersedes`, `duplicates`, `caused_by`, `derived_from`, `belongs_to_project`, `used_in_run`, and `promoted_from`.
- `inferMemoryLinksForNewNode(...)` creates links based on similarity, contradictions, supersession, and project path.
- `graphScoreForNode(...)` contributes to recall scoring.
- API exposes node links and contradictions.
- Web dashboard shows links and can create a link.

Missing behavior:

- No graph traversal endpoint.
- No "associations" endpoint for spreading activation from a query or node.
- No path-finding between nodes.
- No link validation table or status.
- No link update/delete API.
- MCP does not expose graph tools.
- CLI does not expose graph tools.

### Likely Model And DB Changes

- Add to `memory_links`:
  - `weight`
  - `source`
  - `status`
  - `updated_at`
  - `created_by`
- Optional: add `memory_graph_events` for link inference provenance.
- Add uniqueness strategy for bidirectional relations if needed.

Files:

- `packages/db/migrations/001_initial.sql`
- `packages/db/src/index.ts`
- `packages/db/migrations/postgres/001_initial.sql`
- `packages/core/src/index.ts`

### Likely API Route Changes

- Add:
  - `GET /workspaces/:id/memory/graph`
  - `GET /workspaces/:id/memory/nodes/:node_id/neighbors?depth=2`
  - `POST /workspaces/:id/memory/associations`
  - `PATCH /workspaces/:id/memory/links/:link_id`
  - `DELETE /workspaces/:id/memory/links/:link_id`
- Keep existing link create and contradictions endpoints.

Files:

- `apps/api/src/server.ts`
- `docs/api.md`
- `docs/memory-graph.md`
- `docs/explainable-recall.md`

### Likely CLI Changes

- Add:
  - `memfs graph node <node_id>`
  - `memfs graph query "<query>"`
  - `memfs graph link <from> <to> --type related_to`
  - `memfs graph contradictions`

Files:

- `apps/cli/src/index.ts`
- `docs/cli.md`
- `apps/cli/src/cli.test.ts`

### Likely MCP Tool Changes

- Add:
  - `memfs_memory_graph_neighbors`
  - `memfs_memory_graph_query`
  - `memfs_memory_link_create`
  - `memfs_memory_contradiction_list`

Files:

- `apps/mcp/src/server.ts`
- `docs/mcp.md`
- `apps/mcp/README.md`
- `apps/mcp/src/mcp.test.ts`

### Tests To Add

- Graph traversal returns bounded neighbors without raw source.
- Association query expands recall through related/supporting links.
- Link update/delete are audited.
- MCP graph tools mirror API output.

Files:

- `packages/core/src/memoryfs.test.ts`
- `apps/api/src/server.test.ts`
- `apps/cli/src/cli.test.ts`
- `apps/mcp/src/mcp.test.ts`

## 9. Simple SDK Ergonomics

### Current Status

Partial.

Existing behavior:

- `packages/sdk/src/index.ts` exposes `MemoryFSClient` and `createMemoryFSClient`.
- It wraps most API endpoints.
- It returns `Promise<unknown>` for almost everything.
- It has no workspace-bound helper and no high-level mental model methods.

Missing behavior:

- Typed return types exported from SDK.
- Workspace selection by name.
- High-level helpers such as `client.workspace("demo").grep(...)`.
- Simple `remember`, `archive`, `brief`, `run`, and `candidate` APIs.
- Friendly defaults aligned with CLI/MCP.

### Likely Model And DB Changes

- No DB changes required.
- Types should be shared or duplicated intentionally:
  - Re-export public types from `@memoryfs/core` where practical.
  - Or define SDK transport types in `packages/sdk/src/index.ts`.

Files:

- `packages/sdk/src/index.ts`
- `packages/sdk/package.json`
- `packages/core/src/index.ts`

### Likely API Route Changes

- No route changes required unless SDK work reveals missing ergonomic endpoints.

Files:

- `apps/api/src/server.ts`

### Likely CLI Changes

- No direct CLI change required.
- Keep CLI and SDK option names aligned.

Files:

- `apps/cli/src/index.ts`

### Likely MCP Tool Changes

- No direct MCP change required, but SDK naming should align with MCP tool names where possible.

Files:

- `apps/mcp/src/server.ts`

### Tests To Add

- SDK typed helper can create/select workspace by name.
- Workspace-bound client can write/read/grep/recall/brief/run without repeating `workspaceId`.
- SDK error preserves HTTP status and API error message.

Files:

- Add `packages/sdk/src/sdk.test.ts`
- Possibly update `vitest.config.ts`

## 10. MCP Tool Coverage

### Current Status

Partial.

Existing tools:

- Workspace: list/create
- Files: list/read/write/upload/extract/extracted-source/delete
- Memory: search/recall/node read/raw read/promote/promotion list/health
- Briefs/runs/handoff/stale memory
- Snapshots: create/list
- Sync: status/pull/push/conflict list
- Legacy `memoryfs_*` aliases for selected tools

Missing current-implementation tools:

- Memory node list
- Memory node source read
- Memory links list/create
- Contradictions list
- Stale memory review
- Promotion read
- Snapshot diff/rollback
- Run list/read/memory-used
- Sync conflict resolve

Missing for proposed features:

- `memfs_grep`
- Archive tools
- Scope tools
- Candidate review tools
- Temporal recall/search parameters
- Graph association/traversal tools
- Run reasoning summary tools

### Likely Model And DB Changes

- No MCP-only DB changes.
- MCP coverage should follow the core/API model changes above.

Files:

- `apps/mcp/src/server.ts`
- `apps/mcp/README.md`
- `docs/mcp.md`

### Likely API Route Changes

- MCP can call core directly today, but tool parity should track public API routes for predictability.
- Add API routes listed in the feature sections before exposing corresponding MCP tools.

Files:

- `apps/api/src/server.ts`
- `docs/api.md`

### Likely CLI Changes

- Keep CLI and MCP nouns aligned:
  - `grep`
  - `archive`
  - `scope`
  - `candidate`
  - `graph`
  - `run`

Files:

- `apps/cli/src/index.ts`
- `docs/cli.md`

### Tests To Add

- MCP handler coverage for every new tool.
- Test that agent-facing tools do not expose raw source unless explicitly requested.
- Test that approval/rejection tools are either absent by default or gated by an explicit server option.

Files:

- `apps/mcp/src/mcp.test.ts`
- `apps/mcp/README.md`
- `docs/mcp.md`

## Documentation Inconsistencies And Gaps

- `README.md` says MemFS "validates, deduplicates, reviews, promotes, searches, and audits" agent-proposed memories through a curation pipeline. The code has extraction validation, heuristic dedupe, promotions, and reviews, but not a first-class candidate curation pipeline with candidate list/edit/risk/verifier workflow.
- `docs/memory-curation.md` defines candidate shape with `scope`, `source_refs`, `risk_flags`, and `requires_review`. `packages/memory/src/index.ts` `ExtractedMemoryNode` currently has none of those fields.
- `docs/api.md` says `/memory/search` is intended for hybrid grep-style workflows. In code, `MemoryFS.searchMemory(...)` simply calls `recallMemory(...)`; literal file matching exists only in CLI and virtual bash.
- `docs/mcp.md` lists many tools, but MCP lacks several current API surfaces: node list, node source read, graph link list/create, contradictions list, stale review, promotion read, snapshot diff/rollback, run list/read, run memory-used, and sync conflict resolve.
- `apps/mcp/README.md` is less complete than `docs/mcp.md`; it omits upload/extract/extracted-source tools that are implemented and documented in `docs/mcp.md`.
- `docs/postgres.md` says the Postgres adapter covers workspaces, files, blobs, memory nodes, and sync events. The hand-written Postgres migration contains only that subset, while the SQLite schema contains many more product tables; new roadmap schema work needs explicit Postgres parity decisions.
- `docs/memory-graph.md` says the dashboard exposes a graph panel and contradictions inbox. The dashboard has node links and contradictions, but not a full graph traversal/association view.
- `README.md` and `docs/architecture.md` present some Phase 6/7 capabilities as complete product flows; the implementation often has MVP or heuristic versions rather than the full curation/search/scope systems implied by the wording.

## Suggested Build Order

1. Normalize public search types.
   - Add shared `MemoryGrepOptions`/`MemoryGrepResponse` and keep existing recall/search backward compatible.
2. Add explicit scopes and temporal fields.
   - These are foundational filters needed by grep, briefs, candidates, graph traversal, and MCP.
3. Implement API-level hybrid grep.
   - Move literal/extracted-source matching into core so CLI, MCP, virtual bash, mount, and SDK share one behavior.
4. Add first-class candidate review.
   - Separate candidate lifecycle from promotions and compile-run active nodes.
5. Add verbatim archive mode.
   - Use raw blob/file primitives and keep archive ingest opt-in.
6. Extend run reasoning summaries.
   - Store safe reasoning summaries, then teach compile-run how to create candidates from them.
7. Upgrade briefs to use scopes and temporal filters.
   - Add run auto-brief option after scope/temporal primitives exist.
8. Expand associative graph APIs.
   - Add traversal, associations, link updates, and MCP/CLI graph commands.
9. Improve SDK ergonomics.
   - Build typed, workspace-bound helpers around stabilized API surfaces.
10. Complete MCP tool coverage.
   - Add parity tools last, with raw-read and review-approval safety choices explicit.

## Verification Checklist For This Roadmap Change

- `docs/roadmap-implementation-map.md` exists.
- No production code is changed.
- Run:
  - `pnpm test`
  - `pnpm typecheck`
