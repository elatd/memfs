# MemFS

MemFS is a clean-room, local-first agent memory filesystem. Humans and agents work with ordinary files, while the system derives structured memory nodes for semantic recall.

Raw files are always the source of truth. Memory nodes are retrieval indexes with summaries, triggers, details, source references, tags, importance, confidence, and links.

Phase 3 adds a trust layer for long-lived memory: scratch and run memory can be written freely, durable memory flows through reviewable promotions, snapshots can be diffed and rolled back, and health reports make memory drift visible.

Phase 4 adds the task lifecycle: pre-task briefs, run folders, memory-used logs, compile-run candidate memories, handoff summaries, and stale memory review.

Phase 5 adds multimodal ingestion for common local files. Markdown, text, JSON, CSV, HTML, code, and terminal logs are extracted into derived text with source locations; PDF, DOCX, and images fail gracefully unless an extractor is added.

Phase 6 adds optional team and cloud foundations: storage adapters, Postgres metadata support, object blob storage, sync events, role-based permissions, conflict detection, and conflict resolution. Local SQLite mode remains the default.

## Clean-Room Note

MemFS is a new implementation based on the requirements in this repository. It is designed around ordinary files, local metadata, source-backed memory nodes, and progressive recall.

The MVP intentionally avoids FUSE, Git compatibility, and graph databases. It uses a TypeScript monorepo, Fastify, SQLite metadata, local disk blobs, a Vite dashboard, an MCP server, a small virtual shell, and an SDK.

## Permissive Usage

MemFS is provided under the MIT License. You may use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the software, subject to the license notice in [LICENSE](./LICENSE).

## Setup

```bash
pnpm install
cp .env.example .env
```

If `pnpm` is not installed, enable it through Corepack:

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

## Environment

- `OPENAI_API_KEY`: optional OpenAI-compatible API key.
- `OPENAI_BASE_URL`: optional compatible API base URL.
- `MEMORYFS_CHAT_MODEL`: defaults to `gpt-4o-mini`.
- `MEMORYFS_EMBED_MODEL`: defaults to `text-embedding-3-small`.
- `MEMORYFS_MODEL_TIMEOUT_MS`: defaults to `20000`.
- `MEMORYFS_DEMO_USE_LLM`: set to `true` if the demo seed should call the configured model.
- `MEMORYFS_DATA_DIR`: defaults to `./data`.
- `MEMFS_DATA_DIR`: preferred Phase 6 data directory name; falls back to `MEMORYFS_DATA_DIR`.
- `MEMORYFS_API_PORT`: defaults to `3131`.
- `VITE_API_BASE_URL`: defaults to `http://localhost:3131`.
- `MEMFS_MODE`: `local`, `team`, or `cloud`; defaults to `local`.
- `MEMFS_DATABASE_URL`: optional Postgres connection string for team/cloud metadata adapters.
- `MEMFS_OBJECT_STORE_*`: optional S3-compatible object storage configuration.
- `MEMFS_SYNC_ENABLED`: optional sync toggle.
- `MEMFS_AUTH_REQUIRED`: require actor auth for API requests.
- `MEMFS_ENCRYPTION_KEY`: reserved for encrypted cloud deployments.

Without an API key, MemFS uses deterministic local extraction and hash embeddings so the MVP remains fully local. The demo seed uses the deterministic path by default.

## Run

```bash
pnpm dev
```

The API runs on `http://localhost:3131`; the dashboard runs on `http://localhost:5174`.

Run only the API:

```bash
pnpm --filter @memoryfs/api dev
```

Run only the web dashboard:

```bash
pnpm --filter @memoryfs/web dev
```

Run the CLI:

```bash
pnpm exec memfs help
pnpm exec memfs workspace list
```

The command name is `memfs`. It talks to `http://localhost:3131` by default and accepts `MEMFS_API_URL`.

Run the MCP server:

```bash
pnpm --filter @memoryfs/mcp dev
```

Seed demo data:

```bash
pnpm demo:seed
```

Run tests:

```bash
pnpm test
```

## Example Agent Workflow

```ts
import { MemoryFS } from "@memoryfs/core";
import { VirtualBash } from "@memoryfs/virtual-bash";

const memoryfs = new MemoryFS({ dataDir: "./data" });
await memoryfs.initialize();

const workspace = memoryfs.createWorkspace("project_pipsqueak");
const bash = new VirtualBash(memoryfs, workspace.id);

await bash.exec('write /preferences.md "User prefers Netlify and Supabase"');
const recall = await bash.exec("sgrep 'hosting preference'");

console.log(recall.displayText);
```

Protected paths such as `/profile.md`, `/preferences.md`, `/projects/*/decisions.md`, and `/projects/*/constraints.md` require `allow_protected_write=true`.

More docs:

- [CLI](./docs/cli.md)
- [Virtual Bash](./docs/virtual-bash.md)
- [MCP](./docs/mcp.md)
- [Explainable Recall](./docs/explainable-recall.md)
- [Memory Graph](./docs/memory-graph.md)
- [Trust Layer](./docs/trust-layer.md)
- [Promotions](./docs/promotions.md)
- [Snapshots](./docs/snapshots.md)
- [Memory Health](./docs/memory-health.md)
- [Runs](./docs/runs.md)
- [Briefs](./docs/briefs.md)
- [Compile Run](./docs/compile-run.md)
- [Handoff](./docs/handoff.md)
- [Multimodal Ingestion](./docs/multimodal-ingestion.md)
- [Source References](./docs/source-references.md)
- [Storage Adapters](./docs/storage-adapters.md)
- [Postgres](./docs/postgres.md)
- [Object Storage](./docs/object-storage.md)
- [Sync](./docs/sync.md)
- [Team Mode](./docs/team-mode.md)
- [Permissions](./docs/permissions.md)
- [Deployment](./docs/deployment.md)
