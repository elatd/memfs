# Source References

Every memory node must point back to source:

- `source_file_id`
- `source_blob_sha256`
- `source_path`
- `raw_ref`
- optional `source_location_json`

Recall packets include `source_path` and `raw_ref` for every result. When extraction provides a precise location, recall also includes `source_location`, `source_kind`, and `extractor_name`.

Example source locations:

```json
{ "type": "markdown", "heading_path": "Project > Decisions", "start_line": 1, "end_line": 12 }
```

```json
{ "type": "csv", "row_start": 2, "row_end": 26, "columns": ["status", "owner"] }
```

```json
{ "type": "code", "start_line": 10, "end_line": 35, "symbol": "createUser" }
```

```json
{ "type": "terminal_log", "command": "pnpm test", "line_start": 100, "line_end": 160 }
```

Raw content remains gated. Use `include_raw=true`, `memfs raw <node_id>`, or `memfs_memory_raw_read` only when the caller explicitly needs canonical source bytes rendered as text.

Memory nodes are never canonical truth. They are retrieval indexes with source references so humans and agents can inspect the original file before making durable decisions.
