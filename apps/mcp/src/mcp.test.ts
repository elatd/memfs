import { MemoryFS } from "@memoryfs/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemfsMcpToolHandlers, type McpToolHandlers } from "./server.js";

let tempDir: string;
let memoryfs: MemoryFS;
let handlers: McpToolHandlers;
let workspaceId: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "memfs-mcp-test-"));
  memoryfs = new MemoryFS({
    dataDir: tempDir,
    memory: { useLlm: false }
  });
  await memoryfs.initialize();
  handlers = createMemfsMcpToolHandlers(memoryfs);
  const workspace = (await handlers.memfs_workspace_create({ name: "demo" })) as { id: string };
  workspaceId = workspace.id;
});

afterEach(async () => {
  memoryfs.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("MemFS MCP handlers", () => {
  it("reads and writes files", async () => {
    await handlers.memfs_file_write({
      workspace_id: workspaceId,
      path: "/scratch/mcp.md",
      content: "Preference: MCP should expose the agent workflow.",
      ingest: false
    });

    const read = (await handlers.memfs_file_read({
      workspace_id: workspaceId,
      path: "/scratch/mcp.md"
    })) as { content: string };
    expect(read.content).toContain("agent workflow");
  });

  it("appends files without bypassing protected write rules", async () => {
    await handlers.memfs_file_append({
      workspace_id: workspaceId,
      path: "/scratch/append.md",
      content: "First note",
      ingest: false
    });
    await handlers.memfs_file_append({
      workspace_id: workspaceId,
      path: "/scratch/append.md",
      content: "Second note",
      ingest: false
    });

    const read = (await handlers.memfs_file_read({
      workspace_id: workspaceId,
      path: "/scratch/append.md"
    })) as { content: string };
    await expect(
      handlers.memfs_file_append({
        workspace_id: workspaceId,
        path: "/preferences.md",
        content: "Preference: This should still require protected permission.",
        ingest: false
      })
    ).rejects.toThrow(/Protected path/);

    expect(read.content).toContain("First note\nSecond note");
  });

  it("recall returns source_path and raw_ref without raw by default", async () => {
    await handlers.memfs_file_write({
      workspace_id: workspaceId,
      path: "/scratch/recall.md",
      content: "Decision: MCP recall should never hide source references.",
      ingest: true
    });

    const recall = (await handlers.memfs_memory_recall({
      workspace_id: workspaceId,
      query: "MCP recall source references"
    })) as { results: Array<{ source_path: string; raw_ref: string; raw_content?: string }> };

    expect(recall.results[0]?.source_path).toBe("/scratch/recall.md");
    expect(recall.results[0]?.raw_ref).toContain("memoryfs://");
    expect(recall.results[0]?.raw_content).toBeUndefined();
  });

  it("exposes hybrid grep with source-aware fields", async () => {
    await handlers.memfs_file_write({
      workspace_id: workspaceId,
      path: "/scratch/auth.md",
      content: "Decision: OAuth refresh tokens should be rotated by server-side auth code.",
      ingest: true
    });

    const grep = (await handlers.memfs_grep({
      workspace_id: workspaceId,
      query: "OAuth refresh tokens",
      mode: "hybrid"
    })) as {
      query: string;
      mode: string;
      workspace_id: string;
      results: Array<{
        path: string;
        source_path: string;
        raw_ref: string | null;
        line: number | null;
        snippet: string;
        score: number;
        trust: string | null;
        node_id: string | null;
        match_type: string;
      }>;
    };

    expect(grep.query).toBe("OAuth refresh tokens");
    expect(grep.mode).toBe("hybrid");
    expect(grep.workspace_id).toBe(workspaceId);
    expect(grep.results[0]?.path).toBe("/scratch/auth.md");
    expect(grep.results[0]?.raw_ref).toContain("memoryfs://");
    expect(grep.results[0]?.match_type).toBe("literal");
    expect(typeof grep.results[0]?.score).toBe("number");
  });

  it("accepts scope filters on grep and recall tools", async () => {
    await handlers.memfs_file_write({
      workspace_id: workspaceId,
      path: "/projects/pipsqueak/decisions.md",
      content: "Decision: MCP scoped OAuth refresh tokens stay inside the Pipsqueak project.",
      ingest: true,
      allow_protected_write: true
    });
    await handlers.memfs_file_write({
      workspace_id: workspaceId,
      path: "/preferences.md",
      content: "Preference: MCP workspace scoped OAuth defaults stay separate.",
      ingest: true,
      allow_protected_write: true
    });

    const grep = (await handlers.memfs_grep({
      workspace_id: workspaceId,
      query: "OAuth refresh tokens",
      scope: ["project"],
      project_slug: "pipsqueak"
    })) as { results: Array<{ scope: string; project_slug: string | null }> };
    const recall = (await handlers.memfs_memory_recall({
      workspace_id: workspaceId,
      query: "OAuth defaults",
      scope: ["workspace"]
    })) as { results: Array<{ scope: string }> };

    expect(grep.results.every((result) => result.scope === "project" && result.project_slug === "pipsqueak")).toBe(true);
    expect(recall.results.every((result) => result.scope === "workspace")).toBe(true);
  });

  it("returns raw only through explicit raw read", async () => {
    await handlers.memfs_file_write({
      workspace_id: workspaceId,
      path: "/scratch/raw.md",
      content: "Decision: Raw source is available only through explicit MCP raw reads.",
      ingest: true
    });

    const recall = (await handlers.memfs_memory_recall({
      workspace_id: workspaceId,
      query: "explicit raw reads"
    })) as { results: Array<{ node_id: string; raw_content?: string }> };
    expect(recall.results[0]?.raw_content).toBeUndefined();

    const raw = (await handlers.memfs_memory_raw_read({
      workspace_id: workspaceId,
      node_id: recall.results[0]!.node_id
    })) as { content: string };
    expect(raw.content).toContain("Raw source is available only");
  });

  it("uploads and reads extracted source metadata", async () => {
    await handlers.memfs_file_upload({
      workspace_id: workspaceId,
      path: "/uploads/rows.csv",
      content_base64: Buffer.from("status,name\nopen,alpha").toString("base64"),
      mime_type: "text/csv",
      ingest: false
    });

    const extracted = await handlers.memfs_file_extract({
      workspace_id: workspaceId,
      path: "/uploads/rows.csv"
    });
    const sources = (await handlers.memfs_extracted_source_read({
      workspace_id: workspaceId,
      path: "/uploads/rows.csv"
    })) as Array<{ extractor_name: string; metadata_json: string }>;

    expect((extracted as { extractor_name: string }).extractor_name).toBe("csv");
    expect(sources[0]?.extractor_name).toBe("csv");
    expect(sources[0]?.metadata_json).toContain("row_start");
  });

  it("does not expose promotion approval tools by default", () => {
    expect("memfs_memory_promote" in handlers).toBe(true);
    expect("memfs_promotion_approve" in handlers).toBe(false);
    expect("memfs_promotion_reject" in handlers).toBe(false);
    expect("memfs_candidate_approve" in handlers).toBe(false);
    expect("memfs_memory_supersede" in handlers).toBe(false);
  });

  it("lists stale or conflicted memory for review", async () => {
    await handlers.memfs_file_write({
      workspace_id: workspaceId,
      path: "/scratch/stale-mcp.md",
      content: "Decision: MCP stale memory should appear in review lists.",
      ingest: true
    });
    const node = memoryfs.listMemoryNodes(workspaceId).find((entry) => entry.source_path === "/scratch/stale-mcp.md")!;
    memoryfs.markMemoryStale(workspaceId, node.id, {
      actor: "human:test",
      reason: "MCP stale review"
    });

    const stale = (await handlers.memfs_stale_memory_list({ workspace_id: workspaceId })) as Array<{
      node: { id: string; status: string };
      reasons: string[];
    }>;

    expect(stale.some((entry) => entry.node.id === node.id && entry.node.status === "stale")).toBe(true);
    expect(stale.find((entry) => entry.node.id === node.id)?.reasons).toContain("stale");
  });

  it("lets agents propose and read candidates without approval tools", async () => {
    const candidate = (await handlers.memfs_candidate_create({
      workspace_id: workspaceId,
      memory_text: "Preference: MCP agents can propose candidate memories for review.",
      promotion_target_path: "/preferences.md",
      actor: "agent:mcp-test"
    })) as { id: string; status: string; promotion_target_path: string };

    expect(candidate.status).toBe("candidate");
    expect(candidate.promotion_target_path).toBe("/preferences.md");

    const candidates = (await handlers.memfs_candidate_list({
      workspace_id: workspaceId,
      status: "candidate"
    })) as Array<{ id: string; status: string }>;
    expect(candidates.some((item) => item.id === candidate.id)).toBe(true);

    const read = (await handlers.memfs_candidate_read({
      workspace_id: workspaceId,
      candidate_id: candidate.id
    })) as { id: string; source_refs: Array<{ raw_ref: string }> };
    expect(read.source_refs[0]?.raw_ref).toContain("memoryfs://");
  });

  it("brief returns source paths without raw content", async () => {
    await handlers.memfs_file_write({
      workspace_id: workspaceId,
      path: "/scratch/brief.md",
      content: "Decision: MCP briefs should include source paths.",
      ingest: true
    });

    const brief = (await handlers.memfs_brief({
      workspace_id: workspaceId,
      task: "Prepare with MCP brief",
      create_run: false
    })) as { memory_results: Array<{ source_path: string; raw_content?: string }> };

    expect(brief.memory_results[0]?.source_path).toBe("/scratch/brief.md");
    expect(brief.memory_results[0]?.raw_content).toBeUndefined();
  });

  it("appends run artifacts under the run folder", async () => {
    const run = (await handlers.memfs_run_create({
      workspace_id: workspaceId,
      task: "Fix OAuth refresh tokens"
    })) as { id: string; run_path: string };

    await handlers.memfs_run_append({
      workspace_id: workspaceId,
      run_id: run.id,
      kind: "result",
      text: "Refresh token rotation fixed."
    });

    const read = (await handlers.memfs_file_read({
      workspace_id: workspaceId,
      path: `${run.run_path}/result.md`
    })) as { content: string };
    const events = memoryfs.listRunEvents(workspaceId, run.id);

    expect(read.content).toContain("Refresh token rotation fixed.");
    expect(events.some((event) => event.event_type === "run_artifact_appended")).toBe(true);
  });

  it("brief accepts scope filters and candidate opt-in", async () => {
    await handlers.memfs_file_write({
      workspace_id: workspaceId,
      path: "/projects/auth/decisions.md",
      content: "Decision: MCP scoped briefs keep auth OAuth tokens server-side.",
      ingest: true,
      allow_protected_write: true
    });
    const candidate = (await handlers.memfs_candidate_create({
      workspace_id: workspaceId,
      memory_text: "Decision: Candidate memory can appear only when briefs opt in.",
      source_path: "/projects/auth/decisions.md",
      actor: "agent:mcp-test"
    })) as { id: string };

    const brief = (await handlers.memfs_brief({
      workspace_id: workspaceId,
      task: "Fix auth OAuth tokens",
      scope: ["project"],
      project_slug: "auth",
      include_candidates: true,
      create_run: false
    })) as {
      memory_results: Array<{ project_slug: string | null; node_id: string }>;
      sections: { decisions: Array<{ source: { trust_level: string | null } }> };
    };

    expect(brief.memory_results.every((result) => result.project_slug === "auth")).toBe(true);
    expect(brief.memory_results.some((result) => result.node_id === candidate.id)).toBe(true);
    expect(brief.sections.decisions[0]?.source.trust_level).toBeTruthy();
  });

  it("exposes local sync status without team admin tools", async () => {
    await handlers.memfs_file_write({
      workspace_id: workspaceId,
      path: "/scratch/sync.md",
      content: "Decision: MCP sync tools stay workspace scoped.",
      ingest: false
    });

    const status = (await handlers.memfs_sync_status({
      workspace_id: workspaceId
    })) as { pending_events: number; unresolved_conflicts: number };
    const conflicts = (await handlers.memfs_sync_conflict_list({
      workspace_id: workspaceId
    })) as unknown[];

    expect(status.pending_events).toBeGreaterThan(0);
    expect(status.unresolved_conflicts).toBe(0);
    expect(conflicts).toHaveLength(0);
    expect("memfs_team_member_add" in handlers).toBe(false);
  });
});
