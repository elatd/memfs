Create or update AGENTS.md for this repository.

Project:
MemFS is a local-first agent memory filesystem. It combines:
1. Filesystem-style agent UX
2. Structured memory nodes
3. Progressive recall
4. Source-grounded memory
5. Protected memory paths
6. Auditability
7. MCP tools
8. Future sync and team mode

Current architecture:
- packages/core: workspace, file, blob, audit, protected path, ingestion, recall orchestration
- packages/db: SQLite connection and migrations
- packages/memory: chunking, prompt templates, extraction validation, LLM calls, fallback extraction, embeddings, scoring helpers
- apps/api: Fastify API
- apps/web: React dashboard
- apps/mcp: MCP server
- data directory:
  - ./data/memoryfs.db
  - ./data/blobs/<prefix>/<sha256>
  - ./data/workspaces/<workspace_id>

Core invariants:
1. Raw files and blobs are canonical truth.
2. Memory nodes are retrieval indexes, never canonical truth.
3. Every memory node must link to a source file and source blob.
4. Every recall result must include source_path and raw_ref.
5. Raw content must not be returned unless include_raw=true or an explicitly documented confidence fallback requires it.
6. Path traversal such as ../ must be rejected.
7. Protected paths must require explicit allow_protected_write=true.
8. Every write, deletion, ingestion, promotion, snapshot, rollback, and denied action must create an audit event.
9. New features must not break the existing API.
10. Do not copy or import code from external memory projects. Implement from our own requirements only.

Current API:
- POST /workspaces
- GET /workspaces
- GET /workspaces/:id
- GET /workspaces/:id/files
- GET /workspaces/:id/files/read?path=/x.md
- POST /workspaces/:id/files/write
- POST /workspaces/:id/files/delete
- POST /workspaces/:id/memory/ingest-file
- POST /workspaces/:id/memory/search
- POST /workspaces/:id/memory/recall
- GET /workspaces/:id/memory/nodes
- GET /workspaces/:id/memory/nodes/:node_id
- GET /workspaces/:id/memory/nodes/:node_id/raw

Memory model:
MemoryNode fields:
- summary
- trigger beginning with "Recall when"
- detail
- raw_ref
- raw_excerpt
- tags
- memory_type
- importance
- confidence
- source_file_id
- source_blob_sha256

Progressive recall:
- Tier 1: summary, trigger, tags, importance, source path
- Tier 2: detail and related nodes
- Tier 3: raw excerpt and raw source content

Development expectations:
- Use TypeScript.
- Keep public APIs typed.
- Add migrations for database changes.
- Add tests for core behavior.
- Add API tests when adding endpoints.
- Add MCP tests or fixtures when adding tools.
- Update docs/api.md, docs/architecture.md, and docs/memory-model.md when behavior changes.
- Keep the implementation local-first.
- Use environment variables for model providers and API keys.
- Never expose provider keys to the frontend.
- Prefer small composable modules over large files.
- Preserve backwards compatibility unless explicitly asked otherwise.

Required verification:
Run the available project checks. If exact commands are not known, inspect package.json and workspace config first.

Expected commands may include:
- pnpm install
- pnpm test
- pnpm lint
- pnpm typecheck
- pnpm dev
- pnpm demo:seed

Definition of done:
- Tests pass.
- Types pass.
- Docs are updated.
- New APIs have examples.
- New behavior is covered by tests.
- Existing behavior still works.
