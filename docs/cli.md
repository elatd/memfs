# VeriFS CLI

The CLI command is `verifs`. It talks to the local API at `http://localhost:3131` by default.

Override the API:

```bash
VERIFS_API_URL=http://localhost:3131 verifs status
```

The selected workspace is stored in `~/.verifs/config.json`. Tests and automation may set `VERIFS_CONFIG_DIR` to use a different config directory.

## Commands

```bash
verifs init
verifs status
verifs workspace create demo
verifs workspace list
verifs use demo
verifs ls /
verifs cat /scratch/note.md
verifs write /scratch/note.md "Decision: Keep onboarding short."
verifs append /scratch/note.md "Task: Recheck onboarding copy."
verifs rm /scratch/note.md
verifs upload ./status.csv --to /uploads/status.csv
verifs extract /uploads/status.csv
verifs extracted /uploads/status.csv
verifs grep "OAuth refresh tokens"
verifs grep "OAuth refresh tokens" --scope project --project pipsqueak
verifs search "onboarding decision"
verifs search "backend plan" --include-stale
verifs search --semantic "hosting preference"
verifs recall "What should I remember before changing onboarding?"
verifs recall "deployment constraints" --scope workspace
verifs recall "OAuth token flow" --include-related
verifs node list
verifs node list --scope run
verifs nodes --source /uploads/status.csv
verifs node read <node_id>
verifs raw <node_id>
verifs audit list
verifs promote /scratch/idea.md --to /preferences.md
verifs promotions
verifs candidates
verifs candidate show <candidate_id>
verifs candidate edit <candidate_id> --summary "Reviewed summary"
verifs candidate approve <candidate_id>
verifs candidate reject <candidate_id>
verifs memory mark-stale <node_id> --reason "MVP backend changed"
verifs memory confirm <node_id>
verifs memory supersede <old_node_id> <new_node_id>
verifs graph node <node_id>
verifs graph related <node_id>
verifs graph link <from_node_id> supports <to_node_id>
verifs graph unlink <edge_id>
verifs graph path <from_node_id> <to_node_id>
verifs approve <promotion_id>
verifs reject <promotion_id>
verifs snapshot create before-review
verifs snapshot list
verifs snapshot diff <snapshot_id>
verifs rollback <snapshot_id> --dry-run
verifs health
verifs brief "Edit onboarding"
verifs run create "Edit onboarding"
verifs run complete <run_id>
verifs run compile <run_id> --reasoning
verifs run lessons <run_id>
verifs runs
verifs run show <run_id>
verifs archive add ./conversation.txt --type conversation --title "Claude coding session"
verifs archive list
verifs archive show <archive_id>
verifs archive extract <archive_id>
verifs archive search "OAuth refresh tokens"
verifs handoff --project pipsqueak
verifs stale
verifs sync status
verifs sync pull
verifs sync push
verifs sync conflicts
verifs sync resolve <conflict_id> --mode keep_both
verifs team members
verifs team invite agent:demo --role agent
verifs team role set agent:demo viewer
```

Global flags:

- `--json`: machine-readable output.
- `--no-ingest`: write without memory ingestion.
- `--allow-protected`: allow writes or deletes on protected paths.
- `--dry-run`: preview rollback changes without restoring state.

If no workspace is selected, commands that need one print:

```text
No workspace selected. Run: verifs workspace list && verifs use <workspace>
```

Retrieval rule of thumb:

```text
Know the words?   use grep
Know the idea?    use search
Starting a task?  use recall or brief
Need proof?       open source_path or raw_ref
```

`verifs grep` is exact text search by default. Use `verifs search` for meaning-oriented hybrid search, `verifs search --semantic` for semantic-only search, and `verifs recall` for curated task context.

`verifs raw` is the explicit raw source command. Grep, search, and recall do not fetch raw source content by default.

Scope filters are optional. Use `--scope project --project <slug>`, `--scope repo --repo <path>`, `--scope run --run <id>`, or the corresponding session, agent, and contact flags to narrow grep, search, and recall.

`verifs upload` reads a local file, stores the raw bytes as the canonical blob, and can ingest memory unless `--no-ingest` is set. `verifs extract` stores derived text and source metadata without reading raw source into recall responses. `verifs extracted` prints the extracted text plus source-location hints.

Promotion commands create reviewable durable memory. Candidate commands list, inspect, edit, approve, or reject the proposed memory node behind a promotion. Use `verifs candidates --duplicates` and `verifs candidates --conflicts` to focus review queues. Resolve conflicts with `verifs candidate resolve-conflict <id> --mode keep_new|keep_old|keep_both|mark_superseded`. `verifs candidate approve` and `verifs approve` both apply durable memory through the protected promotion path; rejection keeps the source file and audit trail but prevents the candidate from normal recall.

Temporal memory commands mark old assumptions stale, confirm current memories, or link old memories to replacements. Normal recall, grep, and search exclude stale, conflicted, and superseded memory unless `--include-stale` is provided.

Graph commands inspect and maintain associative memory links. `verifs graph node <node_id>` shows typed relationships for a memory node, `verifs graph related <node_id>` traverses nearby memories, and `verifs graph link` creates a source-backed typed edge such as `supports`, `contradicts`, `supersedes`, `derived_from`, `implemented_in`, `observed_in`, `applies_to`, or `blocked_by`.

Snapshot rollback is explicit. Use `verifs rollback <snapshot_id> --dry-run` first to inspect added, changed, and removed items.

Run commands create and manage `/runs/<run_id>/` folders. `verifs brief "<task>"` generates a task brief; `verifs run compile <run_id>` turns completed run artifacts into candidate memories and suggested promotions. Add `--reasoning` to extract reusable reasoning lessons as reviewable `reasoning_memory` candidates, then use `verifs run lessons <run_id>` to list them.

Archive commands preserve verbatim source material under `/archive/`. `verifs archive extract <archive_id>` creates reviewable candidate memories that point back to the raw archive source; it does not auto-promote imported instructions.

Sync commands show local sync status, push local events, pull remote events from the configured sync store, list conflicts, and resolve conflicts. Protected path conflicts are not auto-applied.

Team commands list and manage workspace members. In local mode these are useful for setup and inspection; in team/cloud mode actor auth and role checks decide who can manage members.
