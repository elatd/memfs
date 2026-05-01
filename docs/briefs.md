# Briefs

Briefs are the pre-task memory step.

`POST /workspaces/:id/brief` recalls relevant decisions, constraints, preferences, previous errors, open questions, suggested files, and warnings. Raw source is not included unless requested.

When `create_run=true`, MemFS creates a run folder and writes the brief to `/runs/<run_id>/brief.md`.

CLI:

```bash
memfs brief "Edit Pipsqueak onboarding"
```
