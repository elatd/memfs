# Mounted Agent Workflow

VeriFS mounts are designed for agents that prefer ordinary file operations while still preserving VeriFS safety guarantees.

## Recommended Flow

1. Mount the workspace read-write only when the task needs file writes.

```bash
pnpm exec verifs mount demo ~/VeriFS/demo --read-write --ingest-on-write --actor mount:agent
```

2. Put task artifacts under `/runs/`.

```bash
mkdir -p ~/VeriFS/demo/runs/today
echo "Plan and actions go here." >> ~/VeriFS/demo/runs/today/actions.md
echo "Final task result." >> ~/VeriFS/demo/runs/today/result.md
```

3. Use semantic control files for lightweight context checks.

```bash
echo "What matters before changing onboarding?" > ~/VeriFS/demo/.verifs/recall.query
cat ~/VeriFS/demo/.verifs/recall.results.md

echo "onboarding decision" > ~/VeriFS/demo/.verifs/search.query
cat ~/VeriFS/demo/.verifs/search.results.md

echo "Fix OAuth refresh token flow" > ~/VeriFS/demo/.verifs/brief.query
cat ~/VeriFS/demo/.verifs/brief.results.md
```

Each mount keeps its own latest `recall.results.md`, `search.results.md`, and `brief.results.md`; separate mounts do not share query state.

`search.query` uses VeriFS meaning-oriented hybrid search. `recall.query` uses normal trusted recall behavior and excludes stale, rejected, and superseded memory by default. `brief.query` creates a pre-task context pack without raw source content.

All three result files include source paths, trust levels, scores, memory node ids, raw refs, and a reminder that raw source must be opened explicitly.

4. Promote durable memory through the normal review path instead of writing trusted files directly.

Protected paths such as `/preferences.md` and `/projects/*/decisions.md` fail by default from the mount. The error tells the agent to rerun with `--allow-protected-write` or write to `/runs/` and promote later.

## Trust Behavior

Trust is path-based in current VeriFS core:

- `/scratch/` produces ephemeral memory nodes.
- `/runs/` produces agent-generated memory nodes.
- Durable memory paths produce source-backed nodes.
- Reviewed/trusted memory should come from promotions and reviews.

`--trust-level <level>` is recorded in mount status and audit metadata, but it does not override core's path policy.

## Audit Trail

Mounted workflows emit mount-specific audit events where the configured API/core supports audit:

- `mount.started`
- `mount.stopped`
- `mount.file.read`
- `mount.file.write`
- `mount.file.delete`
- `mount.protected_write.denied`
- `mount.recall.query`
- `mount.search.query`
- `mount.brief.query`

The underlying VeriFS operation also emits its standard audit event, so a mounted write can show both `file_write` and `mount.file.write`.
