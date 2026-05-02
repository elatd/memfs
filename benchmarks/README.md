# MemFS Benchmarks

MemFS benchmarks are local, deterministic checks for source-backed memory behavior.

Run the smoke suite:

```bash
pnpm bench:smoke
```

Run the MemFS-only regression slice:

```bash
pnpm bench:memfs
```

The smoke suite compares a `no-memory` baseline with the real MemFS adapter. It writes JSON and Markdown reports to `benchmarks/results/`; those files are generated artifacts and are not committed.

The current smoke dataset is intentionally small. A 100% score means the benchmark harness and deterministic fixtures are healthy. It does not claim external benchmark superiority or broad retrieval performance.

Planned additions:

- LongMemEval adapter
- LoCoMo adapter
- task-memory benchmark for measuring whether pre-task briefs, run logs, and curated memories improve future agent runs
