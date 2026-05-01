# How MemFS Compares

This page is a positioning guide, not a benchmark or full feature audit of other projects.

MemFS focuses on one specific shape of agent memory: a local-first, source-backed, reviewable memory filesystem. Humans and agents work with ordinary files. MemFS derives memory nodes for semantic recall, but raw files remain canonical. Durable memory can be proposed, reviewed, promoted, audited, superseded, snapshotted, and rolled back.

## Comparison Matrix

| System or pattern | Primary mental model | Source of truth | Recall and update style | Trust and review posture | Agent access | MemFS distinction |
| --- | --- | --- | --- | --- | --- | --- |
| MemFS | Local-first memory filesystem for agents | Ordinary workspace files and content-addressed blobs | Derived memory nodes, search, recall, briefs, run history, handoffs | Reviewable promotions, audit events, trust levels, snapshots, rollback | CLI, API, MCP, virtual shell, optional mount | MemFS treats memory as inspectable files first and retrieval indexes second. |
| Mem0 | Managed memory layer/API for AI applications | Memories managed through a service/API | Persistent contextual memory for users, agents, and sessions | MemFS does not assume service-managed memory is the canonical layer; it keeps source files inspectable by default | API/SDK-oriented pattern | MemFS focuses on filesystem UX, local default storage, source references, and reviewable durable writes. |
| SMFS or mounted cloud memory systems | Cloud-backed memory exposed through a mounted directory | Mounted memory container or remote service | Filesystem commands can become memory/search operations | MemFS uses mounts as an optional view over local/core APIs, not as the only memory substrate | Shell/filesystem UX | MemFS focuses on local-first state, protected write paths, audit events, and rollback around the mounted workflow. |
| MemPalace-style verbatim archives | Conversation archive with verbatim retrieval | Original conversations or archived records | Search returns exact remembered text | MemFS can preserve raw source, but durable agent memory still flows through derived nodes and review | Search/tool-oriented archive UX | MemFS separates archive/source preservation from trusted memory promotion. |
| Hindsight-style learning memory | Structured memory for retaining, recalling, and reflecting over agent history | Structured memory networks over facts, experiences, entities, and beliefs | Reflection updates memory over time | MemFS emphasizes source-backed review and audit before durable memory becomes trusted | Research/architecture pattern | MemFS is currently a filesystem and curation layer rather than a full reflective learning architecture. |
| ReasoningBank-style reasoning memories | Reusable reasoning strategies distilled from successes and failures | Generalized strategies derived from agent experience | Retrieval of reasoning memories to guide later tasks | MemFS records runs and can compile candidates, but keeps durable promotion reviewable | Agent-learning pattern | MemFS focuses on run artifacts, candidate memories, handoffs, and promotion rather than autonomous self-evolution. |
| Engramme-style proactive associative memory | Associative memory that surfaces relevant context proactively | Memory graph, associations, or salience-weighted memory | Context is recalled or surfaced based on associations and task state | MemFS has memory links and graph-aware recall, with review and rollback around durable state | MCP/API/proactive-context pattern | MemFS focuses on explainable, source-backed associations and keeps raw evidence reachable through file/source refs. |

## What MemFS Is Optimized For

- Local-first workspaces by default, with optional team/cloud foundations.
- Raw files and blobs as canonical source material.
- Derived memory nodes as retrieval indexes, not truth.
- Source paths, raw refs, and source locations in recall results.
- Reviewable promotions from scratch/run memory into durable memory.
- Agent run folders, memory-used logs, compile-run candidates, and handoffs.
- Audit events for writes, ingestion, promotions, reviews, sync, mounts, snapshots, and rollback.
- Snapshots and rollback for memory state.
- CLI, MCP, API, virtual shell, dashboard, and optional mounted access.

## What MemFS Deliberately Separates

- Search is not the same as truth. Recall results point back to sources.
- Raw archives are not the same as trusted memory. Raw content can be preserved without automatically becoming durable guidance.
- Agent-generated memory is not the same as reviewed memory. Runs and scratch files can produce candidates, but durable paths should be reviewed and promoted.
- A mounted folder is not the whole product. The mount is one access layer over the same protected core/API behavior.
- Cloud/team mode is optional. Local SQLite and local disk remain the default development path.

## Reference Points

These links are useful context for the comparison categories:

- [Mem0 overview](https://docs.mem0.ai/overview)
- [SMFS](https://smfs.ai/)
- [MemPalace documentation](https://mempalace.github.io/mempalace/)
- [Hindsight paper](https://arxiv.org/abs/2512.12818)
- [ReasoningBank paper](https://arxiv.org/abs/2509.25140)
- [Engram public docs](https://www.engram.fyi/)
