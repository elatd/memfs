# Snapshots

Snapshots capture workspace state for reviewable rollback.

Captured item types:

- files
- referenced blobs
- memory nodes
- memory links
- protected paths

Create:

```bash
verifs snapshot create before-review
```

Diff:

```bash
verifs snapshot diff <snapshot_id>
```

Dry-run rollback:

```bash
verifs rollback <snapshot_id> --dry-run
```

Rollback restores captured tables, rewrites workspace files, rebuilds embeddings, and emits `snapshot_rollback`. Audit history is not erased.
