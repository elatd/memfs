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
await shell.exec('sgrep "onboarding decision"');
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
- `sgrep`
- `recall`
- `node list`
- `node read <node_id>`
- `raw <node_id>`
- `status`

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
