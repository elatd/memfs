# Briefs

Briefs are the pre-task memory step.

`POST /workspaces/:id/brief` recalls relevant facts, decisions, constraints, preferences, previous failures, successful patterns, reasoning memories, stale or conflicted assumptions, likely paths, and suggested next memory actions. Raw source is not included unless requested.

When `create_run=true`, VeriFS creates a run folder and writes the brief to `/runs/<run_id>/brief.md`.

CLI:

```bash
verifs brief "Fix OAuth refresh token flow" --project auth
verifs brief "Fix OAuth refresh token flow" --include-candidates
verifs brief "Fix OAuth refresh token flow" --json
```

Briefs are trust-aware by default. Normal briefs prefer reviewed, trusted, and source-backed memory. Candidate memories, including reasoning memories produced by `verifs run compile --reasoning`, are excluded unless `include_candidates=true` or `--include-candidates` is set.

Brief retrieval enables associative graph context. Related nodes may be returned in `memory_results[].related_nodes`, but each primary brief item still includes its own source path, raw ref, trust level, and status.

Each structured brief item includes source metadata:

- source path
- raw reference
- node id
- trust level
- status
- score
- scope metadata when available

Scope filters can be passed with project, repo, session, agent, contact, or run identifiers. For example, `--project auth` scopes the brief to `/projects/auth/...` memory.
