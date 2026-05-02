# Retrieval Benchmark

Run:

```bash
pnpm benchmark:retrieval
```

The benchmark creates a temporary local VeriFS workspace and seeds a small fixture corpus:

- project facts
- decisions
- constraints
- run logs
- handoffs
- reasoning memories
- stale and superseded memories
- archive transcripts

It then runs fixed agent-style queries and reports:

- top-1 hit
- top-3 hit
- source reference present
- stale memory excluded
- trusted/source-backed result preferred where applicable

The harness uses deterministic local extraction and hash embeddings by setting `useLlm: false`, so it does not require an external API key.

## Limitations

- The fixture corpus is intentionally small and is meant for regression checks, not broad retrieval evaluation.
- Local hash embeddings do not measure hosted embedding model behavior.
- Runtime-generated run and archive paths are resolved through fixture labels before scoring.
- Ranking changes may improve real-world behavior while changing this benchmark's top-1 score; inspect top-3 and source-reference metrics before treating a failure as a product regression.
