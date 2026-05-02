import { MemoryFS, type MemoryGrepResult } from "@memoryfs/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  MemoryIngestInput,
  MemoryMetadata,
  MemoryRetrievedItem,
  MemoryRetrieveQuery,
  MemorySystemAdapter
} from "./memory-system-adapter.js";

export class MemFSAdapter implements MemorySystemAdapter {
  name = "memfs";

  private dataDir: string | null = null;
  private memoryfs: MemoryFS | null = null;
  private workspaceId: string | null = null;
  private sourceIdsByPath = new Map<string, string>();
  private metadataBySourceId = new Map<string, MemoryMetadata>();

  async reset(): Promise<void> {
    await this.close();

    process.env.OPENAI_API_KEY = "";
    this.dataDir = await mkdtemp(path.join(tmpdir(), "memfs-smoke-benchmark-"));
    this.memoryfs = new MemoryFS({
      dataDir: this.dataDir,
      memory: {
        useLlm: false
      }
    });
    await this.memoryfs.initialize();
    this.workspaceId = this.memoryfs.createWorkspace("smoke-benchmark").id;
    this.sourceIdsByPath = new Map();
    this.metadataBySourceId = new Map();
  }

  async ingest(input: MemoryIngestInput): Promise<void> {
    const memoryfs = await this.getMemoryFS();
    const workspaceId = await this.getWorkspaceId();
    const filePath = sourcePathFor(input.sourceId, input.metadata);

    await memoryfs.writeFile(workspaceId, filePath, input.text, {
      actor: "benchmark:seed",
      ingest: true,
      allow_protected_write: true
    });

    this.sourceIdsByPath.set(filePath, input.sourceId);
    this.metadataBySourceId.set(input.sourceId, input.metadata ?? {});

    if (input.metadata?.status === "stale") {
      const node = memoryfs.listMemoryNodes(workspaceId).find((entry) => entry.source_path === filePath);
      if (node) {
        memoryfs.markMemoryStale(workspaceId, node.id, {
          actor: "benchmark:seed",
          reason: "Smoke benchmark fixture marks this memory as stale."
        });
      }
    }
  }

  async retrieve(query: MemoryRetrieveQuery): Promise<MemoryRetrievedItem[]> {
    const memoryfs = await this.getMemoryFS();
    const workspaceId = await this.getWorkspaceId();
    const response = await memoryfs.grepMemory(workspaceId, query.text, {
      mode: "hybrid",
      include_sources: true,
      include_runs: true,
      include_stale: false,
      limit: query.k ?? 5
    });

    return uniqueBySource(response.results.map((result) => this.fromGrepResult(result)));
  }

  async close(): Promise<void> {
    if (this.memoryfs) {
      this.memoryfs.close();
      this.memoryfs = null;
    }

    if (this.dataDir) {
      await rm(this.dataDir, { recursive: true, force: true });
      this.dataDir = null;
    }

    this.workspaceId = null;
    this.sourceIdsByPath = new Map();
    this.metadataBySourceId = new Map();
  }

  private async getMemoryFS(): Promise<MemoryFS> {
    if (!this.memoryfs) {
      await this.reset();
    }

    if (!this.memoryfs) {
      throw new Error("MemFS adapter failed to initialize.");
    }

    return this.memoryfs;
  }

  private async getWorkspaceId(): Promise<string> {
    if (!this.workspaceId) {
      await this.reset();
    }

    if (!this.workspaceId) {
      throw new Error("MemFS adapter workspace is not initialized.");
    }

    return this.workspaceId;
  }

  private fromGrepResult(result: MemoryGrepResult): MemoryRetrievedItem {
    const sourceId = this.sourceIdsByPath.get(result.source_path) ?? result.source_path;

    return {
      sourceId,
      text: result.snippet,
      score: result.score,
      metadata: {
        ...(this.metadataBySourceId.get(sourceId) ?? {}),
        raw_ref: result.raw_ref,
        source_path: result.source_path,
        node_id: result.node_id,
        match_type: result.match_type
      }
    };
  }
}

function sourcePathFor(sourceId: string, metadata?: MemoryMetadata): string {
  if (typeof metadata?.path === "string" && metadata.path.startsWith("/")) {
    return metadata.path;
  }

  return `/benchmarks/smoke/${sourceId.replace(/[^a-zA-Z0-9._-]+/g, "-")}.md`;
}

function uniqueBySource(items: MemoryRetrievedItem[]): MemoryRetrievedItem[] {
  const seen = new Set<string>();
  const unique: MemoryRetrievedItem[] = [];

  for (const item of items) {
    const key = item.sourceId ?? item.text;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}
