# MemFS MCP Server

This server exposes MemFS workspaces, files, memory, raw source reads, and audit events through MCP tools.

Run from the repository root:

```bash
pnpm --filter @memoryfs/mcp dev
```

Example MCP config:

```json
{
  "mcpServers": {
    "memoryfs": {
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

Preferred tools:

- `memfs_workspace_list`
- `memfs_workspace_create`
- `memfs_file_list`
- `memfs_file_read`
- `memfs_file_write`
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

`memfs_memory_search` runs meaning-oriented hybrid search and returns the same grep/search result shape as `memfs_grep` with `mode=hybrid`. `memfs_memory_recall` supports explainable recall fields including `mode`, `memory_types`, `trust_levels`, `include_why`, `include_links`, `include_contradictions`, `include_trust`, `include_rejected`, and `include_raw`. Results keep `source_path` and `raw_ref` visible; raw source is returned only when explicitly requested.

MCP agents can propose promotions, create snapshots, list snapshots, create briefs and runs, log task events, compile runs, create handoffs, list stale memory, inspect workspace-scoped sync status, and read memory health. Approval, rejection, conflict resolution, and team administration tools are intentionally not exposed by default.
