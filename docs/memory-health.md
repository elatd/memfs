# Memory Health

Memory health summarizes whether a workspace is safe to rely on.

Dimensions:

- `source_coverage`
- `contradiction_count`
- `unresolved_promotion_count`
- `stale_node_count`
- `rejected_node_count`
- `low_confidence_count`
- `orphan_node_count`
- `raw_missing_count`
- `unreviewed_trusted_path_writes`
- `overall_score`

Read the latest report:

```http
GET /workspaces/:id/memory/health
```

Recompute:

```http
POST /workspaces/:id/memory/health/recompute
```

The dashboard trust panel shows the score, high-signal counts, pending promotions, snapshots, and contradiction status.
