# Verbatim Archive

MemFS archives preserve raw source material before any model decides what is durable memory.

Archive entries live under `/archive/` inside each workspace:

- `/archive/conversations/`
- `/archive/agent-runs/`
- `/archive/imported/`
- `/archive/raw/`

The raw archive file is canonical. Memory nodes derived from an archive entry are retrieval candidates that point back to the archive source reference. They are not trusted or promoted automatically.

## CLI

```bash
memfs archive add ./conversation.txt --type conversation --title "Claude coding session"
memfs archive list
memfs archive show <archive_id>
memfs archive extract <archive_id>
memfs archive search "OAuth refresh tokens"
```

`archive add` stores the file text verbatim and records an audit event. It does not ingest the archive as approved durable memory.

`archive extract` derives candidate memory nodes from the raw transcript. Candidates keep `raw_ref` values pointing at the archive file and default to pending, agent-generated memory until a later review or promotion flow approves them.

## Core API

```ts
await memoryfs.archive.writeConversation(workspace.id, {
  title: "Claude coding session",
  content: transcript
});

const entries = memoryfs.archive.list(workspace.id);
const raw = await memoryfs.archive.read(workspace.id, entries[0].id);
const candidates = await memoryfs.archive.extractToMemoryCandidates(workspace.id, entries[0].id);
```

Available archive APIs:

- `archive.writeConversation`
- `archive.writeTranscript`
- `archive.importText`
- `archive.list`
- `archive.read`
- `archive.extractToMemoryCandidates`

## Safety

Archive writes run a basic rule-based secret check before storing text. Obvious private keys, common API keys, access tokens, refresh tokens, and password assignments are blocked and audited as `archive_secret_blocked`.

This check is intentionally conservative and local. It is not a full data-loss-prevention system.
