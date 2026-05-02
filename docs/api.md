# API

Base URL: `http://localhost:3131`

## SDK

`@verifs/sdk` exposes two layers:

- `VeriFSApiClient`: low-level HTTP methods that map closely to API routes.
- `VeriFSClient`: a small high-level client for application and agent integrations.

```ts
import { VeriFSClient } from "@verifs/sdk";

const verifs = new VeriFSClient({ apiUrl: "http://localhost:3131" });

await verifs.remember({
  workspace: "doozy",
  text: "The user prefers Netlify Functions for backend MVPs.",
  scope: "workspace",
  source: "explicit_user_instruction"
});

const results = await verifs.recall({
  workspace: "doozy",
  query: "backend preference"
});
```

High-level methods accept a workspace name or id and resolve it through the API. Missing workspaces are created by default unless `createWorkspaceIfMissing=false` is passed to the client.

`remember()` writes a source-backed candidate by default and does not silently bypass durable-memory review. If a caller passes `approved: true`, the SDK still goes through candidate approval and promotion APIs, so protected-path rules, audit events, snapshots, and source references remain part of the flow.

High-level groups:

- `remember`, `recall`, `search`, `grep`, `write`, `read`
- `candidates.list`, `candidates.approve`, `candidates.reject`
- `runs.start`, `runs.append`, `runs.finish`, `runs.compile`
- `briefs.create`

## Workspaces

- `POST /workspaces` with `{ "name": "demo" }`
- `GET /workspaces`
- `GET /workspaces/:id`

## Audit

- `GET /workspaces/:id/audit-events?limit=100`
- `POST /workspaces/:id/audit-events`

Record audit body:

```json
{
  "actor": "mount:local",
  "event_type": "mount.started",
  "payload": {
    "mountpoint": "/Users/me/VeriFS/demo"
  }
}
```

## Files

- `GET /workspaces/:id/files`
- `GET /workspaces/:id/files/read?path=/x.md`
- `POST /workspaces/:id/files/write`
- `POST /workspaces/:id/files/delete`
- `POST /workspaces/:id/files/upload`
- `POST /workspaces/:id/files/extract`
- `GET /workspaces/:id/files/:file_id/extracted`

Write body:

```json
{
  "path": "/projects/demo/decisions.md",
  "content": "Markdown text",
  "actor": "agent:demo",
  "ingest": true,
  "allow_protected_write": false
}
```

Upload body:

```json
{
  "path": "/uploads/status.csv",
  "content_base64": "c3RhdHVzLG5hbWUKb3BlbixhbHBoYQ==",
  "mime_type": "text/csv",
  "actor": "agent:demo",
  "ingest": true,
  "allow_protected_write": false
}
```

`files/extract` stores derived extracted text and metadata without creating memory nodes. `memory/ingest-file` also runs extraction, then creates memory nodes from extracted sections.

## Memory

- `POST /workspaces/:id/memory/ingest-file`
- `POST /workspaces/:id/memory/grep`
- `POST /workspaces/:id/memory/search`
- `POST /workspaces/:id/memory/recall`
- `GET /workspaces/:id/memory/nodes`
- `GET /workspaces/:id/memory/nodes/:node_id`
- `GET /workspaces/:id/memory/nodes/:node_id/raw`
- `GET /workspaces/:id/memory/nodes/:node_id/source`
- `POST /workspaces/:id/memory/nodes/:node_id/mark-stale`
- `POST /workspaces/:id/memory/nodes/:node_id/confirm`
- `POST /workspaces/:id/memory/nodes/:old_node_id/supersede/:new_node_id`

Recall body:

```json
{
  "query": "What should I remember before changing onboarding?",
  "limit": 8,
  "include_detail": true,
  "include_raw": false,
  "project_hint": "pipsqueak",
  "mode": "task_preparation",
  "memory_types": ["decision", "constraint"],
  "trust_levels": [],
  "include_why": true,
  "include_contradictions": true,
  "include_links": true,
  "include_related": true,
  "include_trust": true,
  "include_rejected": false,
  "include_stale": false
}
```

Recall results always include `source_path` and `raw_ref`. Raw content appears only when `include_raw=true`.
When available, results also include `source_location`, `source_kind`, and `extractor_name`.
Normal recall excludes stale, conflicted, and superseded memory. Set `include_stale=true` for audit/review queries.

Retrieval rule of thumb:

```text
Know the words?   use /memory/grep
Know the idea?    use /memory/search
Starting a task?  use /memory/recall or briefs
Need proof?       open source_path or raw_ref
```

`/memory/grep` is exact text search by default; pass `mode: "hybrid"` or `mode: "semantic"` for broader matching. `/memory/search` is meaning-oriented retrieval. `/memory/recall` is trigger-first progressive task context.

Recall response:

```json
{
  "query": "What should I remember before changing onboarding?",
  "plan": {
    "normalized_query": "What should I remember before changing onboarding?",
    "mode": "task_preparation",
    "topics": ["onboarding"],
    "memory_types": ["decision", "constraint"],
    "needs_recent_runs": false,
    "needs_contradictions": true,
    "needs_raw": false,
    "retrieval_strategy": {
      "trigger_weight": 0.4,
      "summary_weight": 0.2,
      "keyword_weight": 0.14,
      "detail_weight": 0.08,
      "importance_weight": 0.1,
      "recency_weight": 0.05,
      "path_project_weight": 0.04,
      "graph_weight": 0.05
    }
  },
  "brief": "Found 1 source-backed memory for task preparation.",
  "results": [],
  "warnings": [],
  "trace_id": "..."
}
```

Additional endpoints:

- `GET /workspaces/:id/memory/nodes/:node_id/links`
- `POST /workspaces/:id/memory/nodes/:node_id/links`
- `GET /workspaces/:id/memory/graph/nodes/:node_id`
- `GET /workspaces/:id/memory/graph/nodes/:node_id/related?depth=2&limit=12`
- `GET /workspaces/:id/memory/graph/path?from_node_id=...&to_node_id=...`
- `POST /workspaces/:id/memory/graph/links`
- `DELETE /workspaces/:id/memory/graph/links/:edge_id`
- `GET /workspaces/:id/memory/contradictions`
- `POST /workspaces/:id/memory/explain-recall`
- `POST /workspaces/:id/brief`
- `POST /workspaces/:id/runs`
- `GET /workspaces/:id/runs`
- `GET /workspaces/:id/runs/:run_id`
- `POST /workspaces/:id/runs/:run_id/start`
- `POST /workspaces/:id/runs/:run_id/events`
- `POST /workspaces/:id/runs/:run_id/complete`
- `POST /workspaces/:id/runs/:run_id/compile`
- `GET /workspaces/:id/runs/:run_id/memory-used`
- `POST /workspaces/:id/handoff`
- `GET /workspaces/:id/handoffs`
- `GET /workspaces/:id/memory/stale`
- `POST /workspaces/:id/memory/stale/review`
- `POST /workspaces/:id/memory/promote`
- `GET /workspaces/:id/memory/promotions`
- `GET /workspaces/:id/memory/promotions/:promotion_id`
- `POST /workspaces/:id/memory/promotions/:promotion_id/approve`
- `POST /workspaces/:id/memory/promotions/:promotion_id/reject`
- `POST /workspaces/:id/memory/promotions/:promotion_id/apply`
- `GET /workspaces/:id/memory/health`
- `POST /workspaces/:id/memory/health/recompute`

Create link body:

```json
{
  "to_node_id": "node-id",
  "relation_type": "related_to",
  "confidence": 0.7,
  "reason": "Both memories concern onboarding.",
  "actor": "human:web"
}
```

Create graph edge body:

```json
{
  "from_node_id": "node-a",
  "to_node_id": "node-b",
  "relation_type": "supports",
  "confidence": 0.9,
  "reason": "The first memory supports the second.",
  "actor": "human:web"
}
```

For source files and runs, use typed endpoints:

```json
{
  "from_type": "reasoning_memory",
  "from_id": "node-id",
  "to_type": "run",
  "to_id": "run-id",
  "relation_type": "observed_in",
  "source_ref": "verifs://workspace/runs/run-id/reasoning-memories.json#sha"
}
```

Recall results include `links` and `graph_edges` when `include_links=true`.

Brief body:

```json
{
  "task": "Edit Pipsqueak onboarding flow",
  "project_hint": "pipsqueak",
  "actor": "agent:demo",
  "mode": "task_preparation",
  "include_recent_runs": true,
  "include_open_questions": true,
  "include_contradictions": true,
  "limit": 12,
  "create_run": true
}
```

Run completion body:

```json
{
  "result": "What changed",
  "errors": "Optional errors",
  "followups": "Optional next actions",
  "actor": "agent:demo",
  "failed": false
}
```

Promotion body:

```json
{
  "source_path": "/scratch/idea.md",
  "target_path": "/preferences.md",
  "source_node_id": "optional-node-id",
  "reason": "Durable user preference.",
  "actor": "agent:demo",
  "require_review": true,
  "append": true
}
```

Protected targets require approval before apply. Approval applies by default in the API unless `"apply": false` is sent.

## Snapshots

- `POST /workspaces/:id/snapshots`
- `GET /workspaces/:id/snapshots`
- `GET /workspaces/:id/snapshots/:snapshot_id`
- `GET /workspaces/:id/snapshots/:snapshot_id/diff`
- `POST /workspaces/:id/snapshots/:snapshot_id/rollback`

Rollback body:

```json
{
  "dry_run": true,
  "actor": "human:reviewer"
}
```

Rollback is explicit and audited. `dry_run=true` returns the diff without changing workspace state.

## Sync

- `GET /workspaces/:id/sync/status`
- `POST /workspaces/:id/sync/pull`
- `POST /workspaces/:id/sync/push`
- `GET /workspaces/:id/sync/conflicts`
- `POST /workspaces/:id/sync/conflicts/:conflict_id/resolve`

Pull body:

```json
{
  "actor": "agent:sync",
  "events": []
}
```

Resolve body:

```json
{
  "mode": "keep_both",
  "actor": "human:reviewer",
  "manual_content": "Only required for manual_merge."
}
```

Resolution modes are `keep_local`, `keep_remote`, `manual_merge`, and `keep_both`. Protected path conflicts are never silently applied.

## Team And Auth

- `GET /workspaces/:id/team/members`
- `POST /workspaces/:id/team/members`
- `POST /workspaces/:id/team/role`

Member body:

```json
{
  "handle": "agent:demo",
  "role": "agent",
  "display_name": "Demo agent",
  "actor": "human:owner"
}
```

When `VERIFS_AUTH_REQUIRED=true`, send an actor identity with either `Authorization: Bearer <actor>` or `x-verifs-actor: <actor>`. Local mode remains unauthenticated by default.
