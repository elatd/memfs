# Compile Run

Compile-run turns task artifacts into candidate memory.

`POST /workspaces/:id/runs/:run_id/compile` reads run artifacts, extracts candidate memories, writes `/runs/<run_id>/candidates.md`, creates agent-generated candidate nodes, suggests promotions for durable memory, and marks the run compiled.

Pass `reasoning: true` or run `verifs run compile <run_id> --reasoning` to also write `/runs/<run_id>/reasoning-memories.json` and create reviewable `reasoning_memory` candidates. Reasoning candidates capture reusable lessons from successes and failures; they are not auto-approved.

Compile response:

- `candidate_nodes`
- `reasoning_candidates`
- `suggested_promotions`
- `contradictions`
- `followups`
- `summary`

Suggested promotions require the normal review workflow before becoming trusted durable memory.
