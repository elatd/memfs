# VeriFS MCP Server

This server exposes VeriFS workspaces, files, memory, raw source reads, and audit events through MCP tools.

Run from the repository root:

```bash
pnpm --filter @verifs/mcp dev
```

Example MCP config:

```json
{
  "mcpServers": {
    "verifs": {
      "command": "pnpm",
      "args": ["--filter", "@verifs/mcp", "start"],
      "cwd": "/absolute/path/to/verifs",
      "env": {
        "VERIFS_DATA_DIR": "./data"
      }
    }
  }
}
```

Preferred tools:

- `verifs_workspace_list`
- `verifs_workspace_create`
- `verifs_file_list`
- `verifs_file_read`
- `verifs_file_write`
- `verifs_file_delete`
- `verifs_memory_search`
- `verifs_memory_recall`
- `verifs_memory_node_read`
- `verifs_memory_raw_read`
- `verifs_audit_list`
- `verifs_memory_promote`
- `verifs_promotion_list`
- `verifs_snapshot_create`
- `verifs_snapshot_list`
- `verifs_memory_health`
- `verifs_brief`
- `verifs_run_create`
- `verifs_run_log_event`
- `verifs_run_complete`
- `verifs_run_compile`
- `verifs_handoff`
- `verifs_stale_memory_list`
- `verifs_sync_status`
- `verifs_sync_pull`
- `verifs_sync_push`
- `verifs_sync_conflict_list`

`verifs_memory_search` runs meaning-oriented hybrid search and returns the same grep/search result shape as `verifs_grep` with `mode=hybrid`. `verifs_memory_recall` supports explainable recall fields including `mode`, `memory_types`, `trust_levels`, `include_why`, `include_links`, `include_contradictions`, `include_trust`, `include_rejected`, and `include_raw`. Results keep `source_path` and `raw_ref` visible; raw source is returned only when explicitly requested.

MCP agents can propose promotions, create snapshots, list snapshots, create briefs and runs, log task events, compile runs, create handoffs, list stale memory, inspect workspace-scoped sync status, and read memory health. Approval, rejection, conflict resolution, and team administration tools are intentionally not exposed by default.
