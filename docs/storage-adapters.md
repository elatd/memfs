# Storage Adapters

MemFS keeps local mode as the default, but Phase 6 adds adapter boundaries for team and cloud deployments.

Interfaces live in `packages/core/src/adapters.ts` and `packages/db/src/adapters.ts`:

- `MetadataStore`: workspace, file, blob, and memory-node metadata.
- `BlobStore`: content-addressed raw blob storage.
- `WorkspaceFileStore`: materialized workspace files.
- `SyncStore`: push and pull sync event packets.
- `AuthzProvider`: optional external authorization.

Implemented adapters:

- `SQLiteMetadataStore`: wraps the existing local SQLite database behavior.
- `PostgresMetadataStore`: Postgres-shaped metadata adapter with a test fallback when no connection is configured.
- `LocalBlobStore`: writes SHA-256 blobs under `data/blobs`.
- `ObjectBlobStore`: writes SHA-256 blobs through an injected S3-compatible client.
- `LocalWorkspaceFileStore`: writes readable files under `data/workspaces`.
- `InMemorySyncStore`: test and local development sync transport.

Raw files and blobs remain canonical. Memory nodes are still retrieval indexes regardless of which adapter stores metadata.
