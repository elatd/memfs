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
