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
- `memfs_file_append`
- `memfs_file_upload`
- `memfs_file_extract`
- `memfs_extracted_source_read`
- `memfs_file_delete`
- `memfs_grep`
- `memfs_memory_search`
- `memfs_memory_recall`
- `memfs_memory_node_read`
- `memfs_memory_raw_read`
- `memfs_audit_list`
- `memfs_memory_promote`
- `memfs_promotion_list`
- `memfs_candidate_create`
- `memfs_candidate_list`
- `memfs_candidate_read`
- `memfs_candidate_update`
- `memfs_snapshot_create`
- `memfs_snapshot_list`
- `memfs_memory_health`
- `memfs_brief`
- `memfs_run_create`
- `memfs_run_append`
- `memfs_run_log_event`
- `memfs_run_complete`
- `memfs_run_compile`
- `memfs_run_lessons`
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
- `include_stale`

Safety:

- Protected file writes and deletes require `allow_protected_write=true`.
- `memfs_file_append` and `memfs_run_append` are the preferred way for agents to keep scratch and run notes during work.
- Raw source content is available only through `memfs_memory_raw_read` or `include_raw=true` on recall.
- `memfs_memory_search` is meaning-oriented hybrid search and returns the same grep/search result shape as `memfs_grep` with `mode: "hybrid"`.
- Memory search and recall return `source_path` and `raw_ref`.
- `memfs_grep` is exact by default. Use `memfs_memory_search` for meaning-oriented search, or pass `mode: "hybrid"` / `mode: "semantic"` to `memfs_grep`.
- Recall returns source locations when available.
- Uploaded raw blobs remain canonical; extracted text returned by `memfs_extracted_source_read` is derived metadata.
- Explainable recall can return score components and graph links, but raw source stays hidden unless explicitly requested.
- Agents can propose promotions through `memfs_memory_promote`.
- Agents can propose reviewable memories through `memfs_candidate_create`.
- Approval and rejection tools are not exposed by default, so an MCP agent cannot silently approve durable memory.
- Agents can create briefs and runs, log task events, compile run artifacts, create handoffs, and list stale, conflicted, superseded, old, or unconfirmed memory for review.
- MCP does not expose a default supersede tool; protected durable memory still requires the configured review/permission path.
- Sync tools stay workspace scoped. Team administration and conflict approval tools are not exposed to MCP agents by default.

OpenClaw-style aliases such as `brief_create`, `run_append`, `candidate_create`, and `memory_raw_source_read` are documented in [OpenClaw MCP Setup](./openclaw.md).
