# Deployment

## Local

```bash
MEMFS_MODE=local
MEMFS_DATA_DIR=./data
pnpm dev
```

Local mode uses SQLite and local disk. It does not require auth by default.

## Team

```bash
MEMFS_MODE=team
MEMFS_AUTH_REQUIRED=true
MEMFS_SYNC_ENABLED=true
MEMFS_DATA_DIR=./data
pnpm --filter @memoryfs/api dev
```

Team mode enables role checks and sync surfaces while preserving local data support.

## Cloud

```bash
MEMFS_MODE=cloud
MEMFS_AUTH_REQUIRED=true
MEMFS_SYNC_ENABLED=true
MEMFS_DATABASE_URL=postgres://user:password@host:5432/memfs
MEMFS_OBJECT_STORE_BUCKET=memfs
```

Cloud mode should run Postgres migrations and use shared object storage for blobs. The API keeps the same file and memory endpoints; auth supplies the actor identity.

Never expose OpenAI-compatible API keys to the dashboard. Keep model credentials on the API, MCP server, or other server-side process.
