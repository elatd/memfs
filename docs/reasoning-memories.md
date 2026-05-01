# Reasoning Memories

Reasoning memories are reusable lessons distilled from completed or failed agent runs.

They are not raw chain-of-thought. MemFS stores concise, source-backed reasoning summaries: the situation, the strategy, the failure pattern, the success pattern, and when the lesson should be recalled again.

Run reasoning extraction is review-first:

```bash
memfs run compile <run_id> --reasoning
memfs run lessons <run_id>
```

The compiler writes `/runs/<run_id>/reasoning-memories.json` and creates `reasoning_memory` candidate nodes that point back to the run artifacts. Candidates remain `status=candidate` and `trust_level=agent_generated` until reviewed through the normal candidate or promotion workflow.

Each reasoning candidate includes:

- `type: reasoning_memory`
- `title`
- `trigger`
- `context`
- `strategy`
- `failure_pattern`
- `success_pattern`
- `applies_to[]`
- `preconditions[]`
- `anti_patterns[]`
- `source_run`
- `source_refs[]`
- `confidence`
- `status: candidate`
- `reason`

If an LLM is configured, MemFS asks it for strict JSON and validates the output before storing anything. If no model is configured, deterministic extraction looks for failures, successes, strategies, and follow-up patterns in `result.md`, `errors.md`, `followups.md`, `actions.md`, and `memory-used.md`.

Repeated compiles dedupe reasoning memories by title, trigger, source run, and embedding similarity when available. The compiler does not auto-approve reasoning memories.
