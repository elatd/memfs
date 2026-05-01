# Candidate Deduplication and Conflicts

MemFS checks memory candidates before they become durable memory. The goal is to let agents propose freely while preventing repeated or contradictory memories from entering trusted recall without review.

## Duplicate Detection

A candidate can be marked `duplicate` when it matches an existing memory candidate or durable memory.

Signals include:

- exact normalized memory text
- same source reference, memory type, scope, and source excerpt
- same type, scope, promotion target path, and normalized text
- same title and trigger for reasoning memories
- high semantic similarity when embeddings are available

Duplicate candidates are kept for audit, but they are not treated as normal candidate approvals. Approval is blocked until the candidate is edited into a distinct memory or rejected.

Fields:

- `status: "duplicate"`
- `duplicate_of`

Audit events:

- `candidate.duplicate_detected`
- `candidate.approval_blocked_duplicate`

## Conflict Detection

A candidate can be marked `conflicted` when it appears to contradict or replace existing approved memory.

Signals include:

- same scope and type with contradictory wording
- a newer decision contradicting an older decision
- a candidate that would overwrite approved memory
- a candidate stating that a previous constraint or decision no longer applies

Conflicting candidates are reviewable, searchable in conflict views, and excluded from normal recall. Approval is blocked until a human or authorized reviewer resolves the conflict.

Fields:

- `status: "conflicted"`
- `conflicts_with[]`
- `conflict_reason`

Audit events:

- `candidate.conflict_detected`
- `candidate.approval_blocked_conflict`
- `candidate.conflict_resolved`

## CLI

List duplicates:

```bash
memfs candidates --duplicates
```

List conflicts:

```bash
memfs candidates --conflicts
```

Resolve a conflict:

```bash
memfs candidate resolve-conflict <id> --mode keep_new
memfs candidate resolve-conflict <id> --mode keep_old
memfs candidate resolve-conflict <id> --mode keep_both
memfs candidate resolve-conflict <id> --mode mark_superseded
```

Resolution modes:

- `keep_new`: clear the conflict and continue reviewing the new candidate.
- `keep_old`: reject the candidate and keep existing memory unchanged.
- `keep_both`: clear the conflict so both memories can coexist with source references.
- `mark_superseded`: mark conflicting older memories superseded, then continue reviewing the new candidate.

## Review Rule

MemFS does not silently approve duplicates or conflicts. Durable memory still flows through promotion, review, audit events, source references, snapshots, and rollback.
