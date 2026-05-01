# Clean-Room Note

MemFS is implemented from the product requirements in this repository only.

The implementation uses ordinary TypeScript, Fastify, SQLite, local disk storage, React, and MCP SDK APIs.

High-level ideas used:

- Files are the human and agent memory interface.
- Structured memory nodes are retrieval indexes.
- Progressive recall returns summaries first, details on request, and raw source only when explicitly requested or confidence is low.

Raw files remain canonical. Derived nodes are never treated as truth.
