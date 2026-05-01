# Sync

Sync is optional. Local mode works without sync, and sync never bypasses protected path rules.

Endpoints:

- `GET /workspaces/:id/sync/status`
- `POST /workspaces/:id/sync/pull`
- `POST /workspaces/:id/sync/push`
- `GET /workspaces/:id/sync/conflicts`
- `POST /workspaces/:id/sync/conflicts/:conflict_id/resolve`

Sync event shape:

```json
{
  "id": "event-id",
  "workspace_id": "workspace-id",
  "object_type": "files",
  "object_id": "file-id",
  "operation": "upsert",
  "object_version": "2026-05-01T00:00:00.000Z",
  "payload_json": "{}",
  "actor": "agent:sync",
  "created_at": "2026-05-01T00:00:00.000Z"
}
```

Conflict detection covers same-file edits and protected path changes. File conflicts default to keep-both resolution by writing a copy under:

```text
/conflicts/<timestamp>/<original_path>
```

Resolution modes:

- `keep_local`
- `keep_remote`
- `manual_merge`
- `keep_both`

Protected path conflicts are not auto-applied. They must be resolved explicitly and are audited.
