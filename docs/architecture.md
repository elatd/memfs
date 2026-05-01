# Architecture

MemFS has four layers:

- `packages/core`: workspace, file, blob, audit, protected path, ingestion, and recall orchestration.
- `packages/db`: SQLite connection, migrations, and metadata adapter interfaces.
- `packages/memory`: chunking, prompt templates, extraction validation, LLM calls, fallback extraction, embeddings, and scoring helpers.
- `packages/memory/extractors`: clean-room file extractors for derived text and source locations.
- `packages/virtual-bash`: a deterministic command interpreter for agents.
- Apps: Fastify API, CLI, React dashboard, and MCP server.

Data lives under `./data`:

- `./data/memoryfs.db`: SQLite metadata.
- `./data/blobs/<prefix>/<sha256>`: content-addressed source blobs.
- `./data/workspaces/<workspace_id>`: local workspace files.

Phase 6 keeps that local layout, while adding optional adapters for team/cloud mode:

- `MetadataStore`: SQLite today, Postgres adapter for shared metadata.
- `BlobStore`: local disk or S3-compatible object storage.
- `WorkspaceFileStore`: local materialized files.
- `SyncStore`: local/test sync transport for sync event packets.
- `AuthzProvider`: optional external authorization hook.

Write flow:

1. Validate and normalize the path.
2. Enforce protected path rules.
3. Store the raw blob by SHA-256.
4. Write the workspace file.
5. Upsert file metadata.
6. Emit file and audit events.
7. If requested, extract memory nodes and embeddings.
8. Assign memory zone trust from the file path.

Extraction flow:

1. Detect file type from path and MIME type.
2. Run a matching extractor for Markdown, text, JSON, CSV, HTML, code, or terminal logs.
3. Store derived text in `extracted_sources` with extractor metadata.
4. Keep the raw blob as canonical source.
5. During ingestion, create memory nodes from extracted sections and store `source_location_json`.
6. Unsupported formats store an honest unsupported extraction record and create no memory nodes.

Recall flow:

1. Embed the query.
2. Plan the query intent with deterministic heuristics.
3. Score trigger, summary, detail or raw excerpt, keywords, importance, recency, path/project match, and graph context.
4. Return source paths and raw references with every result.
5. Return source kind and source location metadata when available.
6. Include why explanations, graph links, detail, or raw content only when requested.

Agent run flow:

1. Create a run row and `/runs/<run_id>/` files.
2. Generate a pre-task brief through recall and write `brief.md`.
3. During the task, log files read, memory recalled, raw memory opened, and arbitrary events.
4. Complete the run by writing result, error, and followup artifacts.
5. Compile the run into candidate memories and suggested promotions.
6. Create handoff summaries for the next agent or human.

Agent UX surfaces:

- CLI uses the local API and stores the selected workspace in `~/.memfs/config.json`.
- Virtual bash calls `packages/core` directly and returns structured results with `displayText`.
- MCP exposes the same workspace, file, memory, raw, and audit workflow through `memfs_*` tools.
- Dashboard keeps raw source behind an explicit click.

Graph flow:

1. New nodes are compared against existing workspace nodes.
2. Similar, duplicate, superseding, contradictory, and related memories are linked.
3. Links are audit events and do not delete or resolve memory.
4. Contradictions remain inspectable until a human or agent writes clearer source files.

Trust flow:

1. Agents write freely to `/scratch/` and `/runs/`.
2. Durable paths stay protected through path rules and promotion review.
3. Promotion creates a pending candidate node with source references.
4. Approval applies the promoted block to the target file and marks resulting memory trusted.
5. Rejection keeps the source and candidate audit trail but excludes the rejected node from normal recall.

Snapshot flow:

1. Snapshot stores JSON copies of files, referenced blobs, memory nodes, links, and protected paths.
2. Diff compares the snapshot against current workspace state.
3. Rollback restores those items, rebuilds embeddings, rewrites workspace files, and emits an audit event.

Health flow:

1. Health recomputation checks source coverage, contradictions, unresolved promotions, stale nodes, rejected nodes, low confidence, orphan nodes, missing raw blobs, and agent writes to protected paths.
2. The latest health report is stored in SQLite and displayed in the dashboard.

Stale review flow:

1. Stale memory is listed by criteria such as rejected, superseded, expired TTL, missing source, low confidence, and old low-importance nodes.
2. Review marks candidates through `memory_reviews` and audit events.
3. MemFS does not delete stale memory by default.

Sync flow:

1. File, blob, memory, graph, snapshot, run, promotion, and audit operations emit sync events.
2. Push sends events to a configured sync store.
3. Pull applies remote events when safe.
4. Same-file changes and protected path changes create conflict records.
5. Conflict resolution is explicit and audited; file keep-both writes a copy under `/conflicts/`.

Team flow:

1. Local mode is unauthenticated by default.
2. Team/cloud mode can require actor identity through `Authorization: Bearer <actor>` or `x-memfs-actor`.
3. Workspace members have owner, admin, editor, agent, or viewer roles.
4. Agents can write `/scratch/` and `/runs/` and propose promotions, but cannot silently edit protected durable memory.
