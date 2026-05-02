# Deployment

## Local

```bash
VERIFS_MODE=local
VERIFS_DATA_DIR=./data
pnpm dev
```

Local mode uses SQLite and local disk. It does not require auth by default.

## Team

```bash
VERIFS_MODE=team
VERIFS_AUTH_REQUIRED=true
VERIFS_SYNC_ENABLED=true
VERIFS_DATA_DIR=./data
pnpm --filter @verifs/api dev
```

Team mode enables role checks and sync surfaces while preserving local data support.

## Cloud

```bash
VERIFS_MODE=cloud
VERIFS_AUTH_REQUIRED=true
VERIFS_SYNC_ENABLED=true
VERIFS_DATABASE_URL=postgres://user:password@host:5432/verifs
VERIFS_OBJECT_STORE_BUCKET=verifs
```

Cloud mode should run Postgres migrations and use shared object storage for blobs. The API keeps the same file and memory endpoints; auth supplies the actor identity.

Never expose OpenAI-compatible API keys to the dashboard. Keep model credentials on the API, MCP server, or other server-side process.
