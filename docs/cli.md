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
memfs grep "OAuth refresh tokens" --scope project --project pipsqueak
memfs grep "backend plan" --include-stale
memfs sgrep "onboarding decision"
memfs recall "What should I remember before changing onboarding?"
memfs recall "deployment constraints" --scope workspace
memfs recall "OAuth token flow" --include-related
memfs node list
memfs node list --scope run
memfs nodes --source /uploads/status.csv
memfs node read <node_id>
memfs raw <node_id>
memfs audit list
memfs promote /scratch/idea.md --to /preferences.md
memfs promotions
memfs candidates
memfs candidate show <candidate_id>
memfs candidate edit <candidate_id> --summary "Reviewed summary"
memfs candidate approve <candidate_id>
memfs candidate reject <candidate_id>
memfs memory mark-stale <node_id> --reason "MVP backend changed"
memfs memory confirm <node_id>
memfs memory supersede <old_node_id> <new_node_id>
memfs graph node <node_id>
memfs graph related <node_id>
memfs graph link <from_node_id> supports <to_node_id>
memfs graph unlink <edge_id>
memfs graph path <from_node_id> <to_node_id>
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
memfs run compile <run_id> --reasoning
memfs run lessons <run_id>
memfs runs
memfs run show <run_id>
memfs archive add ./conversation.txt --type conversation --title "Claude coding session"
memfs archive list
memfs archive show <archive_id>
memfs archive extract <archive_id>
memfs archive search "OAuth refresh tokens"
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

Scope filters are optional. Use `--scope project --project <slug>`, `--scope repo --repo <path>`, `--scope run --run <id>`, or the corresponding session, agent, and contact flags to narrow recall and memory grep.

`memfs upload` reads a local file, stores the raw bytes as the canonical blob, and can ingest memory unless `--no-ingest` is set. `memfs extract` stores derived text and source metadata without reading raw source into recall responses. `memfs extracted` prints the extracted text plus source-location hints.

Promotion commands create reviewable durable memory. Candidate commands list, inspect, edit, approve, or reject the proposed memory node behind a promotion. Use `memfs candidates --duplicates` and `memfs candidates --conflicts` to focus review queues. Resolve conflicts with `memfs candidate resolve-conflict <id> --mode keep_new|keep_old|keep_both|mark_superseded`. `memfs candidate approve` and `memfs approve` both apply durable memory through the protected promotion path; rejection keeps the source file and audit trail but prevents the candidate from normal recall.

Temporal memory commands mark old assumptions stale, confirm current memories, or link old memories to replacements. Normal recall and grep exclude stale, conflicted, and superseded memory unless `--include-stale` is provided.

Graph commands inspect and maintain associative memory links. `memfs graph node <node_id>` shows typed relationships for a memory node, `memfs graph related <node_id>` traverses nearby memories, and `memfs graph link` creates a source-backed typed edge such as `supports`, `contradicts`, `supersedes`, `derived_from`, `implemented_in`, `observed_in`, `applies_to`, or `blocked_by`.

Snapshot rollback is explicit. Use `memfs rollback <snapshot_id> --dry-run` first to inspect added, changed, and removed items.

Run commands create and manage `/runs/<run_id>/` folders. `memfs brief "<task>"` generates a task brief; `memfs run compile <run_id>` turns completed run artifacts into candidate memories and suggested promotions. Add `--reasoning` to extract reusable reasoning lessons as reviewable `reasoning_memory` candidates, then use `memfs run lessons <run_id>` to list them.

Archive commands preserve verbatim source material under `/archive/`. `memfs archive extract <archive_id>` creates reviewable candidate memories that point back to the raw archive source; it does not auto-promote imported instructions.

Sync commands show local sync status, push local events, pull remote events from the configured sync store, list conflicts, and resolve conflicts. Protected path conflicts are not auto-applied.

Team commands list and manage workspace members. In local mode these are useful for setup and inspection; in team/cloud mode actor auth and role checks decide who can manage members.
