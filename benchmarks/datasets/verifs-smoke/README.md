# VeriFS Smoke Dataset

This deterministic JSONL dataset exercises the first adapter-based benchmark harness without external model calls.

Each line is one case with:

- `id`
- `sources`
- `question`
- `expected_answer_keywords`
- `expected_source_ids`
- `should_abstain`
