# Memory Health

Memory health summarizes whether a workspace is safe to rely on.

Dimensions:

- `source_coverage`
- `contradiction_count`
- `unresolved_promotion_count`
- `stale_node_count`
- `old_node_count`
- `unconfirmed_node_count`
- `superseded_node_count`
- `conflicted_node_count`
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

Temporal health fields help MemFS explain what changed over time:

- `stale_node_count` includes memories explicitly marked stale, conflicted, superseded, past `valid_until`, or past TTL.
- `old_node_count` counts non-rejected memories whose confirmation/update timestamp is older than the current health threshold.
- `unconfirmed_node_count` counts active durable memory that has not been explicitly confirmed.
- `superseded_node_count` counts memories marked superseded by status or trust metadata.
- `conflicted_node_count` counts memories marked conflicted for review.

Stale and superseded memory is kept for audit and rollback. Normal recall excludes it unless callers opt in with stale/audit-oriented options such as `include_stale` or `memfs grep --include-stale`.
