# Handoff

Handoffs summarize the current state for the next task.

`POST /workspaces/:id/handoff` creates a concise handoff for a run or project. It includes current state, decisions, open questions, next actions, and warnings.

Outputs:

- `/runs/<run_id>/handoff.md` when a run is provided.
- `/handoffs/<timestamp>-<project>.md` for project or workspace handoffs.

Handoff files are ingested as memory, but raw files remain the source of truth.
