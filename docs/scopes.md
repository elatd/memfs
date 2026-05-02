# Memory Scopes

VeriFS memory nodes carry an explicit `scope` so recall can distinguish broad workspace memory from project, run, repo, session, agent, or contact-specific context.

Supported scopes:

- `global`
- `workspace`
- `project`
- `repo`
- `session`
- `agent`
- `contact`
- `run`

Most callers do not need to set a scope. VeriFS infers one from source paths:

- `/profile.md`, `/preferences.md`, `/archive/...`, and ordinary memory files -> `workspace`
- `/projects/<slug>/...` -> `project`, with `project_slug`
- `/runs/<id>/...` -> `run`, with `run_id`
- `/repos/<path>/...` -> `repo`, with `repo_path`
- `/sessions/<id>/...` -> `session`, with `session_id`
- `/agents/<id>/...` -> `agent`, with `agent_id`
- `/contacts/<id>/...` -> `contact`, with `contact_id`

Examples:

```bash
verifs grep "OAuth refresh tokens" --scope project --project pipsqueak
verifs recall "deployment constraints" --scope workspace
verifs node list --scope run
```

MCP tools accept the same optional filters on grep, search, and recall: `scope`, `project_slug`, `repo_path`, `session_id`, `agent_id`, `contact_id`, and `run_id`.
