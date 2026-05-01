# MemFS MCP

Run the MCP server:

```bash
pnpm --filter @memoryfs/mcp dev
```

Example config:

```json
{
  "mcpServers": {
    "memfs": {
      "command": "pnpm",
      "args": ["--filter", "@memoryfs/mcp", "start"],
      "cwd": "/absolute/path/to/memoryfs",
      "env": {
        "MEMFS_DATA_DIR": "./data"
      }
    }
  }
}
```

Tools:

- `memfs_workspace_list`
- `memfs_workspace_create`
- `memfs_file_list`
- `memfs_file_read`
- `memfs_file_write`
- `memfs_file_upload`
- `memfs_file_extract`
- `memfs_extracted_source_read`
- `memfs_file_delete`
- `memfs_memory_search`
- `memfs_memory_recall`
- `memfs_memory_node_read`
- `memfs_memory_raw_read`
- `memfs_audit_list`
- `memfs_memory_promote`
- `memfs_promotion_list`
- `memfs_snapshot_create`
- `memfs_snapshot_list`
- `memfs_memory_health`
- `memfs_brief`
- `memfs_run_create`
- `memfs_run_log_event`
- `memfs_run_complete`
- `memfs_run_compile`
- `memfs_handoff`
- `memfs_stale_memory_list`
- `memfs_sync_status`
- `memfs_sync_pull`
- `memfs_sync_push`
- `memfs_sync_conflict_list`

`memfs_memory_recall` accepts the same explainable recall options as the API:

- `mode`
- `memory_types`
- `trust_levels`
- `include_why`
- `include_links`
- `include_contradictions`
- `include_raw`
- `include_trust`
- `include_rejected`

Safety:

- Protected file writes and deletes require `allow_protected_write=true`.
- Raw source content is available only through `memfs_memory_raw_read` or `include_raw=true` on recall.
- Memory search and recall return `source_path` and `raw_ref`.
- Recall returns source locations when available.
- Uploaded raw blobs remain canonical; extracted text returned by `memfs_extracted_source_read` is derived metadata.
- Explainable recall can return score components and graph links, but raw source stays hidden unless explicitly requested.
- Agents can propose promotions through `memfs_memory_promote`.
- Approval and rejection tools are not exposed by default, so an MCP agent cannot silently approve durable memory.
- Agents can create briefs and runs, log task events, compile run artifacts, create handoffs, and list stale memory.
- Sync tools stay workspace scoped. Team administration and conflict approval tools are not exposed to MCP agents by default.
