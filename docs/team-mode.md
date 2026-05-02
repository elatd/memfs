# Team Mode

Modes:

- `local`: default, unauthenticated, SQLite and local disk.
- `team`: local-first plus auth, roles, sync, and optional remote stores.
- `cloud`: intended for hosted deployments with shared metadata and object storage.

Enable team mode:

```bash
VERIFS_MODE=team
VERIFS_AUTH_REQUIRED=true
VERIFS_SYNC_ENABLED=true
```

Team endpoints:

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

Auth is intentionally simple in the MVP. Send either:

```text
Authorization: Bearer human:owner
x-verifs-actor: human:owner
```

The actor handle is checked against workspace membership. Local mode remains unauthenticated by default.
