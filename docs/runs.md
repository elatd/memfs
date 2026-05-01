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

Use `POST /workspaces/:id/runs` or `memfs run create "<task>"` to create a run. File reads, recalls, raw opens, and arbitrary events can be logged to the run.
