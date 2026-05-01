# Audit Events

MemFS records audit events for workspace, file, memory, sync, trust, and mount activity.

Audit events are local metadata. They do not replace raw files as source of truth, but they make memory changes inspectable.

## Mount Events

The mount layer records these events when audit support is available:

- `mount.started`
- `mount.stopped`
- `mount.file.read`
- `mount.file.write`
- `mount.file.delete`
- `mount.protected_write.denied`
- `mount.recall.query`
- `mount.search.query`

Protected write denials also keep the underlying core event, such as `protected_write_denied`.

## API

Read audit events:

```http
GET /workspaces/:id/audit-events?limit=100
```

Record an audit event:

```http
POST /workspaces/:id/audit-events
```

Body:

```json
{
  "actor": "mount:local",
  "event_type": "mount.started",
  "payload": {
    "mountpoint": "/Users/me/MemFS/demo"
  }
}
```
