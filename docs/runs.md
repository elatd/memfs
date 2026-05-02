# Runs

Agent runs make task memory explicit.

Every run creates:

- `/runs/<run_id>/prompt.md`
- `/runs/<run_id>/brief.md`
- `/runs/<run_id>/plan.md`
- `/runs/<run_id>/actions.md`
- `/runs/<run_id>/files-read.md`
- `/runs/<run_id>/memory-used.md`
- `/runs/<run_id>/result.md`
- `/runs/<run_id>/errors.md`
- `/runs/<run_id>/followups.md`
- `/runs/<run_id>/candidates.md`
- `/runs/<run_id>/reasoning-memories.json`

Use `POST /workspaces/:id/runs` or `verifs run create "<task>"` to create a run. File reads, recalls, raw opens, and arbitrary events can be logged to the run.

Use `verifs run compile <run_id> --reasoning` to extract reusable, reviewable lessons from run artifacts. Use `verifs run lessons <run_id>` to inspect those reasoning memory candidates.
