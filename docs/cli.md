# MemFS CLI

The CLI command is `memfs`. It talks to the local API at `http://localhost:3131` by default.

Override the API:

```bash
MEMFS_API_URL=http://localhost:3131 memfs status
```

The selected workspace is stored in `~/.memfs/config.json`. Tests and automation may set `MEMFS_CONFIG_DIR` to use a different config directory.

## Commands

```bash
memfs init
memfs status
memfs workspace create demo
memfs workspace list
memfs use demo
memfs ls /
memfs cat /scratch/note.md
memfs write /scratch/note.md "Decision: Keep onboarding short."
memfs append /scratch/note.md "Task: Recheck onboarding copy."
memfs rm /scratch/note.md
memfs upload ./status.csv --to /uploads/status.csv
memfs extract /uploads/status.csv
memfs extracted /uploads/status.csv
memfs grep "onboarding"
memfs sgrep "onboarding decision"
memfs recall "What should I remember before changing onboarding?"
memfs node list
memfs nodes --source /uploads/status.csv
memfs node read <node_id>
memfs raw <node_id>
memfs audit list
memfs promote /scratch/idea.md --to /preferences.md
memfs promotions
memfs approve <promotion_id>
memfs reject <promotion_id>
memfs snapshot create before-review
memfs snapshot list
memfs snapshot diff <snapshot_id>
memfs rollback <snapshot_id> --dry-run
memfs health
memfs brief "Edit onboarding"
memfs run create "Edit onboarding"
memfs run complete <run_id>
memfs run compile <run_id>
memfs runs
memfs run show <run_id>
memfs handoff --project pipsqueak
memfs stale
memfs sync status
memfs sync pull
memfs sync push
memfs sync conflicts
memfs sync resolve <conflict_id> --mode keep_both
memfs team members
memfs team invite agent:demo --role agent
memfs team role set agent:demo viewer
```

Global flags:

- `--json`: machine-readable output.
- `--no-ingest`: write without memory ingestion.
- `--allow-protected`: allow writes or deletes on protected paths.
- `--dry-run`: preview rollback changes without restoring state.

If no workspace is selected, commands that need one print:

```text
No workspace selected. Run: memfs workspace list && memfs use <workspace>
```

`memfs raw` is the explicit raw source command. Grep, semantic grep, and recall do not fetch raw source content by default.

`memfs upload` reads a local file, stores the raw bytes as the canonical blob, and can ingest memory unless `--no-ingest` is set. `memfs extract` stores derived text and source metadata without reading raw source into recall responses. `memfs extracted` prints the extracted text plus source-location hints.

Promotion commands create reviewable durable memory. `memfs approve` applies the promotion after approval; `memfs reject` keeps the source file and audit trail but prevents the candidate from normal recall.

Snapshot rollback is explicit. Use `memfs rollback <snapshot_id> --dry-run` first to inspect added, changed, and removed items.

Run commands create and manage `/runs/<run_id>/` folders. `memfs brief "<task>"` generates a task brief; `memfs run compile <run_id>` turns completed run artifacts into candidate memories and suggested promotions.

Sync commands show local sync status, push local events, pull remote events from the configured sync store, list conflicts, and resolve conflicts. Protected path conflicts are not auto-applied.

Team commands list and manage workspace members. In local mode these are useful for setup and inspection; in team/cloud mode actor auth and role checks decide who can manage members.
