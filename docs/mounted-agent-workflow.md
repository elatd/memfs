# Mounted Agent Workflow

MemFS mounts are designed for agents that prefer ordinary file operations while still preserving MemFS safety guarantees.

## Recommended Flow

1. Mount the workspace read-write only when the task needs file writes.

```bash
pnpm exec memfs mount demo ~/MemFS/demo --read-write --ingest-on-write --actor mount:agent
```

2. Put task artifacts under `/runs/`.

```bash
mkdir -p ~/MemFS/demo/runs/today
echo "Plan and actions go here." >> ~/MemFS/demo/runs/today/actions.md
echo "Final task result." >> ~/MemFS/demo/runs/today/result.md
```

3. Use semantic control files for lightweight context checks.

```bash
echo "What matters before changing onboarding?" > ~/MemFS/demo/.memfs/recall.query
cat ~/MemFS/demo/.memfs/recall.results.md

echo "onboarding decision" > ~/MemFS/demo/.memfs/search.query
cat ~/MemFS/demo/.memfs/search.results.md
```

Each mount keeps its own latest `recall.results.md` and `search.results.md`; separate mounts do not share query state.

4. Promote durable memory through the normal review path instead of writing trusted files directly.

Protected paths such as `/preferences.md` and `/projects/*/decisions.md` fail by default from the mount. The error tells the agent to rerun with `--allow-protected-write` or write to `/runs/` and promote later.

## Trust Behavior

Trust is path-based in current MemFS core:

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

The underlying MemFS operation also emits its standard audit event, so a mounted write can show both `file_write` and `mount.file.write`.
