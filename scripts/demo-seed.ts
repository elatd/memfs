import { MemoryFS } from "@memoryfs/core";
import { resolve } from "node:path";

const configuredDataDir = process.env.MEMFS_DATA_DIR ?? process.env.MEMORYFS_DATA_DIR;
const dataDir = configuredDataDir
  ? resolve(process.cwd(), configuredDataDir)
  : resolve(process.cwd(), "data");

const memoryfs = new MemoryFS({
  dataDir,
  memory: {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    chatModel: process.env.MEMORYFS_CHAT_MODEL ?? "gpt-4o-mini",
    embedModel: process.env.MEMORYFS_EMBED_MODEL ?? "text-embedding-3-small",
    useLlm: process.env.MEMORYFS_DEMO_USE_LLM === "true"
  }
});

await memoryfs.initialize();

const workspace = memoryfs.createWorkspace("demo");

const files = [
  {
    path: "/profile.md",
    protected: true,
    content: `# Profile

The demo user is a product-minded builder who values concise implementation notes and source-backed memory. They are comfortable with local-first developer tools and want agents to explain risky changes before applying them.
`
  },
  {
    path: "/preferences.md",
    protected: true,
    content: `# Preferences

- The user prefers Netlify for quick web deployments and Supabase for lightweight product backends.
- The user prefers clean, direct UI copy over long explanatory prose.
- The user wants protected memory writes to be explicit and auditable.
`
  },
  {
    path: "/projects/pipsqueak/decisions.md",
    protected: true,
    content: `# Pipsqueak Decisions

- Decision: Pipsqueak onboarding should stay short and ask for only one setup choice before showing the first useful result.
- Decision: The first-run flow must preserve a visible "skip for now" path because forced setup reduced activation in earlier prototypes.
- Constraint: Do not add new onboarding screens without checking whether they delay the first successful task.
`
  },
  {
    path: "/runs/2026-04-30-001/result.md",
    protected: false,
    content: `# Run Result

Task result: The onboarding audit found that users reached the first useful Pipsqueak result faster when the setup form was collapsed by default.

Open question: Decide whether the collapsed form should remember the last selected project type.
`
  }
];

for (const file of files) {
  await memoryfs.writeFile(workspace.id, file.path, file.content, {
    actor: "agent:demo-seed",
    ingest: true,
    allow_protected_write: file.protected
  });
}

const recall = await memoryfs.recallMemory(workspace.id, "What should I remember before changing Pipsqueak onboarding?", {
  limit: 5,
  include_detail: true,
  include_raw: false,
  project_hint: "pipsqueak"
});

console.log(JSON.stringify({ workspace, recall }, null, 2));

memoryfs.close();
