# Promotions

Promotions move candidate memory into durable paths through review.

Create a promotion:

```bash
verifs promote /scratch/idea.md --to /preferences.md
```

API:

```http
POST /workspaces/:id/memory/promote
```

Protected targets create a pending promotion. Approval applies the promotion by appending a source-backed block to the target path and ingesting it as trusted memory.

Rejection marks the candidate node rejected, keeps the source file, and writes audit events. Rejected candidates do not appear in normal recall.

MCP can propose promotions but does not expose approval or rejection tools by default.
