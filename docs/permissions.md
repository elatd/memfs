# Permissions

Roles:

- `owner`
- `admin`
- `editor`
- `agent`
- `viewer`

Actions:

- `workspace.read`
- `file.read`
- `file.write`
- `file.delete`
- `memory.recall`
- `memory.raw.read`
- `memory.promote`
- `memory.review`
- `snapshot.create`
- `snapshot.rollback`
- `audit.read`
- `sync.pull`
- `sync.push`

Rules in the MVP:

- `viewer` can read non-protected files and recall memory, but cannot read raw protected source.
- `agent` can write `/scratch/` and `/runs/`, and can propose promotions.
- `editor` can write non-protected files.
- `admin` can manage protected path writes.
- `owner` can roll back snapshots and manage members.
- Raw reads are separately restricted through `memory.raw.read`.

Protected paths still require `allow_protected_write=true`; roles do not silently override that safety check.
