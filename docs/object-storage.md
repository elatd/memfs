# Object Storage

MemFS stores raw content by SHA-256. Local mode writes to `data/blobs`; cloud/team mode can use `ObjectBlobStore` with an S3-compatible client.

Configuration names:

```bash
MEMFS_OBJECT_STORE_ENDPOINT=
MEMFS_OBJECT_STORE_BUCKET=memfs
MEMFS_OBJECT_STORE_REGION=auto
MEMFS_OBJECT_STORE_ACCESS_KEY_ID=
MEMFS_OBJECT_STORE_SECRET_ACCESS_KEY=
```

The MVP does not require a specific S3 SDK. `ObjectBlobStore` accepts a tiny client interface:

```ts
{
  putObject({ bucket, key, body, contentType }): Promise<void>
  getObject({ bucket, key }): Promise<Uint8Array>
}
```

Keys are deterministic:

```text
<prefix>/blobs/<sha256_prefix>/<sha256>
```

Object storage never becomes canonical over files. The canonical source is still the uploaded or written raw blob plus the file metadata that points at it.
