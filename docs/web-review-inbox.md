# Web Review Inbox

The web dashboard includes a **Review** tab for memory candidates. It is intended for human review of memories proposed by agents, run compilation, and archive extraction.

Manual smoke test:

1. Start the API and web app:

```bash
pnpm --filter @memoryfs/api dev
pnpm --filter @memoryfs/web dev
```

2. Open the web dashboard, choose or create a workspace, and create a candidate through the API or CLI:

```bash
pnpm exec memfs candidates
```

3. In the dashboard, open **Memory > Review**.

4. Confirm that candidate cards show memory text, type, scope, source refs, confidence, risk flags, status, target path, creator, creation time, and reason.

5. Use the filters for status, scope, risk flag, and project/source text.

6. Edit a candidate. Update memory text, type, scope, tags, reason, and target path. Save the edit and confirm the card updates.

7. Approve a candidate with a protected target such as `/preferences.md` or `/projects/demo/decisions.md`. The dashboard calls the candidate approval API, so protected paths still go through existing review and promotion rules.

8. Reject another candidate and confirm it remains visible with rejected status and audit events.

9. Mark a candidate stale, then mark a candidate conflicted. Confirm the candidate lifecycle status changes and audit events are created.

API coverage for this workflow lives in `apps/api/src/server.test.ts` under “supports dashboard candidate review actions.”
