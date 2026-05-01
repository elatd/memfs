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

  it("handles extraction failures without creating fake memory", async () => {
    const workspace = memoryfs.createWorkspace("demo");

    await memoryfs.uploadFile(workspace.id, "/uploads/report.pdf", Buffer.from("%PDF demo"), {
      actor: "agent:test",
      mime_type: "application/pdf",
      ingest: true
    });

    const file = memoryfs.listFiles(workspace.id).find((entry) => entry.path === "/uploads/report.pdf")!;
    const sources = memoryfs.listExtractedSources(workspace.id, file.id);
    const metadata = JSON.parse(sources[0]!.metadata_json) as {
      unsupported?: boolean;
      extraction_failed?: boolean;
      reason?: string;
    };
    const auditEvents = memoryfs.listAuditEvents(workspace.id);

    expect(sources).toHaveLength(1);
    expect(metadata.unsupported).toBe(true);
    expect(metadata.extraction_failed).toBe(true);
    expect(metadata.reason).toMatch(/PDF extraction failed/);
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
    expect(recall.results[0]?.why?.bm25_score).toBeTypeOf("number");
    expect(recall.results[0]?.why?.rrf_score).toBeTypeOf("number");
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
    await expect(memoryfs.readFile(workspace.id, "/preferences.md")).rejects.toThrow(/File not found/);
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

    expect(brief.sections.decisions.length).toBeGreaterThan(0);
    expect(brief.sections.constraints.length).toBeGreaterThan(0);
    expect(brief.sections.preferences.length).toBeGreaterThan(0);
    expect(brief.sections.previous_errors.length).toBeGreaterThan(0);
    expect(brief.sections.open_questions.length).toBeGreaterThan(0);
    expect(brief.memory_results.some((result) => result.raw_content)).toBe(false);
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
    expect(compiled.suggested_promotions.length).toBeGreaterThan(0);
    expect(memoryfs.getRun(workspace.id, run.id).status).toBe("compiled");
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
