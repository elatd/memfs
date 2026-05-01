import { MemFSClient } from "@memoryfs/sdk";

const memfs = new MemFSClient({ apiUrl: "http://localhost:3131" });

const run = await memfs.runs.start({
  workspace: "doozy",
  task: "Fix OAuth refresh tokens"
});

await memfs.runs.append(run.id, {
  kind: "result",
  text: "Refresh token rotation fixed."
});

await memfs.runs.finish(run.id);
await memfs.runs.compile(run.id, { reasoning: true });
