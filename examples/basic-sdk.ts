import { MemFSClient } from "@memoryfs/sdk";

const memfs = new MemFSClient({ apiUrl: "http://localhost:3131" });

await memfs.remember({
  workspace: "doozy",
  text: "The user prefers Netlify Functions for backend MVPs.",
  scope: "workspace",
  source: "explicit_user_instruction"
});

const results = await memfs.recall({
  workspace: "doozy",
  query: "backend preference",
  limit: 5
});

console.log(results);
