# Compile Run

Compile-run turns task artifacts into candidate memory.

`POST /workspaces/:id/runs/:run_id/compile` reads run artifacts, extracts candidate memories, writes `/runs/<run_id>/candidates.md`, creates agent-generated candidate nodes, suggests promotions for durable memory, and marks the run compiled.

Compile response:

- `candidate_nodes`
- `suggested_promotions`
- `contradictions`
- `followups`
- `summary`

Suggested promotions require the normal review workflow before becoming trusted durable memory.
