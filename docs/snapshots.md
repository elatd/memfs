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
memfs snapshot create before-review
```

Diff:

```bash
memfs snapshot diff <snapshot_id>
```

Dry-run rollback:

```bash
memfs rollback <snapshot_id> --dry-run
```

Rollback restores captured tables, rewrites workspace files, rebuilds embeddings, and emits `snapshot_rollback`. Audit history is not erased.
