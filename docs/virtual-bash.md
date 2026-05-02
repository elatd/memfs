# Virtual Bash

`@memoryfs/virtual-bash` is a small deterministic command interpreter for agents. It does not execute host shell commands.

```ts
import { createMemoryFsShell } from "@memoryfs/virtual-bash";

const shell = createMemoryFsShell({
  memoryfs,
  workspaceId,
  actor: "agent:demo"
});

await shell.exec("ls /projects");
await shell.exec("cat /projects/pipsqueak/decisions.md");
await shell.exec('write /runs/demo/result.md "We decided to simplify onboarding."');
await shell.exec('grep "simplify onboarding"');
await shell.exec('search "onboarding decision"');
await shell.exec('recall "What should I remember before changing onboarding?"');
```

Supported commands:

- `ls`
- `cat`
- `write`
- `append`
- `rm`
- `mkdir`
- `grep`
- `search`
- `recall`
- `node list`
- `node read <node_id>`
- `raw <node_id>`
- `status`

Retrieval rule of thumb:

```text
Know the words?   use grep
Know the idea?    use search
Starting a task?  use recall or brief
Need proof?       use cat, node read, or raw
```

`grep` is exact text search by default. `search` runs meaning-oriented hybrid search and accepts `--semantic`, `--hybrid`, scope flags, and `--include-stale` for stale/superseded audit searches. `sgrep` remains available as a deprecated compatibility alias for `search --semantic`.

Each call returns:

```ts
{
  ok: true,
  command: "recall",
  data: {},
  displayText: "..."
}
```

Safety rules:

- Unsupported commands are rejected.
- Shell syntax such as pipes, redirects, command substitution, `;`, `&&`, and `||` is rejected.
- Paths are normalized by MemFS and `../` traversal is rejected.
- Raw source content is returned only by the explicit `raw` command.
