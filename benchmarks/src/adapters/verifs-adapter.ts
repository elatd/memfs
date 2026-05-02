import { VeriFS, type MemoryGrepResult } from "@verifs/core";
import { createHash } from "node:crypto";
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

export class VeriFSAdapter implements MemorySystemAdapter {
  name = "verifs";

  private dataDir: string | null = null;
  private verifs: VeriFS | null = null;
  private workspaceId: string | null = null;
  private sourceIdsByPath = new Map<string, string>();
  private metadataBySourceId = new Map<string, MemoryMetadata>();

  async reset(): Promise<void> {
    await this.close();

    process.env.OPENAI_API_KEY = "";
    this.dataDir = await mkdtemp(path.join(tmpdir(), "verifs-smoke-benchmark-"));
    this.verifs = new VeriFS({
      dataDir: this.dataDir,
      memory: {
        useLlm: false
      }
    });
    await this.verifs.initialize();
    this.workspaceId = this.verifs.createWorkspace("smoke-benchmark").id;
    this.sourceIdsByPath = new Map();
    this.metadataBySourceId = new Map();
  }

  async ingest(input: MemoryIngestInput): Promise<void> {
    const verifs = await this.getVeriFS();
    const workspaceId = await this.getWorkspaceId();
    const filePath = sourcePathFor(input.sourceId, input.metadata);

    await verifs.writeFile(workspaceId, filePath, input.text, {
      actor: "benchmark:seed",
      ingest: true,
      allow_protected_write: true
    });

    this.sourceIdsByPath.set(filePath, input.sourceId);
    this.metadataBySourceId.set(input.sourceId, input.metadata ?? {});

    if (input.metadata?.status === "stale") {
      const node = verifs.listMemoryNodes(workspaceId).find((entry) => entry.source_path === filePath);
      if (node) {
        verifs.markMemoryStale(workspaceId, node.id, {
          actor: "benchmark:seed",
          reason: "Smoke benchmark fixture marks this memory as stale."
        });
      }
    }
  }

  async retrieve(query: MemoryRetrieveQuery): Promise<MemoryRetrievedItem[]> {
    const verifs = await this.getVeriFS();
    const workspaceId = await this.getWorkspaceId();
    const response = await verifs.grepMemory(workspaceId, query.text, {
      mode: "hybrid",
      include_sources: true,
      include_runs: true,
      include_stale: false,
      limit: query.k ?? 5
    });

    return uniqueBySource(response.results.map((result) => this.fromGrepResult(result)));
  }

  async close(): Promise<void> {
    if (this.verifs) {
      this.verifs.close();
      this.verifs = null;
    }

    if (this.dataDir) {
      await rm(this.dataDir, { recursive: true, force: true });
      this.dataDir = null;
    }

    this.workspaceId = null;
    this.sourceIdsByPath = new Map();
    this.metadataBySourceId = new Map();
  }

  private async getVeriFS(): Promise<VeriFS> {
    if (!this.verifs) {
      await this.reset();
    }

    if (!this.verifs) {
      throw new Error("VeriFS adapter failed to initialize.");
    }

    return this.verifs;
  }

  private async getWorkspaceId(): Promise<string> {
    if (!this.workspaceId) {
      await this.reset();
    }

    if (!this.workspaceId) {
      throw new Error("VeriFS adapter workspace is not initialized.");
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

export function sourcePathFor(sourceId: string, metadata?: MemoryMetadata): string {
  if (typeof metadata?.path === "string" && metadata.path.startsWith("/")) {
    return metadata.path;
  }

  const slug = sourceId
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "source";
  const hash = createHash("sha256").update(sourceId).digest("hex").slice(0, 12);

  return `/benchmarks/smoke/${slug}-${hash}.md`;
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
