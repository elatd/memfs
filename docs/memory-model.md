# Memory Model

## Workspace

A top-level memory container such as `user_123`, `project_pipsqueak`, or `company_acme`.

## File

A human-readable artifact such as `/profile.md`, `/preferences.md`, or `/projects/pipsqueak/decisions.md`.

## Blob

Content-addressed raw content stored by SHA-256. Blobs preserve the source bytes used by files and memory nodes.

## Extracted Source

Extracted source is derived text produced by a file extractor. It is stored in `extracted_sources` with extractor name, version, metadata, and section source locations. It is useful for search and memory extraction, but it is not canonical truth.

## MemoryNode

A retrieval object derived from a file or event:

- `summary`: one sentence about the memory.
- `trigger`: begins with `Recall when`.
- `detail`: richer context, loaded only when needed.
- `raw_ref`: pointer back to the source.
- `raw_excerpt`: short exact excerpt.
- `source_location_json`: optional location inside the source, such as a Markdown heading, CSV row range, code line range, or terminal log line range.
- `tags`: lowercase retrieval hints.
- `memory_type`: preference, decision, constraint, fact, task, error, research finding, unresolved question, run summary, reasoning memory, or other.
- `importance`: 1 to 5.
- `confidence`: 0 to 1.
- `trust_level`: ephemeral, agent generated, source backed, reviewed, trusted, superseded, or rejected.
- `status`: active/approved durable memory, reviewable candidates, or lifecycle states such as observed, rejected, superseded, stale, and conflicted.
- `ttl_expires_at`: optional expiry for low-trust scratch memory.
- temporal fields: `valid_from`, `valid_until`, `last_confirmed_at`, `last_used_at`, `stale_reason`, `supersedes`, and `superseded_by`.
- `scope`: global, workspace, project, repo, session, agent, contact, or run.
- optional scope identifiers: `project_slug`, `repo_path`, `session_id`, `agent_id`, `contact_id`, and `run_id`.

Trust defaults come from source paths:

- `/scratch/`: ephemeral.
- `/runs/`: agent generated.
- normal memory paths: source backed.
- reviewed promotions: reviewed or trusted.
- superseded and rejected memories remain stored for auditability.

Scope defaults also come from source paths:

- `/profile.md`, `/preferences.md`, `/archive/...`, and ordinary memory files: `workspace`.
- `/projects/<slug>/...`: `project` with `project_slug=<slug>`.
- `/runs/<id>/...`: `run` with `run_id=<id>`.
- `/repos/<path>/...`: `repo` with `repo_path=<path>`.
- `/sessions/<id>/...`, `/agents/<id>/...`, and `/contacts/<id>/...`: session, agent, and contact scopes.

Recall, memory grep, node listing, and MCP tools can filter by scope and identifiers without changing existing unscoped behavior.

## Progressive Recall

- Tier 1: summary, trigger, tags, importance, source path.
- Tier 2: detail and related nodes.
- Tier 3: raw excerpt and raw source content.

Memory nodes are indexes. Raw files are canonical truth.

## Memory Links

Memory links connect derived memory nodes without promoting them to truth. Allowed relation types:

- `related_to`
- `supports`
- `contradicts`
- `supersedes`
- `duplicates`
- `caused_by`
- `derived_from`
- `belongs_to_project`
- `used_in_run`
- `promoted_from`

Each link stores `confidence`, `reason`, and `created_at`. Contradictions and supersessions are inspectable graph facts, not automatic resolutions.

## Recall Packets

Recall returns typed memory packets:

- `type`: currently `memory_node`.
- `summary`, `trigger`, `detail` when requested.
- `source_path` and `raw_ref` always.
- `source_location`, `source_kind`, and `extractor_name` when available.
- `why` when `include_why=true`.
- `links` when `include_links=true`.
- `warnings` for contradictions, duplicates, or supersessions.

Raw source content is included only when `include_raw=true`.

Normal recall excludes rejected, pending/candidate-like, stale, conflicted, and superseded nodes. Rejected nodes require `include_rejected=true`; stale/superseded audit queries require `include_stale=true`; trust and temporal fields require `include_trust=true`.

## Agent Runs

Runs are ordinary MemFS files plus database metadata. Each run gets:

- `prompt.md`
- `brief.md`
- `plan.md`
- `actions.md`
- `files-read.md`
- `memory-used.md`
- `result.md`
- `errors.md`
- `followups.md`
- `candidates.md`

Run artifacts remain source files. Compiled candidate memory nodes point back to `/runs/<run_id>/candidates.md`.

## Sync And Conflicts

Sync events describe changes to files, blobs, memory nodes, links, protected paths, promotions, snapshots, audit events, runs, and handoffs. They are transport records, not canonical truth.

Conflict records preserve local and remote versions until an explicit resolution is chosen. File conflicts default to keep-both by writing the remote copy under `/conflicts/`; memory-node conflicts should prefer keeping both and linking them until reviewed.

## Team Roles

Team mode adds workspace members and roles around the same memory model. Roles restrict who can write files, read raw source, promote memory, review durable changes, create rollback snapshots, and push or pull sync events.

Protected memory rules still apply on top of roles.
