# VeriFS MCP

Run the MCP server:

```bash
pnpm --filter @verifs/mcp dev
```

Example config:

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

Tools:

- `verifs_workspace_list`
- `verifs_workspace_create`
- `verifs_file_list`
- `verifs_file_read`
- `verifs_file_write`
- `verifs_file_append`
- `verifs_file_upload`
- `verifs_file_extract`
- `verifs_extracted_source_read`
- `verifs_file_delete`
- `verifs_grep`
- `verifs_memory_search`
- `verifs_memory_recall`
- `verifs_memory_node_read`
- `verifs_memory_raw_read`
- `verifs_audit_list`
- `verifs_memory_promote`
- `verifs_promotion_list`
- `verifs_candidate_create`
- `verifs_candidate_list`
- `verifs_candidate_read`
- `verifs_candidate_update`
- `verifs_snapshot_create`
- `verifs_snapshot_list`
- `verifs_memory_health`
- `verifs_brief`
- `verifs_run_create`
- `verifs_run_append`
- `verifs_run_log_event`
- `verifs_run_complete`
- `verifs_run_compile`
- `verifs_run_lessons`
- `verifs_handoff`
- `verifs_stale_memory_list`
- `verifs_sync_status`
- `verifs_sync_pull`
- `verifs_sync_push`
- `verifs_sync_conflict_list`

`verifs_memory_recall` accepts the same explainable recall options as the API:

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
- `verifs_file_append` and `verifs_run_append` are the preferred way for agents to keep scratch and run notes during work.
- Raw source content is available only through `verifs_memory_raw_read` or `include_raw=true` on recall.
- `verifs_memory_search` is meaning-oriented hybrid search and returns the same grep/search result shape as `verifs_grep` with `mode: "hybrid"`.
- Memory search and recall return `source_path` and `raw_ref`.
- `verifs_grep` is exact by default. Use `verifs_memory_search` for meaning-oriented search, or pass `mode: "hybrid"` / `mode: "semantic"` to `verifs_grep`.
- Recall returns source locations when available.
- Uploaded raw blobs remain canonical; extracted text returned by `verifs_extracted_source_read` is derived metadata.
- Explainable recall can return score components and graph links, but raw source stays hidden unless explicitly requested.
- Agents can propose promotions through `verifs_memory_promote`.
- Agents can propose reviewable memories through `verifs_candidate_create`.
- Approval and rejection tools are not exposed by default, so an MCP agent cannot silently approve durable memory.
- Agents can create briefs and runs, log task events, compile run artifacts, create handoffs, and list stale, conflicted, superseded, old, or unconfirmed memory for review.
- MCP does not expose a default supersede tool; protected durable memory still requires the configured review/permission path.
- Sync tools stay workspace scoped. Team administration and conflict approval tools are not exposed to MCP agents by default.

OpenClaw-style aliases such as `brief_create`, `run_append`, `candidate_create`, and `memory_raw_source_read` are documented in [OpenClaw MCP Setup](./openclaw.md).
