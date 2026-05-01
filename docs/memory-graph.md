# Memory Graph

MemFS links memory nodes to make recall explainable and inspectable.

Link schema:

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

Relation types:

- `related_to`
- `supports`
- `contradicts`
- `supersedes`
- `duplicates`
- `caused_by`
- `derived_from`
- `belongs_to_project`
- `used_in_run`
- `promoted_from`

Insertion behavior:

1. New memory nodes are compared with existing nodes in the same workspace.
2. Exact or near-identical memories are linked with `duplicates`; they are not deleted.
3. Memories with overlapping terms and negation are linked with `contradicts`.
4. Memories that say they now replace earlier context are linked with `supersedes`.
5. Similar topic or project memories are linked with `related_to`.

Contradictions are available at:

```http
GET /workspaces/:id/memory/contradictions
```

The dashboard exposes a graph panel on node detail and a contradictions inbox. Raw source remains behind explicit raw reads.
