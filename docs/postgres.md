# Postgres Backend

Local SQLite mode remains the default. Postgres support is added behind a metadata adapter so cloud/team deployments can move metadata out of the local `.db` file without changing the public API shape.

Configuration:

```bash
MEMFS_MODE=team
MEMFS_DATABASE_URL=postgres://user:password@localhost:5432/memfs
```

Postgres-compatible migrations are stored in:

```text
packages/db/migrations/postgres/001_initial.sql
```

The current adapter covers the core Phase 6 metadata contract: workspaces, files, blobs, memory nodes, and sync events. SQLite migrations remain separate and local mode continues to use SQLite directly.

For production use, run Postgres migrations before starting the API and keep object storage configured for raw blobs when multiple instances need shared blob access.
