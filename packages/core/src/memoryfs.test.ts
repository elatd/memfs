import { validateExtractedNodesJson } from "@memoryfs/memory";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryFS, type SyncEvent } from "./index.js";

let tempDir: string;
let memoryfs: MemoryFS;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "memoryfs-test-"));
  memoryfs = new MemoryFS({
    dataDir: tempDir,
    memory: {
      useLlm: false
    }
  });
  await memoryfs.initialize();
});

afterEach(async () => {
  memoryfs.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("MemoryFS core", () => {
  it("writes and reads files", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(workspace.id, "/scratch/note.md", "Hello from MemoryFS", {
      actor: "test",
      ingest: false
    });

    const read = await memoryfs.readFile(workspace.id, "/scratch/note.md");
    expect(read.content).toBe("Hello from MemoryFS");
    expect(read.file.path).toBe("/scratch/note.md");
  });

  it("deduplicates blobs by sha256", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(workspace.id, "/scratch/a.md", "same content", { ingest: false });
    await memoryfs.writeFile(workspace.id, "/scratch/b.md", "same content", { ingest: false });

    const count = memoryfs.db.prepare("SELECT COUNT(*) AS count FROM blobs").get() as { count: number };
    expect(count.count).toBe(1);
  });

  it("denies protected writes without the allow flag", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await expect(
      memoryfs.writeFile(workspace.id, "/preferences.md", "User prefers quiet UI.", {
        actor: "agent:test",
        ingest: false
      })
    ).rejects.toThrow(/Protected path/);

    const auditEvents = memoryfs.listAuditEvents(workspace.id);
    expect(auditEvents.some((event) => event.event_type === "protected_write_denied")).toBe(true);
  });

  it("allows protected writes with the allow flag", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(workspace.id, "/preferences.md", "User prefers quiet UI.", {
      actor: "agent:test",
      ingest: false,
      allow_protected_write: true
    });

    const read = await memoryfs.readFile(workspace.id, "/preferences.md");
    expect(read.content).toContain("quiet UI");
  });

  it("validates memory extraction JSON strictly", () => {
    const valid = validateExtractedNodesJson(
      JSON.stringify([
        {
          summary: "Preference: The user prefers short answers.",
          trigger: "Recall when deciding response length.",
          detail: "The source says short answers are preferred. Keep future replies concise.",
          raw_excerpt: "The user prefers short answers.",
          tags: ["preference", "answers", "style"],
          memory_type: "preference",
          importance: 4,
          confidence: 0.9
        }
      ]),
      "The user prefers short answers."
    );

    expect(valid).toHaveLength(1);
    expect(() => validateExtractedNodesJson("[{\"summary\":\"bad\"}]")).toThrow();
  });

  it("recall returns source paths", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/projects/pipsqueak/decisions.md",
      "# Decisions\n\nDecision: Pipsqueak onboarding should stay short and show a first useful result quickly.",
      {
        actor: "agent:test",
        ingest: true,
        allow_protected_write: true
      }
    );

    const recall = await memoryfs.recallMemory(workspace.id, "changing Pipsqueak onboarding", {
      include_detail: true,
      project_hint: "pipsqueak"
    });

    expect(recall.results[0]?.source_path).toBe("/projects/pipsqueak/decisions.md");
  });

  it("trigger search finds relevant memory", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/scratch/hosting.md",
      "Preference: The user prefers Netlify for hosting quick web apps and Supabase for product backends.",
      {
        actor: "agent:test",
        ingest: true
      }
    );

    const recall = await memoryfs.recallMemory(workspace.id, "hosting preference", {
      include_detail: true
    });

    expect(recall.results[0]?.summary.toLowerCase()).toContain("netlify");
  });

  it("greps raw files literally when requested", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/scratch/auth.md",
      "Decision: OAuth refresh tokens are rotated server-side after every successful login.",
      {
        actor: "agent:test",
        ingest: false
      }
    );

    const grep = await memoryfs.grepMemory(workspace.id, "OAuth refresh tokens", {
      mode: "literal"
    });

    expect(grep.mode).toBe("literal");
    expect(grep.results[0]).toMatchObject({
      path: "/scratch/auth.md",
      line: 1,
      match_type: "literal",
      node_id: null
    });
    expect(grep.results[0]?.snippet).toContain("OAuth refresh tokens");
  });

  it("uses lexical fallback in hybrid grep when the phrase is not exact", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/scratch/rotation.md",
      "Decision: Refresh token rotation failed because the provider returned invalid_grant during renewal. Agents should check provider token settings before changing OAuth behavior.",
      {
        actor: "agent:test",
        ingest: true
      }
    );

    const grep = await memoryfs.grepMemory(workspace.id, "invalid_grant refresh token", {
      mode: "hybrid"
    });

    expect(grep.results.some((result) => result.path === "/scratch/rotation.md")).toBe(true);
    expect(grep.results.some((result) => ["lexical", "extracted", "memory"].includes(result.match_type))).toBe(true);
  });

  it("orders exact literal matches first in hybrid grep", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/memory/auth.md",
      "Decision: OAuth refresh tokens are stored server-side and rotated on login.",
      {
        actor: "agent:test",
        ingest: false
      }
    );
    await memoryfs.writeFile(
      workspace.id,
      "/scratch/auth-related.md",
      "Decision: OAuth access token renewal can be related to refresh token rotation and provider invalid_grant errors.",
      {
        actor: "agent:test",
        ingest: true
      }
    );

    const grep = await memoryfs.grepMemory(workspace.id, "OAuth refresh tokens");

    expect(grep.mode).toBe("hybrid");
    expect(grep.results[0]).toMatchObject({
      path: "/memory/auth.md",
      match_type: "literal"
    });
  });

  it("filters hybrid grep to reviewed and trusted memory when requested", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/memory/deploy.md",
      "Decision: Deployment constraints require the primary app region to stay in us-east for this project.",
      {
        actor: "agent:test",
        ingest: true
      }
    );
    const trustedNode = memoryfs.listMemoryNodes(workspace.id).find((node) => node.source_path === "/memory/deploy.md")!;
    memoryfs.db.prepare("UPDATE memory_nodes SET trust_level = 'trusted' WHERE id = ?").run(trustedNode.id);

    await memoryfs.writeFile(
      workspace.id,
      "/scratch/deploy.md",
      "Decision: Deployment constraints in scratch should not pass trusted-only grep.",
      {
        actor: "agent:test",
        ingest: true
      }
    );

    const grep = await memoryfs.grepMemory(workspace.id, "deployment constraints", {
      mode: "hybrid",
      trust_min: "reviewed"
    });

    expect(grep.results.length).toBeGreaterThan(0);
    expect(grep.results.every((result) => result.trust === "reviewed" || result.trust === "trusted")).toBe(true);
    expect(grep.results.some((result) => result.path === "/scratch/deploy.md")).toBe(false);
  });

  it("can include or exclude run artifacts in memory grep", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/runs/demo/result.md",
      "Decision: Supabase auth 401 came from stale OAuth refresh tokens during the login run.",
      {
        actor: "agent:test",
        ingest: true
      }
    );

    const withoutRuns = await memoryfs.grepMemory(workspace.id, "Supabase auth 401", {
      include_runs: false
    });
    const withRuns = await memoryfs.grepMemory(workspace.id, "Supabase auth 401", {
      include_runs: true
    });

    expect(withoutRuns.results.some((result) => result.path === "/runs/demo/result.md")).toBe(false);
    expect(withRuns.results.some((result) => result.path === "/runs/demo/result.md")).toBe(true);
  });

  it("infers explicit memory scopes from source paths", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/projects/pipsqueak/decisions.md",
      "Decision: Pipsqueak should keep OAuth refresh tokens server-side for scoped recall.",
      { actor: "agent:test", ingest: true, allow_protected_write: true }
    );
    await memoryfs.writeFile(
      workspace.id,
      "/runs/run-123/result.md",
      "Decision: Run scoped memory should stay attached to run-123 for follow-up recall.",
      { actor: "agent:test", ingest: true }
    );
    await memoryfs.writeFile(
      workspace.id,
      "/preferences.md",
      "Preference: Workspace scoped preferences should remain available by default.",
      { actor: "agent:test", ingest: true, allow_protected_write: true }
    );

    const nodes = memoryfs.listMemoryNodes(workspace.id);
    const project = nodes.find((node) => node.source_path === "/projects/pipsqueak/decisions.md")!;
    const run = nodes.find((node) => node.source_path === "/runs/run-123/result.md")!;
    const workspaceNode = nodes.find((node) => node.source_path === "/preferences.md")!;

    expect(project).toMatchObject({ scope: "project", project_slug: "pipsqueak" });
    expect(run).toMatchObject({ scope: "run", run_id: "run-123" });
    expect(workspaceNode).toMatchObject({ scope: "workspace" });
  });

  it("filters recall search and grep by explicit scope", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/projects/pipsqueak/decisions.md",
      "Decision: OAuth refresh tokens for Pipsqueak are stored server-side and rotated on login.",
      { actor: "agent:test", ingest: true, allow_protected_write: true }
    );
    await memoryfs.writeFile(
      workspace.id,
      "/projects/other/decisions.md",
      "Decision: OAuth refresh tokens for Other are handled by a separate service.",
      { actor: "agent:test", ingest: true, allow_protected_write: true }
    );
    await memoryfs.writeFile(
      workspace.id,
      "/preferences.md",
      "Preference: Workspace OAuth defaults should not appear in project scoped recall.",
      { actor: "agent:test", ingest: true, allow_protected_write: true }
    );

    const recall = await memoryfs.recallMemory(workspace.id, "OAuth refresh tokens", {
      scope: "project",
      project_slug: "pipsqueak"
    });
    const search = await memoryfs.searchMemory(workspace.id, "OAuth refresh tokens", {
      scope: "workspace"
    });
    const grep = await memoryfs.grepMemory(workspace.id, "OAuth refresh tokens", {
      scope: ["project"],
      project_slug: "pipsqueak"
    });

    expect(recall.results.every((result) => result.scope === "project" && result.project_slug === "pipsqueak")).toBe(true);
    expect(search.results.every((result) => result.scope === "workspace")).toBe(true);
    expect(grep.results.every((result) => result.scope === "project" && result.project_slug === "pipsqueak")).toBe(true);
    expect(grep.results.some((result) => result.path === "/projects/other/decisions.md")).toBe(false);
  });

  it("defaults old memory rows without scope to workspace", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const file = await memoryfs.writeFile(workspace.id, "/legacy.md", "Legacy scoped content.", {
      actor: "test",
      ingest: false
    });

    memoryfs.db
      .prepare(
        `INSERT INTO memory_nodes
         (id, workspace_id, source_file_id, source_blob_sha256, summary, trigger, detail, raw_excerpt, raw_ref, source_location_json, tags_json, memory_type, importance, confidence, trust_level, status, ttl_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "legacy-node",
        workspace.id,
        file.id,
        file.current_blob_sha256,
        "Fact: Legacy rows get workspace scope.",
        "Recall when testing legacy scope defaults.",
        "Legacy compatibility should not require scope columns in old inserts.",
        "Legacy scoped content.",
        `memoryfs://${workspace.id}${file.path}#${file.current_blob_sha256}`,
        null,
        JSON.stringify(["legacy", "scope", "memory"]),
        "fact",
        2,
        0.7,
        "source_backed",
        "active",
        null,
        new Date().toISOString(),
        new Date().toISOString()
      );

    expect(memoryfs.getMemoryNode(workspace.id, "legacy-node").scope).toBe("workspace");
  });

  it("adds lists and reads verbatim archive entries", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    const entry = await memoryfs.archive.writeConversation(workspace.id, {
      title: "Claude coding session",
      content: "Human: We need OAuth refresh tokens handled carefully.\nAssistant: Keep the raw transcript canonical.",
      actor: "human:test"
    });
    const entries = memoryfs.archive.list(workspace.id);
    const read = await memoryfs.archive.read(workspace.id, entry.id);

    expect(entry.path).toContain("/archive/conversations/");
    expect(entries[0]?.id).toBe(entry.id);
    expect(read.content).toContain("OAuth refresh tokens");
    expect(read.entry.raw_ref).toContain("memoryfs://");
    expect((await memoryfs.readFile(workspace.id, entry.path)).content).toBe(read.content);
  });

  it("extracts archive content into pending candidates with archive source refs", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    const entry = await memoryfs.archive.importText(workspace.id, {
      archive_type: "conversation",
      title: "Auth debugging session",
      content:
        "Decision: OAuth refresh tokens should be stored server-side and rotated during login. The archive transcript remains the canonical source, and derived memory must stay reviewable before promotion.",
      actor: "human:test"
    });
    const extracted = await memoryfs.archive.extractToMemoryCandidates(workspace.id, entry.id, {
      actor: "agent:test"
    });

    expect(extracted.candidate_nodes.length).toBeGreaterThan(0);
    expect(extracted.candidate_nodes[0]?.source_path).toBe(entry.path);
    expect(extracted.candidate_nodes[0]?.raw_ref).toBe(entry.raw_ref);
    expect(extracted.candidate_nodes[0]?.status).toBe("candidate");
    expect(extracted.candidate_nodes[0]?.trust_level).toBe("agent_generated");
    expect(JSON.parse(extracted.candidate_nodes[0]?.source_location_json ?? "{}")).toMatchObject({
      type: "archive",
      archive_id: entry.id
    });
  });

  it("searches archive entries as archive source results", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    const entry = await memoryfs.archive.importText(workspace.id, {
      archive_type: "raw",
      title: "Raw auth notes",
      content: "Raw note: OAuth refresh tokens were mentioned in the imported session.",
      actor: "human:test"
    });

    const search = await memoryfs.grepMemory(workspace.id, "OAuth refresh tokens", {
      scope: ["archive"]
    });

    expect(search.results[0]).toMatchObject({
      path: entry.path,
      match_type: "archive",
      trust: "source_backed"
    });
  });

  it("audits archive writes and blocks obvious secrets", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.archive.importText(workspace.id, {
      title: "Safe transcript",
      content: "Decision: Archive writes should be auditable and safe.",
      actor: "human:test"
    });

    await expect(
      memoryfs.archive.importText(workspace.id, {
        title: "Unsafe transcript",
        content: "password = abcdefghijklmnopqrstuvwxyz",
        actor: "human:test"
      })
    ).rejects.toThrow(/secret/i);

    const events = memoryfs.listAuditEvents(workspace.id);
    expect(events.some((event) => event.event_type === "archive_entry_written")).toBe(true);
    expect(events.some((event) => event.event_type === "archive_secret_blocked")).toBe(true);
  });

  it("does not return raw content unless include_raw is true", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/scratch/raw.md",
      "Decision: Raw source should only be loaded when explicitly requested by the caller.",
      {
        actor: "agent:test",
        ingest: true
      }
    );

    const tierOne = await memoryfs.recallMemory(workspace.id, "raw source", {
      include_detail: true,
      include_raw: false
    });
    expect(tierOne.results[0]?.raw_content).toBeUndefined();
    expect(tierOne.results[0]?.raw_excerpt).toBeNull();

    const tierThree = await memoryfs.recallMemory(workspace.id, "raw source", {
      include_detail: true,
      include_raw: true
    });
    expect(tierThree.results[0]?.raw_content).toContain("Raw source should only be loaded");
    expect(tierThree.results[0]?.raw_excerpt).toContain("Raw source should only be loaded");
  });

  it("creates audit events for writes and ingestion", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/scratch/audit.md",
      "Decision: Every write must emit an audit event for traceability.",
      {
        actor: "agent:test",
        ingest: true
      }
    );

    const auditEvents = memoryfs.listAuditEvents(workspace.id);
    expect(auditEvents.some((event) => event.event_type === "file_write")).toBe(true);
    expect(auditEvents.some((event) => event.event_type === "memory_ingest_file")).toBe(true);
    expect(auditEvents.some((event) => event.event_type === "memory_node_created")).toBe(true);
  });

  it("stores extracted sources and source locations during ingestion", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(
      workspace.id,
      "/scratch/source.md",
      "# Decisions\n\nDecision: Recall results should preserve exact source locations.",
      {
        actor: "agent:test",
        ingest: true
      }
    );

    const file = memoryfs.listFiles(workspace.id).find((entry) => entry.path === "/scratch/source.md")!;
    const sources = memoryfs.listExtractedSources(workspace.id, file.id);
    const node = memoryfs.listMemoryNodes(workspace.id).find((entry) => entry.source_path === "/scratch/source.md")!;
    const recall = await memoryfs.recallMemory(workspace.id, "exact source locations", {
      include_detail: true
    });
    const source = memoryfs.getMemoryNodeSource(workspace.id, node.id);

    expect(sources).toHaveLength(1);
    expect(JSON.parse(sources[0]!.metadata_json).sections[0].sourceLocation.type).toBe("markdown");
    expect(JSON.parse(node.source_location_json ?? "{}")).toMatchObject({ type: "markdown" });
    expect(recall.results[0]?.source_location).toMatchObject({ type: "markdown" });
    expect(source.extracted_sources[0]?.extractor_name).toBe("markdown");
  });

  it("handles unsupported uploaded file types without creating fake memory", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.uploadFile(workspace.id, "/uploads/report.pdf", Buffer.from("%PDF demo"), {
      actor: "agent:test",
      mime_type: "application/pdf",
      ingest: true
    });

    const file = memoryfs.listFiles(workspace.id).find((entry) => entry.path === "/uploads/report.pdf")!;
    const sources = memoryfs.listExtractedSources(workspace.id, file.id);
    const metadata = JSON.parse(sources[0]!.metadata_json) as { unsupported?: boolean; reason?: string };
    const auditEvents = memoryfs.listAuditEvents(workspace.id);

    expect(sources).toHaveLength(1);
    expect(metadata.unsupported).toBe(true);
    expect(metadata.reason).toMatch(/PDF extraction is not enabled/);
    expect(memoryfs.listMemoryNodes(workspace.id)).toHaveLength(0);
    expect(auditEvents.some((event) => event.event_type === "file_extraction_unsupported")).toBe(true);
  });

  it("keeps the raw file canonical when extracted text is derived", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const csv = "status,name\nopen,alpha\nclosed,beta";

    await memoryfs.uploadFile(workspace.id, "/uploads/status.csv", Buffer.from(csv), {
      actor: "agent:test",
      mime_type: "text/csv",
      ingest: false
    });
    await memoryfs.extractFile(workspace.id, "/uploads/status.csv", "agent:test");

    const read = await memoryfs.readFile(workspace.id, "/uploads/status.csv");
    const sources = memoryfs.listExtractedSources(workspace.id, read.file.id);

    expect(read.content).toBe(csv);
    expect(sources[0]?.content_text).toBe(csv);
    expect(JSON.parse(sources[0]!.metadata_json).sections[1].sourceLocation).toMatchObject({
      type: "csv",
      row_start: 2
    });
  });

  it("recall still supports the old body shape", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/old-shape.md", "Decision: Keep old recall clients compatible.", {
      actor: "agent:test",
      ingest: true
    });

    const recall = await memoryfs.recallMemory(workspace.id, "old recall clients", {
      limit: 3,
      include_detail: true,
      include_raw: false
    });

    expect(recall.query).toBe("old recall clients");
    expect(recall.results[0]?.source_path).toBe("/scratch/old-shape.md");
  });

  it("recall with include_why returns score components", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/why.md", "Decision: Explainable recall should show score components.", {
      actor: "agent:test",
      ingest: true
    });

    const recall = await memoryfs.recallMemory(workspace.id, "explain recall score", {
      include_detail: true,
      include_why: true
    });

    expect(recall.plan?.mode).toBe("general");
    expect(recall.trace_id).toBeTruthy();
    expect(recall.results[0]?.why?.trigger_similarity).toBeTypeOf("number");
    expect(recall.results[0]?.why?.explanation).toContain("This was recalled because");
  });

  it("recall without include_why omits detailed explanation", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/no-why.md", "Decision: Why output is opt-in.", {
      actor: "agent:test",
      ingest: true
    });

    const recall = await memoryfs.recallMemory(workspace.id, "why output", {
      include_detail: true
    });

    expect(recall.results[0]?.why).toBeUndefined();
  });

  it("creating similar memory creates duplicate or related link", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/a.md", "Decision: Onboarding should stay short.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/b.md", "Decision: Onboarding should stay short.", {
      actor: "agent:test",
      ingest: true
    });

    const nodes = memoryfs.listMemoryNodes(workspace.id);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    const links = memoryfs.getMemoryNodeLinks(workspace.id, nodes[0]!.id);
    expect(links.some((link) => link.relation_type === "duplicates" || link.relation_type === "related_to")).toBe(true);
  });

  it("creating conflicting memory creates contradicts link", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/yes.md", "Decision: Onboarding should stay short.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/no.md", "Decision: Onboarding should not stay short.", {
      actor: "agent:test",
      ingest: true
    });

    const contradictions = memoryfs.findContradictions(workspace.id);
    expect(contradictions.length).toBeGreaterThan(0);
    expect(contradictions[0]?.link.relation_type).toBe("contradicts");
  });

  it("superseded memory is marked through a link, not deleted", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/old.md", "Decision: Onboarding should use one step.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/new.md", "Decision: Onboarding now should use two steps instead.", {
      actor: "agent:test",
      ingest: true
    });

    const nodes = memoryfs.listMemoryNodes(workspace.id);
    const superseded = memoryfs.findSupersededMemories(workspace.id);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    expect(superseded.length).toBeGreaterThan(0);
    expect(superseded[0]?.link.relation_type).toBe("supersedes");
  });

  it("graph links appear in node detail", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/one.md", "Decision: Graph links should be visible.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/two.md", "Task: Review visible graph links.", {
      actor: "agent:test",
      ingest: true
    });
    const nodes = memoryfs.listMemoryNodes(workspace.id);
    memoryfs.linkMemoryNodes(workspace.id, nodes[0]!.id, nodes[1]!.id, "related_to", {
      reason: "Test link"
    });

    const links = memoryfs.getMemoryNodeLinks(workspace.id, nodes[0]!.id);
    expect(links[0]?.other_summary).toBeTruthy();
    expect(links.some((link) => link.reason === "Test link")).toBe(true);
  });

  it("creates, lists, and deletes graph edges with typed source context", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/graph-source.md", "Decision: Graph source edges should stay source-backed.", {
      actor: "agent:test",
      ingest: true
    });
    const node = memoryfs.listMemoryNodes(workspace.id).find((entry) => entry.source_path === "/scratch/graph-source.md")!;
    const file = memoryfs.listFiles(workspace.id).find((entry) => entry.path === "/scratch/graph-source.md")!;

    const edge = memoryfs.createGraphEdge(workspace.id, {
      from_node_id: node.id,
      to_type: "file",
      to_id: file.id,
      relation_type: "implemented_in",
      confidence: 0.91,
      reason: "The durable source file implements this memory.",
      actor: "human:test"
    });
    const edges = memoryfs.listGraphEdgesForNode(workspace.id, node.id);

    expect(edge.edge_kind).toBe("graph_edge");
    expect(edge.to_type).toBe("file");
    expect(edge.to_source_path).toBe("/scratch/graph-source.md");
    expect(edges.some((entry) => entry.id === edge.id && entry.relation_type === "implemented_in")).toBe(true);

    const deleted = memoryfs.deleteGraphEdge(workspace.id, edge.id, { actor: "human:test" });
    expect(deleted.deleted).toBe(true);
    expect(memoryfs.listGraphEdgesForNode(workspace.id, node.id).some((entry) => entry.id === edge.id)).toBe(false);
  });

  it("finds related memories and exposes graph edges in recall results", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/graph-a.md", "Decision: OAuth refresh tokens rotate on login.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/graph-b.md", "Constraint: OAuth refresh tokens must stay server-side.", {
      actor: "agent:test",
      ingest: true
    });
    const nodes = memoryfs.listMemoryNodes(workspace.id);
    const decision = nodes.find((entry) => entry.source_path === "/scratch/graph-a.md")!;
    const constraint = nodes.find((entry) => entry.source_path === "/scratch/graph-b.md")!;

    const edge = memoryfs.createGraphEdge(workspace.id, {
      from_node_id: decision.id,
      to_node_id: constraint.id,
      relation_type: "supports",
      confidence: 0.94,
      reason: "Rotation supports the server-side token constraint.",
      actor: "human:test"
    });
    const related = memoryfs.findRelatedMemories(workspace.id, decision.id, { limit: 5 });
    const recall = await memoryfs.recallMemory(workspace.id, "OAuth refresh tokens rotate", {
      include_links: true,
      include_trust: true
    });
    const recalledDecision = recall.results.find((result) => result.node_id === decision.id);

    expect(related.some((result) => result.node.id === constraint.id && result.path.some((pathEdge) => pathEdge.id === edge.id))).toBe(true);
    expect(recalledDecision?.graph_edges?.some((graphEdge) => graphEdge.id === edge.id)).toBe(true);
    expect(recalledDecision?.source_path).toBe("/scratch/graph-a.md");
    expect(recalledDecision?.raw_ref).toContain("memoryfs://");
  });

  it("contradictions endpoint data returns unresolved contradictions", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/c1.md", "Constraint: Never remove the skip button.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/c2.md", "Constraint: Remove the skip button.", {
      actor: "agent:test",
      ingest: true
    });

    const contradictions = memoryfs.findContradictions(workspace.id);
    expect(contradictions.length).toBeGreaterThan(0);
    expect(contradictions[0]?.from_node).toBeTruthy();
    expect(contradictions[0]?.to_node).toBeTruthy();
  });

  it("assigns trust levels from memory zones", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/trust.md", "Decision: Scratch memory is temporary.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/runs/2026-05-01/result.md", "Decision: Run output is agent generated.", {
      actor: "agent:test",
      ingest: true
    });

    const nodes = memoryfs.listMemoryNodes(workspace.id);
    expect(nodes.find((node) => node.source_path === "/scratch/trust.md")?.trust_level).toBe("ephemeral");
    expect(nodes.find((node) => node.source_path === "/runs/2026-05-01/result.md")?.trust_level).toBe("agent_generated");
  });

  it("promotion to protected path creates a pending promotion", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/promote.md", "Decision: Promote only after review.", {
      actor: "agent:test",
      ingest: true
    });

    const promotion = await memoryfs.promoteMemory(workspace.id, {
      source_path: "/scratch/promote.md",
      target_path: "/preferences.md",
      actor: "agent:test",
      require_review: true
    });

    expect(promotion.status).toBe("pending");
    expect(memoryfs.listPromotions(workspace.id)).toHaveLength(1);
    expect(memoryfs.listCandidates(workspace.id)[0]?.status).toBe("candidate");
    await expect(memoryfs.readFile(workspace.id, "/preferences.md")).rejects.toThrow(/File not found/);
  });

  it("creates edits approves and audits memory candidates", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const candidate = await memoryfs.proposeMemoryCandidate(workspace.id, {
      memory_text: "Preference: Candidate review memories should be approved before durable recall.",
      promotion_target_path: "/preferences.md",
      actor: "agent:test",
      reason: "Proposed during review workflow test."
    });

    expect(candidate.status).toBe("candidate");
    expect(candidate.promotion_target_path).toBe("/preferences.md");
    expect(candidate.risk_flags).toContain("protected_target");

    const edited = await memoryfs.updateCandidate(workspace.id, candidate.id, {
      summary: "Preference: Candidate review memories require approval before durable recall.",
      actor: "human:test",
      reason: "Clarified approval wording."
    });
    expect(edited.node.summary).toContain("require approval");

    const approved = await memoryfs.approveCandidate(workspace.id, candidate.id, {
      reviewer: "human:test",
      comment: "Looks correct."
    });
    expect(approved.status).toBe("approved");

    const recall = await memoryfs.recallMemory(workspace.id, "candidate review durable recall", {
      include_trust: true
    });
    expect(recall.results.some((result) => result.status === "approved")).toBe(true);

    const events = memoryfs.listAuditEvents(workspace.id, 20).map((event) => event.event_type);
    expect(events).toContain("candidate.created");
    expect(events).toContain("candidate.edited");
    expect(events).toContain("candidate.approved");
  });

  it("marks duplicate candidates before review and blocks approval", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const first = await memoryfs.proposeMemoryCandidate(workspace.id, {
      memory_text: "Preference: The user prefers pnpm for JavaScript workspace commands.",
      promotion_target_path: "/preferences.md",
      actor: "agent:test",
      reason: "Initial candidate."
    });
    const duplicate = await memoryfs.proposeMemoryCandidate(workspace.id, {
      memory_text: "Preference: The user prefers pnpm for JavaScript workspace commands.",
      promotion_target_path: "/preferences.md",
      actor: "agent:test",
      reason: "Repeated observation."
    });

    expect(first.status).toBe("candidate");
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.duplicate_of).toBe(first.node_id);
    expect(duplicate.risk_flags).toContain("duplicate");
    expect(memoryfs.listCandidates(workspace.id, { status: "candidate" }).map((candidate) => candidate.id)).toEqual([first.id]);
    expect(memoryfs.listCandidates(workspace.id, { duplicates: true }).map((candidate) => candidate.id)).toContain(duplicate.id);
    await expect(
      memoryfs.approveCandidate(workspace.id, duplicate.id, {
        reviewer: "human:test",
        comment: "Should not approve duplicate."
      })
    ).rejects.toThrow(/Duplicate candidates/);

    const events = memoryfs.listAuditEvents(workspace.id, 30).map((event) => event.event_type);
    expect(events).toContain("candidate.duplicate_detected");
    expect(events).toContain("candidate.approval_blocked_duplicate");
  });

  it("marks conflicting candidates and requires resolution before approval", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(
      workspace.id,
      "/projects/auth/decisions.md",
      "Decision: OAuth refresh tokens are stored client-side for the auth project.",
      {
        actor: "human:test",
        ingest: true,
        allow_protected_write: true
      }
    );
    const existing = memoryfs
      .listMemoryNodes(workspace.id)
      .find((node) => node.source_path === "/projects/auth/decisions.md" && node.memory_type === "decision");
    expect(existing).toBeTruthy();

    const candidate = await memoryfs.proposeMemoryCandidate(workspace.id, {
      memory_text: "Decision: OAuth refresh tokens are no longer stored client-side for the auth project. Store them server-side.",
      type: "decision",
      scope: "project",
      project_slug: "auth",
      promotion_target_path: "/projects/auth/decisions.md",
      actor: "agent:test",
      reason: "New auth decision from debugging."
    });

    expect(candidate.status).toBe("conflicted");
    expect(candidate.conflicts_with).toContain(existing!.id);
    expect(candidate.conflict_reason).toBeTruthy();
    expect(candidate.risk_flags).toContain("conflict");
    expect(memoryfs.listCandidates(workspace.id, { conflicts: true }).map((item) => item.id)).toContain(candidate.id);
    await expect(
      memoryfs.approveCandidate(workspace.id, candidate.id, {
        reviewer: "human:test",
        comment: "Resolve first."
      })
    ).rejects.toThrow(/Conflicting candidates require resolution/);

    const resolved = memoryfs.resolveCandidateConflict(workspace.id, candidate.id, {
      mode: "mark_superseded",
      actor: "human:test",
      reason: "Server-side storage replaces the older client-side decision."
    });
    expect(resolved.status).toBe("candidate");
    expect(resolved.conflict_reason).toBeNull();
    expect(memoryfs.getMemoryNode(workspace.id, existing!.id).status).toBe("superseded");

    const approved = await memoryfs.approveCandidate(workspace.id, candidate.id, {
      reviewer: "human:test",
      comment: "Approved after conflict resolution."
    });
    expect(approved.status).toBe("approved");

    const events = memoryfs.listAuditEvents(workspace.id, 50).map((event) => event.event_type);
    expect(events).toContain("candidate.conflict_detected");
    expect(events).toContain("candidate.approval_blocked_conflict");
    expect(events).toContain("candidate.conflict_resolved");
    expect(events).toContain("memory.superseded");
  });

  it("rejects candidates and keeps them out of normal recall", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const candidate = await memoryfs.proposeMemoryCandidate(workspace.id, {
      memory_text: "Decision: Rejected candidate sentinel should never appear in normal recall.",
      promotion_target_path: "/memory/rejected-candidate.md",
      actor: "agent:test"
    });

    const rejected = memoryfs.rejectCandidate(workspace.id, candidate.id, {
      reviewer: "human:test",
      comment: "Not durable memory."
    });
    expect(rejected.status).toBe("rejected");

    const normalRecall = await memoryfs.recallMemory(workspace.id, "rejected candidate sentinel", {
      include_trust: true
    });
    const rejectedRecall = await memoryfs.recallMemory(workspace.id, "rejected candidate sentinel", {
      include_rejected: true,
      trust_levels: ["rejected"],
      include_trust: true
    });

    expect(normalRecall.results.some((result) => result.node_id === candidate.id)).toBe(false);
    expect(rejectedRecall.results.some((result) => result.node_id === candidate.id && result.status === "rejected")).toBe(true);
    expect(memoryfs.listAuditEvents(workspace.id, 20).map((event) => event.event_type)).toContain("candidate.rejected");
  });

  it("approval applies a promotion", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/promote-apply.md", "Preference: The user prefers reviewed memory.", {
      actor: "agent:test",
      ingest: true
    });
    const promotion = await memoryfs.promoteMemory(workspace.id, {
      source_path: "/scratch/promote-apply.md",
      target_path: "/preferences.md",
      actor: "agent:test",
      require_review: true
    });

    const applied = await memoryfs.approvePromotion(workspace.id, promotion.id, "human:test");
    const read = await memoryfs.readFile(workspace.id, "/preferences.md");

    expect(applied.status).toBe("applied");
    expect(read.content).toContain("Promoted from /scratch/promote-apply.md");
  });

  it("rejection does not apply a promotion", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/reject.md", "Preference: Reject this promotion.", {
      actor: "agent:test",
      ingest: true
    });
    const promotion = await memoryfs.promoteMemory(workspace.id, {
      source_path: "/scratch/reject.md",
      target_path: "/preferences.md",
      actor: "agent:test",
      require_review: true
    });

    const rejected = memoryfs.rejectPromotion(workspace.id, promotion.id, "human:test");

    expect(rejected.status).toBe("rejected");
    await expect(memoryfs.readFile(workspace.id, "/preferences.md")).rejects.toThrow(/File not found/);
  });

  it("normal recall excludes rejected nodes", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/rejected-node.md", "Decision: Rejected candidates stay out of normal recall.", {
      actor: "agent:test",
      ingest: true
    });
    const promotion = await memoryfs.promoteMemory(workspace.id, {
      source_path: "/scratch/rejected-node.md",
      target_path: "/memory/rejected.md",
      actor: "agent:test",
      require_review: true
    });
    memoryfs.rejectPromotion(workspace.id, promotion.id, "human:test");

    const rejectedRecall = await memoryfs.recallMemory(workspace.id, "rejected candidates", {
      include_rejected: true,
      trust_levels: ["rejected"],
      include_trust: true
    });
    const normalRecall = await memoryfs.recallMemory(workspace.id, "rejected candidates", {
      include_trust: true
    });

    expect(rejectedRecall.results.some((result) => result.status === "rejected")).toBe(true);
    expect(normalRecall.results.some((result) => result.status === "rejected")).toBe(false);
  });

  it("normal recall deprioritizes superseded nodes", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/old-super.md", "Decision: Onboarding should use one step.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/new-super.md", "Decision: Onboarding now should use two steps instead.", {
      actor: "agent:test",
      ingest: true
    });

    const recall = await memoryfs.recallMemory(workspace.id, "onboarding steps", {
      include_trust: true,
      limit: 5
    });

    expect(recall.results[0]?.trust_level).not.toBe("superseded");
  });

  it("snapshot creation captures files and memory nodes", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/snapshot.md", "Decision: Snapshots capture memory state.", {
      actor: "agent:test",
      ingest: true
    });

    const snapshot = memoryfs.createSnapshot(workspace.id, { name: "before-change", actor: "human:test" });
    const detail = memoryfs.getSnapshot(workspace.id, snapshot.id);

    expect(detail.items.some((item) => item.item_type === "file")).toBe(true);
    expect(detail.items.some((item) => item.item_type === "memory_node")).toBe(true);
  });

  it("rollback dry run reports changes", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/rollback.md", "Decision: Rollback starts here.", {
      actor: "agent:test",
      ingest: true
    });
    const snapshot = memoryfs.createSnapshot(workspace.id, { name: "before-change", actor: "human:test" });
    await memoryfs.writeFile(workspace.id, "/scratch/rollback.md", "Decision: Rollback changed this.", {
      actor: "agent:test",
      ingest: true
    });

    const dryRun = await memoryfs.rollbackSnapshot(workspace.id, snapshot.id, { dry_run: true });

    expect(dryRun.restored).toBe(false);
    expect(dryRun.diff.changed.length).toBeGreaterThan(0);
  });

  it("rollback restores file and memory state", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/restore.md", "Decision: Restore the original memory.", {
      actor: "agent:test",
      ingest: true
    });
    const snapshot = memoryfs.createSnapshot(workspace.id, { name: "restore-point", actor: "human:test" });
    await memoryfs.writeFile(workspace.id, "/scratch/restore.md", "Decision: Replace the original memory.", {
      actor: "agent:test",
      ingest: true
    });

    const result = await memoryfs.rollbackSnapshot(workspace.id, snapshot.id, { actor: "human:test" });
    const read = await memoryfs.readFile(workspace.id, "/scratch/restore.md");
    const audit = memoryfs.listAuditEvents(workspace.id);

    expect(result.restored).toBe(true);
    expect(read.content).toContain("Restore the original memory");
    expect(memoryfs.listMemoryNodes(workspace.id).some((node) => node.summary.includes("Restore"))).toBe(true);
    expect(audit.some((event) => event.event_type === "snapshot_rollback")).toBe(true);
  });

  it("health score detects orphan nodes", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/orphan.md", "Decision: Health should detect orphan nodes.", {
      actor: "agent:test",
      ingest: true
    });
    const node = memoryfs.listMemoryNodes(workspace.id)[0]!;

    memoryfs.db.raw.run("PRAGMA foreign_keys = OFF");
    memoryfs.db.prepare("DELETE FROM files WHERE id = ?").run(node.source_file_id);
    memoryfs.db.raw.run("PRAGMA foreign_keys = ON");

    const health = memoryfs.recomputeMemoryHealth(workspace.id);
    expect(health.orphan_node_count).toBeGreaterThan(0);
  });

  it("health score detects unresolved contradictions", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/yes-health.md", "Decision: Keep the welcome checklist.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/no-health.md", "Decision: Do not keep the welcome checklist.", {
      actor: "agent:test",
      ingest: true
    });

    const health = memoryfs.recomputeMemoryHealth(workspace.id);
    expect(health.contradiction_count).toBeGreaterThan(0);
  });

  it("brief returns decisions, constraints, preferences, errors, and open questions without raw", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/memory/facts.md", "Fact: Pipsqueak onboarding uses OAuth refresh tokens for returning users.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/projects/pipsqueak/decisions.md", "Decision: Pipsqueak onboarding should stay short.", {
      actor: "agent:test",
      ingest: true,
      allow_protected_write: true
    });
    await memoryfs.writeFile(workspace.id, "/projects/pipsqueak/constraints.md", "Constraint: Pipsqueak onboarding must keep the skip button.", {
      actor: "agent:test",
      ingest: true,
      allow_protected_write: true
    });
    await memoryfs.writeFile(workspace.id, "/memory/prefs.md", "Preference: Pipsqueak onboarding copy should be concise.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/memory/errors.md", "Error: Pipsqueak onboarding failed when the welcome step was removed.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/memory/questions.md", "Open question: Should Pipsqueak onboarding include a checklist?", {
      actor: "agent:test",
      ingest: true
    });

    const brief = await memoryfs.createBrief(workspace.id, {
      task: "Edit Pipsqueak onboarding",
      project_hint: "pipsqueak",
      include_open_questions: true,
      include_raw: false
    });

    expect(brief.sections.facts.length).toBeGreaterThan(0);
    expect(brief.sections.decisions.length).toBeGreaterThan(0);
    expect(brief.sections.constraints.length).toBeGreaterThan(0);
    expect(brief.sections.preferences.length).toBeGreaterThan(0);
    expect(brief.sections.previous_errors.length).toBeGreaterThan(0);
    expect(brief.sections.open_questions.length).toBeGreaterThan(0);
    expect(brief.sections.decisions[0]?.source.source_path).toBeTruthy();
    expect(brief.sections.decisions[0]?.trust_level).toBeTruthy();
    expect(brief.memory_results.some((result) => result.raw_content)).toBe(false);
  });

  it("brief can include reasoning memory candidates when requested", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const run = await memoryfs.createRun(workspace.id, {
      task: "Debug large upload failures",
      actor: "agent:test"
    });
    await memoryfs.completeRun(workspace.id, run.id, {
      actor: "agent:test",
      errors: "Large upload failed because the serverless function timed out while proxying the binary.",
      result: "Use signed upload URLs and direct object storage upload; this avoided payload limits."
    });
    await memoryfs.compileRun(workspace.id, run.id, {
      actor: "agent:test",
      reasoning: true
    });

    const withoutCandidates = await memoryfs.createBrief(workspace.id, {
      task: "Fix large upload failures"
    });
    const withCandidates = await memoryfs.createBrief(workspace.id, {
      task: "Fix large upload failures",
      include_candidates: true
    });

    expect(withoutCandidates.sections.reasoning_memories).toHaveLength(0);
    expect(withCandidates.sections.reasoning_memories.length).toBeGreaterThan(0);
    expect(withCandidates.sections.reasoning_memories[0]?.status).toBe("candidate");
    expect(withCandidates.sections.reasoning_memories[0]?.source.source_path).toContain("reasoning-memories.json");
  });

  it("brief labels stale or superseded assumptions outside main sections", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/memory/old-oauth.md", "Decision: OAuth refresh tokens should be stored in browser storage.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/memory/new-oauth.md", "Decision: OAuth refresh tokens should be stored server-side.", {
      actor: "agent:test",
      ingest: true
    });
    const oldNode = memoryfs.listMemoryNodes(workspace.id).find((node) => node.source_path === "/memory/old-oauth.md")!;
    const newNode = memoryfs.listMemoryNodes(workspace.id).find((node) => node.source_path === "/memory/new-oauth.md")!;
    memoryfs.linkMemoryNodes(workspace.id, newNode.id, oldNode.id, "supersedes", {
      actor: "agent:test",
      reason: "Server-side storage replaced browser storage."
    });

    const brief = await memoryfs.createBrief(workspace.id, {
      task: "Fix OAuth refresh token flow"
    });

    expect(brief.sections.stale_or_conflicted.some((item) => item.source.node_id === oldNode.id)).toBe(true);
    expect(brief.sections.decisions.some((item) => item.source.node_id === oldNode.id)).toBe(false);
  });

  it("brief scope filters project context", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/projects/auth/decisions.md", "Decision: Auth OAuth refresh tokens stay server-side.", {
      actor: "agent:test",
      ingest: true,
      allow_protected_write: true
    });
    await memoryfs.writeFile(workspace.id, "/projects/other/decisions.md", "Decision: Other OAuth refresh tokens use a separate service.", {
      actor: "agent:test",
      ingest: true,
      allow_protected_write: true
    });

    const brief = await memoryfs.createBrief(workspace.id, {
      task: "Fix OAuth refresh token flow",
      scope: "project",
      project_slug: "auth"
    });

    expect(brief.memory_results.length).toBeGreaterThan(0);
    expect(brief.memory_results.every((result) => result.project_slug === "auth")).toBe(true);
  });

  it("brief writes run brief when run creation is enabled", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/brief-run.md", "Decision: Briefs can create run folders.", {
      actor: "agent:test",
      ingest: true
    });

    const brief = await memoryfs.createBrief(workspace.id, {
      task: "Prepare run folder",
      create_run: true,
      actor: "agent:test"
    });
    const read = await memoryfs.readFile(workspace.id, `/runs/${brief.run_id}/brief.md`);

    expect(brief.run_id).toBeTruthy();
    expect(read.content).toContain("# Memory Brief");
  });

  it("run creation creates folder and database row", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const run = await memoryfs.createRun(workspace.id, {
      task: "Implement run folders",
      actor: "agent:test"
    });

    const files = memoryfs.listFiles(workspace.id);
    expect(memoryfs.getRun(workspace.id, run.id).run_path).toBe(`/runs/${run.id}`);
    expect(files.some((file) => file.path === `/runs/${run.id}/prompt.md`)).toBe(true);
    expect(files.some((file) => file.path === `/runs/${run.id}/memory-used.md`)).toBe(true);
  });

  it("recall during a run can log memory usage", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/run-memory.md", "Decision: Run recall should log memory usage.", {
      actor: "agent:test",
      ingest: true
    });
    const run = await memoryfs.createRun(workspace.id, { task: "Use memory", actor: "agent:test" });

    await memoryfs.recallMemory(workspace.id, "run recall memory usage", {
      run_id: run.id,
      include_detail: true
    });

    expect(memoryfs.listRunMemoryUsage(workspace.id, run.id).length).toBeGreaterThan(0);
    const artifact = await memoryfs.readFile(workspace.id, `/runs/${run.id}/memory-used.md`);
    expect(artifact.content).toContain("recalled");
  });

  it("compile-run creates candidate memory nodes and suggested promotions", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const run = await memoryfs.createRun(workspace.id, { task: "Compile run", actor: "agent:test" });
    await memoryfs.completeRun(workspace.id, run.id, {
      actor: "agent:test",
      result: "Decision: Keep onboarding brief and review candidate memory.",
      followups: "Next: Promote the durable onboarding decision."
    });

    const compiled = await memoryfs.compileRun(workspace.id, run.id, { actor: "agent:test" });

    expect(compiled.candidate_nodes.length).toBeGreaterThan(0);
    expect(compiled.candidate_nodes[0]?.status).toBe("candidate");
    expect(compiled.suggested_promotions.length).toBeGreaterThan(0);
    expect(memoryfs.getRun(workspace.id, run.id).status).toBe("compiled");
  });

  it("compile-run can create source-backed reasoning memory candidates", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const run = await memoryfs.createRun(workspace.id, {
      task: "Debug large video uploads on Netlify with Supabase Storage",
      actor: "agent:test"
    });
    await memoryfs.completeRun(workspace.id, run.id, {
      actor: "agent:test",
      errors: "Large video upload failed because proxying the binary through a serverless function caused timeouts.",
      result: "Use signed upload URLs and upload directly to Supabase Storage instead. Direct upload avoided function payload limits.",
      followups: "Next time avoid proxying entire binaries through serverless functions."
    });

    const compiled = await memoryfs.compileRun(workspace.id, run.id, {
      actor: "agent:test",
      reasoning: true
    });

    expect(compiled.reasoning_candidates.length).toBeGreaterThan(0);
    expect(compiled.reasoning_candidates[0]).toMatchObject({
      type: "reasoning_memory",
      source_run: run.run_path,
      status: "candidate"
    });
    expect(compiled.reasoning_candidates[0]?.source_refs.length).toBeGreaterThan(0);
    expect(compiled.reasoning_candidates[0]?.source_refs[0]?.raw_ref).toContain("memoryfs://");

    const node = memoryfs.getMemoryNode(workspace.id, compiled.reasoning_candidates[0]!.node_id);
    expect(node.memory_type).toBe("reasoning_memory");
    expect(node.status).toBe("candidate");
    expect(node.trust_level).toBe("agent_generated");
    expect(JSON.parse(node.source_location_json ?? "{}")).toMatchObject({
      type: "reasoning_memory",
      source_run: run.run_path
    });
    const graphEdges = memoryfs.listGraphEdgesForNode(workspace.id, node.id);
    expect(graphEdges.some((edge) => edge.relation_type === "observed_in" && edge.to_type === "run" && edge.to_id === run.id)).toBe(true);
    expect(graphEdges.some((edge) => edge.relation_type === "derived_from" && edge.to_source_path === `${run.run_path}/reasoning-memories.json`)).toBe(true);

    const lessons = memoryfs.listRunLessons(workspace.id, run.id);
    expect(lessons[0]?.title).toBe(compiled.reasoning_candidates[0]?.title);
  });

  it("failed runs can still produce failure reasoning lessons", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const run = await memoryfs.createRun(workspace.id, {
      task: "Fix OAuth refresh token renewal",
      actor: "agent:test"
    });
    await memoryfs.completeRun(workspace.id, run.id, {
      actor: "agent:test",
      failed: true,
      errors: "OAuth refresh token renewal failed with invalid_grant after blind retries.",
      result: "Strategy: stop blind retries, inspect provider token rotation rules, and re-authenticate when invalid_grant appears."
    });

    const compiled = await memoryfs.compileRun(workspace.id, run.id, {
      actor: "agent:test",
      reasoning: true
    });

    expect(compiled.reasoning_candidates.length).toBeGreaterThan(0);
    expect(compiled.reasoning_candidates[0]?.failure_pattern.toLowerCase()).toContain("failed");
    expect(compiled.reasoning_candidates[0]?.status).toBe("candidate");
  });

  it("does not create duplicate reasoning memories on repeated compile", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const run = await memoryfs.createRun(workspace.id, {
      task: "Debug serverless upload timeout",
      actor: "agent:test"
    });
    await memoryfs.completeRun(workspace.id, run.id, {
      actor: "agent:test",
      errors: "Upload failed because the serverless function timed out while proxying a large file.",
      result: "Use direct object storage uploads with a signed URL instead."
    });

    const first = await memoryfs.compileRun(workspace.id, run.id, {
      actor: "agent:test",
      reasoning: true
    });
    const second = await memoryfs.compileRun(workspace.id, run.id, {
      actor: "agent:test",
      reasoning: true
    });

    expect(first.reasoning_candidates.length).toBeGreaterThan(0);
    expect(second.reasoning_candidates).toHaveLength(0);
    expect(memoryfs.listRunLessons(workspace.id, run.id)).toHaveLength(first.reasoning_candidates.length);
  });

  it("handoff summary writes a file and creates a memory node", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/memory/handoff-source.md", "Decision: Handoff summaries should include current state.", {
      actor: "agent:test",
      ingest: true
    });

    const handoff = await memoryfs.createHandoff(workspace.id, {
      project_hint: "handoff",
      actor: "agent:test"
    });

    expect(handoff.path).toContain("/handoffs/");
    expect(handoff.content).toContain("# Handoff");
    expect(handoff.node).toBeTruthy();
  });

  it("stale memory excludes trusted recent nodes and includes rejected or superseded nodes", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/old.md", "Decision: Use the old onboarding copy.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/new.md", "Decision: Onboarding now should use the new copy instead.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/rejected-stale.md", "Decision: Rejected stale candidate.", {
      actor: "agent:test",
      ingest: true
    });
    const promotion = await memoryfs.promoteMemory(workspace.id, {
      source_path: "/scratch/rejected-stale.md",
      target_path: "/memory/rejected-stale.md",
      actor: "agent:test",
      require_review: true
    });
    memoryfs.rejectPromotion(workspace.id, promotion.id, "human:test");
    await memoryfs.writeFile(workspace.id, "/preferences.md", "Preference: Trusted recent memory should remain healthy.", {
      actor: "human:test",
      ingest: true,
      allow_protected_write: true
    });
    const trusted = memoryfs.listMemoryNodes(workspace.id).find((node) => node.source_path === "/preferences.md")!;
    memoryfs.db
      .prepare("UPDATE memory_nodes SET trust_level = ? WHERE id = ?")
      .run("trusted", trusted.id);

    const stale = memoryfs.listStaleMemory(workspace.id);

    expect(stale.some((candidate) => candidate.reasons.includes("superseded"))).toBe(true);
    expect(stale.some((candidate) => candidate.reasons.includes("rejected"))).toBe(true);
    expect(stale.some((candidate) => candidate.node.id === trusted.id)).toBe(false);
  });

  it("excludes stale memories from recall and semantic grep unless requested", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/backend-plan.md", "Decision: Backend plan uses the MVP Rails service.", {
      actor: "agent:test",
      ingest: true
    });
    const node = memoryfs.listMemoryNodes(workspace.id).find((entry) => entry.source_path === "/scratch/backend-plan.md")!;

    const stale = memoryfs.markMemoryStale(workspace.id, node.id, {
      actor: "human:test",
      reason: "MVP backend changed"
    });
    const recall = await memoryfs.recallMemory(workspace.id, "backend plan rails", { include_trust: true });
    const recallWithStale = await memoryfs.recallMemory(workspace.id, "backend plan rails", {
      include_stale: true,
      include_trust: true
    });
    const grep = await memoryfs.grepMemory(workspace.id, "backend plan rails", { mode: "semantic" });
    const grepWithStale = await memoryfs.grepMemory(workspace.id, "backend plan rails", {
      mode: "semantic",
      include_stale: true
    });

    expect(stale.status).toBe("stale");
    expect(stale.stale_reason).toBe("MVP backend changed");
    expect(recall.results.some((result) => result.node_id === node.id)).toBe(false);
    expect(recallWithStale.results.some((result) => result.node_id === node.id && result.status === "stale")).toBe(true);
    expect(grep.results.some((result) => result.node_id === node.id)).toBe(false);
    expect(grepWithStale.results.some((result) => result.node_id === node.id)).toBe(true);
  });

  it("confirms stale memories and records confirmation time", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/confirm.md", "Decision: Confirmed memory stays current.", {
      actor: "agent:test",
      ingest: true
    });
    const node = memoryfs.listMemoryNodes(workspace.id).find((entry) => entry.source_path === "/scratch/confirm.md")!;
    memoryfs.markMemoryStale(workspace.id, node.id, {
      actor: "human:test",
      reason: "Needs reconfirmation"
    });

    const confirmed = memoryfs.confirmMemory(workspace.id, node.id, { actor: "human:test" });
    const audit = memoryfs.listAuditEvents(workspace.id);

    expect(confirmed.status).toBe("active");
    expect(confirmed.last_confirmed_at).toBeTruthy();
    expect(confirmed.stale_reason).toBeNull();
    expect(audit.some((event) => event.event_type === "memory.confirmed")).toBe(true);
  });

  it("links superseded memories for audit and excludes old memory by default", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/old-backend.md", "Decision: Backend plan uses Express for API routes.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/new-backend.md", "Decision: Backend plan uses Fastify for API routes.", {
      actor: "agent:test",
      ingest: true
    });
    const oldNode = memoryfs.listMemoryNodes(workspace.id).find((entry) => entry.source_path === "/scratch/old-backend.md")!;
    const newNode = memoryfs.listMemoryNodes(workspace.id).find((entry) => entry.source_path === "/scratch/new-backend.md")!;

    memoryfs.supersedeMemory(workspace.id, oldNode.id, newNode.id, {
      actor: "human:test",
      reason: "Backend framework changed"
    });
    const oldAfter = memoryfs.getMemoryNode(workspace.id, oldNode.id);
    const newAfter = memoryfs.getMemoryNode(workspace.id, newNode.id);
    const supersedeEdges = memoryfs.listGraphEdgesForNode(workspace.id, newNode.id);
    const relationshipPath = memoryfs.explainRelationshipPath(workspace.id, newNode.id, oldNode.id);
    const defaultRecall = await memoryfs.recallMemory(workspace.id, "Express API routes", { include_trust: true });
    const auditRecall = await memoryfs.recallMemory(workspace.id, "Express API routes", {
      include_stale: true,
      include_trust: true
    });
    const audit = memoryfs.listAuditEvents(workspace.id);

    expect(oldAfter.status).toBe("superseded");
    expect(oldAfter.superseded_by).toContain(newNode.id);
    expect(newAfter.supersedes).toContain(oldNode.id);
    expect(supersedeEdges.some((edge) => edge.relation_type === "supersedes" && edge.to_id === oldNode.id)).toBe(true);
    expect(relationshipPath.found).toBe(true);
    expect(relationshipPath.path[0]?.relation_type).toBe("supersedes");
    expect(defaultRecall.results.some((result) => result.node_id === oldNode.id)).toBe(false);
    expect(auditRecall.results.some((result) => result.node_id === oldNode.id && result.status === "superseded")).toBe(true);
    expect(audit.some((event) => event.event_type === "memory.superseded")).toBe(true);
  });

  it("memory health reports stale, old, unconfirmed, and superseded counts", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/health-stale.md", "Decision: Health stale memory should be counted.", {
      actor: "agent:test",
      ingest: true
    });
    await memoryfs.writeFile(workspace.id, "/scratch/health-new.md", "Decision: Health replacement memory should be counted.", {
      actor: "agent:test",
      ingest: true
    });
    const staleNode = memoryfs.listMemoryNodes(workspace.id).find((entry) => entry.source_path === "/scratch/health-stale.md")!;
    const newNode = memoryfs.listMemoryNodes(workspace.id).find((entry) => entry.source_path === "/scratch/health-new.md")!;
    memoryfs.markMemoryStale(workspace.id, staleNode.id, {
      actor: "human:test",
      reason: "Health stale reason"
    });
    memoryfs.supersedeMemory(workspace.id, staleNode.id, newNode.id, {
      actor: "human:test",
      reason: "Health replacement"
    });
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 120).toISOString();
    memoryfs.db.prepare("UPDATE memory_nodes SET updated_at = ?, last_confirmed_at = NULL WHERE id = ?").run(oldDate, newNode.id);

    const health = memoryfs.recomputeMemoryHealth(workspace.id);
    const audit = memoryfs.listAuditEvents(workspace.id);

    expect(health.stale_node_count).toBeGreaterThanOrEqual(1);
    expect(health.old_node_count).toBeGreaterThanOrEqual(1);
    expect(health.unconfirmed_node_count).toBeGreaterThanOrEqual(1);
    expect(health.superseded_node_count).toBeGreaterThanOrEqual(1);
    expect(audit.some((event) => event.event_type === "memory.marked_stale")).toBe(true);
  });

  it("local mode still works without auth", async () => {
    const local = new MemoryFS({
      dataDir: path.join(tempDir, "local-mode"),
      mode: "local",
      memory: { useLlm: false }
    });
    await local.initialize();
    try {
      const workspace = local.createWorkspace("local");
      await local.writeFile(workspace.id, "/scratch/local.md", "Local mode stays unauthenticated.", {
        ingest: false
      });

      const read = await local.readFile(workspace.id, "/scratch/local.md");
      expect(read.content).toContain("unauthenticated");
    } finally {
      local.close();
    }
  });

  it("creates sync events on file writes", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.writeFile(workspace.id, "/scratch/sync.md", "Sync events should track file writes.", {
      actor: "agent:test",
      ingest: false
    });

    const events = memoryfs.listSyncEvents(workspace.id);
    expect(events.some((event) => event.object_type === "files" && event.operation === "upsert")).toBe(true);
    expect(events.some((event) => event.actor === "agent:test")).toBe(true);
  });

  it("sync pull applies a remote file event", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    const remoteEvent = remoteFileEvent(workspace.id, "/scratch/remote.md", "Remote content arrived through sync.");

    const result = await memoryfs.syncPull(workspace.id, {
      actor: "agent:sync",
      events: [remoteEvent]
    });
    const read = await memoryfs.readFile(workspace.id, "/scratch/remote.md");

    expect(result.applied).toBe(1);
    expect(read.content).toContain("Remote content arrived");
  });

  it("sync detects same-file conflicts", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/conflict.md", "Local content", {
      actor: "agent:test",
      ingest: false
    });

    const result = await memoryfs.syncPull(workspace.id, {
      actor: "agent:sync",
      events: [remoteFileEvent(workspace.id, "/scratch/conflict.md", "Remote content")]
    });

    expect(result.applied).toBe(0);
    expect(result.conflicts[0]?.conflict_type).toBe("same_file_changed");
  });

  it("protected path conflicts do not auto-resolve", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    const result = await memoryfs.syncPull(workspace.id, {
      actor: "agent:sync",
      events: [remoteFileEvent(workspace.id, "/preferences.md", "Remote protected content")]
    });

    expect(result.applied).toBe(0);
    expect(result.conflicts[0]?.conflict_type).toBe("protected_path_conflict");
    await expect(memoryfs.readFile(workspace.id, "/preferences.md")).rejects.toThrow(/File not found/);
  });

  it("keep_both conflict resolution creates a conflict copy", async () => {
    const workspace = memoryfs.createWorkspace("demo");
    await memoryfs.writeFile(workspace.id, "/scratch/keep-both.md", "Local version", {
      actor: "agent:test",
      ingest: false
    });
    const pull = await memoryfs.syncPull(workspace.id, {
      actor: "agent:sync",
      events: [remoteFileEvent(workspace.id, "/scratch/keep-both.md", "Remote version")]
    });

    const resolved = await memoryfs.resolveConflict(workspace.id, pull.conflicts[0]!.id, {
      mode: "keep_both",
      actor: "human:test"
    });
    const files = memoryfs.listFiles(workspace.id);

    expect(resolved.status).toBe("resolved_manual");
    expect(files.some((file) => file.path.startsWith("/conflicts/") && file.path.endsWith("/scratch/keep-both.md"))).toBe(true);
  });

  it("role permissions block raw reads", async () => {
    const secure = new MemoryFS({
      dataDir: path.join(tempDir, "secure-raw"),
      authRequired: true,
      memory: { useLlm: false }
    });
    await secure.initialize();
    try {
      const workspace = secure.createWorkspace("secure");
      secure.addWorkspaceMember(workspace.id, { handle: "human:owner", role: "owner" });
      secure.addWorkspaceMember(workspace.id, { handle: "human:viewer", role: "viewer", actor: "human:owner" });
      await secure.writeFile(workspace.id, "/scratch/raw.md", "Decision: Raw reads require permission.", {
        actor: "human:owner",
        ingest: true
      });
      const node = secure.listMemoryNodes(workspace.id)[0]!;

      await expect(
        secure.readRawForNode(workspace.id, node.id, { actor: "human:viewer" })
      ).rejects.toThrow(/not allowed/);
    } finally {
      secure.close();
    }
  });

  it("agent role can write runs but not protected paths", async () => {
    const secure = new MemoryFS({
      dataDir: path.join(tempDir, "secure-agent"),
      authRequired: true,
      memory: { useLlm: false }
    });
    await secure.initialize();
    try {
      const workspace = secure.createWorkspace("secure");
      secure.addWorkspaceMember(workspace.id, { handle: "human:owner", role: "owner" });
      secure.addWorkspaceMember(workspace.id, { handle: "agent:demo", role: "agent", actor: "human:owner" });

      await secure.writeFile(workspace.id, "/runs/demo/result.md", "Agent run output.", {
        actor: "agent:demo",
        ingest: false
      });
      await expect(
        secure.writeFile(workspace.id, "/preferences.md", "Agent protected edit.", {
          actor: "agent:demo",
          ingest: false,
          allow_protected_write: true
        })
      ).rejects.toThrow(/not allowed/);
    } finally {
      secure.close();
    }
  });

  it("owner can create snapshots and roll back", async () => {
    const secure = new MemoryFS({
      dataDir: path.join(tempDir, "secure-snapshot"),
      authRequired: true,
      memory: { useLlm: false }
    });
    await secure.initialize();
    try {
      const workspace = secure.createWorkspace("secure");
      secure.addWorkspaceMember(workspace.id, { handle: "human:owner", role: "owner" });
      await secure.writeFile(workspace.id, "/scratch/owner.md", "Before rollback.", {
        actor: "human:owner",
        ingest: false
      });
      const snapshot = secure.createSnapshot(workspace.id, {
        name: "owner-point",
        actor: "human:owner"
      });
      await secure.writeFile(workspace.id, "/scratch/owner.md", "After rollback.", {
        actor: "human:owner",
        ingest: false
      });

      const rollback = await secure.rollbackSnapshot(workspace.id, snapshot.id, {
        actor: "human:owner"
      });
      const read = await secure.readFile(workspace.id, "/scratch/owner.md", { actor: "human:owner" });

      expect(rollback.restored).toBe(true);
      expect(read.content).toContain("Before rollback");
    } finally {
      secure.close();
    }
  });
});

function remoteFileEvent(workspaceId: string, filePath: string, content: string): SyncEvent {
  const now = new Date().toISOString();
  const payload = {
    id: `remote:${filePath}`,
    workspace_id: workspaceId,
    path: filePath,
    current_blob_sha256: `remote:${content.length}:${filePath}`,
    mime_type: "text/markdown",
    size_bytes: Buffer.byteLength(content),
    created_at: now,
    updated_at: now,
    content_base64: Buffer.from(content).toString("base64")
  };
  return {
    id: `sync:${filePath}:${content.length}`,
    workspace_id: workspaceId,
    object_type: "files",
    object_id: payload.id,
    operation: "upsert",
    object_version: now,
    payload_json: JSON.stringify(payload),
    actor: "agent:remote",
    created_at: now
  };
}
