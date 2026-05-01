# Memory Graph

MemFS keeps an associative memory graph so related memories, source files, runs, candidates, and reasoning memories can be inspected together without hiding the source evidence.

Raw files remain canonical. Graph edges are retrieval and explanation metadata: they help recall and briefs surface adjacent context, but each memory still carries `source_path`, `raw_ref`, trust, and status fields.

## Edge Storage

Node-to-node links are stored in `memory_links` for compatibility with existing recall, contradiction, and supersession behavior:

```json
{
  "id": "link-id",
  "workspace_id": "workspace-id",
  "from_node_id": "node-a",
  "to_node_id": "node-b",
  "relation_type": "contradicts",
  "confidence": 0.82,
  "reason": "The memories discuss overlapping terms but one contains a negating constraint or decision.",
  "created_at": "2026-05-01T00:00:00.000Z"
}
```

Typed object edges are stored in `memory_graph_edges` when the relationship points beyond ordinary memory nodes, such as a memory derived from a source file or observed in a run:

```json
{
  "id": "edge-id",
  "workspace_id": "workspace-id",
  "from_type": "reasoning_memory",
  "from_id": "node-id",
  "to_type": "run",
  "to_id": "run-id",
  "relation_type": "observed_in",
  "confidence": 0.95,
  "reason": "Memory node was observed in run run-id.",
  "source_ref": "memoryfs://workspace/runs/run-id/reasoning-memories.json#sha",
  "created_at": "2026-05-01T00:00:00.000Z"
}
```

Endpoint types:

- `memory_node`
- `candidate`
- `reasoning_memory`
- `file`
- `run`

Relation types:

- `related_to`
- `supports`
- `contradicts`
- `supersedes`
- `caused_by`
- `derived_from`
- `implemented_in`
- `observed_in`
- `applies_to`
- `blocked_by`

MemFS also preserves earlier internal relation names for compatibility: `duplicates`, `belongs_to_project`, `used_in_run`, and `promoted_from`.

## Automatic Edges

MemFS creates edges during normal workflows:

1. New memory nodes are compared with existing nodes in the same workspace.
2. Exact or near-identical memories are linked with `duplicates`; they are not deleted.
3. Memories with overlapping terms and negation are linked with `contradicts`.
4. Supersession actions create `supersedes` links and mark the older memory as superseded.
5. Memories from the same source file are linked with `derived_from`.
6. Memory nodes, candidates, and reasoning memories are linked back to their source file.
7. Run-derived candidates and reasoning memories are linked to their run with `observed_in`.
8. Promotion candidates can link back to their proposed source with `promoted_from`.

## CLI

```bash
memfs graph node <node_id>
memfs graph related <node_id>
memfs graph link <from_node_id> <relation_type> <to_node_id>
memfs graph unlink <edge_id>
memfs graph path <from_node_id> <to_node_id>
```

Examples:

```bash
memfs graph link mem-a supports mem-b --reason "Rotation supports server-side refresh token storage"
memfs graph related mem-a --depth 2 --limit 10
memfs graph path mem-a mem-b
```

For non-memory endpoints, pass endpoint types:

```bash
memfs graph link mem-a implemented_in file-id --to-type file
```

## API

Contradictions:

```http
GET /workspaces/:id/memory/contradictions
```

Graph endpoints:

```http
GET /workspaces/:id/memory/graph/nodes/:node_id
GET /workspaces/:id/memory/graph/nodes/:node_id/related
GET /workspaces/:id/memory/graph/path?from_node_id=...&to_node_id=...
POST /workspaces/:id/memory/graph/links
DELETE /workspaces/:id/memory/graph/links/:edge_id
```

Create edge body:

```json
{
  "from_node_id": "node-a",
  "to_node_id": "node-b",
  "relation_type": "supports",
  "confidence": 0.9,
  "reason": "Both memories describe the same OAuth refresh token constraint.",
  "actor": "human:web"
}
```

Generic edge body:

```json
{
  "from_type": "reasoning_memory",
  "from_id": "node-id",
  "to_type": "run",
  "to_id": "run-id",
  "relation_type": "observed_in",
  "source_ref": "memoryfs://workspace/runs/run-id/reasoning-memories.json#sha"
}
```

## Recall And Briefs

Recall already uses graph proximity as one ranking signal. Set `include_links=true` to include node links and graph edges in recall results.

Briefs call recall with links enabled, so source-backed associations can inform the compact pre-task context pack. Related nodes are additive context only: briefs and recall continue to show source paths and raw refs for the memory being used.

The dashboard exposes graph context on node detail and a contradictions inbox. Raw source remains behind explicit raw reads.
