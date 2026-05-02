# OpenClaw And Coding Agent MCP Setup

VeriFS can be used as an MCP memory server for coding agents and OpenClaw-style agents. The server exposes safe tools for workspace setup, source-backed search, pre-task briefs, run notes, candidate memories, audit, snapshots, and memory health.

## Sample MCP Config

```json
{
  "mcpServers": {
    "verifs": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/verifs", "--filter", "@verifs/mcp", "dev"],
      "env": {
        "VERIFS_DATA_DIR": "/absolute/path/to/verifs/data",
        "VERIFS_MODE": "local"
      }
    }
  }
}
```

If the agent host expects a direct Node command, use the built package entry for the MCP app instead of `pnpm --filter`.

## Recommended Agent Instructions

Use this instruction block for coding agents:

> Before starting project work, call brief_create. During work, write run notes under /runs. After work, call run_compile and propose memory candidates. Do not write durable protected memory directly unless explicitly instructed.

Longer version:

1. Select or create a workspace with `workspace_list` and `workspace_create`.
2. Before project work, call `brief_create` with the task, project, repo, or likely files.
3. Create a run with `run_create` or use the run returned by a brief.
4. During work, use `run_append` or `file_append` under `/runs/<run_id>/...` for notes, results, errors, followups, and actions.
5. Use `verifs_grep` when you know the exact words, `memory_search` when you know the idea, and `memory_recall` when you need task context. Prefer snippets, `source_path`, and `raw_ref`; call `memory_raw_source_read` only when raw source is explicitly needed.
6. Use `candidate_create` or `promotion_request` to propose durable memory. Normal agents should not approve protected durable memory.
7. After work, call `run_complete`, then `run_compile` with `reasoning=true` when reusable lessons may exist.
8. Use `handoff_create` when another agent or human needs to continue.

## Safe Toolset

OpenClaw-style aliases:

- `workspace_list`
- `workspace_create`
- `file_read`
- `file_write`
- `file_append`
- `file_upload`
- `file_extract`
- `verifs_grep`
- `memory_recall`
- `memory_search`
- `memory_raw_source_read`
- `candidate_create`
- `candidate_list`
- `candidate_read`
- `promotion_request`
- `run_create`
- `run_append`
- `run_complete`
- `run_compile`
- `brief_create`
- `handoff_create`
- `stale_list`
- `audit_list`
- `snapshot_create`
- `health_report`

The same functionality is also available through `verifs_*` tool names for clients that prefer namespaced tools.

## Safety Model

- Agents may write scratch files and run artifacts.
- Agents may propose memories and promotion requests.
- Agents may not approve protected durable memory through the default MCP toolset.
- Protected paths such as `/profile.md`, `/preferences.md`, `/projects/*/decisions.md`, and `/projects/*/constraints.md` require explicit `allow_protected_write=true`.
- Raw source reads are explicit through `memory_raw_source_read` or `verifs_memory_raw_read`.
- Recall, search, grep, briefs, and candidates return source paths and raw refs so agents can cite or inspect evidence without silently ingesting raw source.

## Minimal Workflow

```text
workspace_list
brief_create(workspace_id, task, project_slug?, files?)
run_create(workspace_id, task)
run_append(workspace_id, run_id, kind="note", text="...")
verifs_grep(workspace_id, query)
candidate_create(workspace_id, memory_text, promotion_target_path?)
run_complete(workspace_id, run_id, result?, errors?, followups?)
run_compile(workspace_id, run_id, reasoning=true)
handoff_create(workspace_id, run_id)
```
