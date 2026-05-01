# Trust Layer

MemFS separates easy agent writing from durable memory.

Memory zones:

- `/scratch/`: agent writable, ephemeral trust, 30 day TTL on derived nodes.
- `/runs/`: agent writable, agent generated trust.
- `/projects/`: durable project memory, with protected decisions and constraints.
- `/memory/`: durable general memory.
- `/profile.md` and `/preferences.md`: protected durable memory.

Trust levels:

- `ephemeral`
- `agent_generated`
- `source_backed`
- `reviewed`
- `trusted`
- `superseded`
- `rejected`

Normal recall excludes `pending`, candidate-like, `rejected`, `stale`, `conflicted`, and `superseded` nodes. Rejected memory is retrievable only with `include_rejected=true`; stale, conflicted, and superseded memory is retrievable for audit with `include_stale=true` or `memfs grep --include-stale`. Trust and lifecycle fields are shown in recall packets with `include_trust=true`.

Superseded memories remain stored for audit and history, but they are not treated as current truth by default. They are marked through graph links, trust metadata, `valid_until`, and lifecycle status, not deleted.

Temporal fields:

- `valid_from`
- `valid_until`
- `last_confirmed_at`
- `last_used_at`
- `supersedes`
- `superseded_by`
- `stale_reason`

Review actions update these fields and write audit events:

- `memfs memory mark-stale <id> --reason "..."`
- `memfs memory confirm <id>`
- `memfs memory supersede <old_id> <new_id>`
