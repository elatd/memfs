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

Normal recall excludes `pending` and `rejected` nodes. Rejected memory is retrievable only with `include_rejected=true`; trust fields are shown only with `include_trust=true`.

Superseded memories remain queryable for audit and history, but their recall score is reduced. They are marked through graph links and trust metadata, not deleted.
