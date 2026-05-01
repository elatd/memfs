import {
  MemoryFS,
  type BriefResponse,
  type MemoryGrepResult,
  type MemoryNode,
  type MemoryTrustLevel,
  type RecallResult
} from "@memoryfs/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  benchmarkLimitations,
  benchmarkQueries,
  fixtureArchives,
  fixtureFiles,
  fixtureRuns,
  type BenchmarkQuery,
  type FixtureLabel
} from "./fixtures.js";

type SeedIndex = Map<FixtureLabel, { path?: string; nodeId?: string }>;

interface BenchmarkResultItem {
  source_path: string;
  node_id: string | null;
  raw_ref: string | null;
  score: number;
  trust: MemoryTrustLevel | null;
  status: string | null;
  summary: string;
}

interface QueryMetrics {
  query: BenchmarkQuery;
  resultCount: number;
  topResult: BenchmarkResultItem | null;
  top1Hit: boolean;
  top3Hit: boolean;
  sourceReferencePresent: boolean;
  staleMemoryExcluded: boolean;
  trustedResultPreferred: boolean | null;
}

async function main(): Promise<void> {
  process.env.OPENAI_API_KEY = "";
  const dataDir = await mkdtemp(path.join(tmpdir(), "memfs-retrieval-benchmark-"));
  const memoryfs = new MemoryFS({
    dataDir,
    memory: {
      useLlm: false
    }
  });

  try {
    await memoryfs.initialize();
    const workspace = memoryfs.createWorkspace("retrieval-benchmark");
    const index = await seedFixture(memoryfs, workspace.id);
    const metrics: QueryMetrics[] = [];

    for (const query of benchmarkQueries) {
      const results = await retrieve(memoryfs, workspace.id, query);
      metrics.push(scoreQuery(query, results, index));
    }

    printReport(metrics);
    if (metrics.some((metric) => !metric.top3Hit || !metric.sourceReferencePresent || !metric.staleMemoryExcluded || metric.trustedResultPreferred === false)) {
      process.exitCode = 1;
    }
  } finally {
    memoryfs.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function seedFixture(memoryfs: MemoryFS, workspaceId: string): Promise<SeedIndex> {
  const index: SeedIndex = new Map();

  for (const file of fixtureFiles) {
    await memoryfs.writeFile(workspaceId, file.path, file.content, {
      actor: "benchmark:seed",
      ingest: true,
      allow_protected_write: Boolean(file.allowProtected)
    });
    const node = latestNodeForPath(memoryfs, workspaceId, file.path);
    index.set(file.label, { path: file.path, nodeId: node?.id });
    if (file.stale && node) {
      memoryfs.markMemoryStale(workspaceId, node.id, {
        actor: "benchmark:seed",
        reason: file.stale
      });
    }
  }

  const oldAuthNode = nodeForLabel(memoryfs, workspaceId, index, "oldAuthDecision");
  const currentAuthNode = nodeForLabel(memoryfs, workspaceId, index, "authDecision");
  if (oldAuthNode && currentAuthNode) {
    memoryfs.supersedeMemory(workspaceId, oldAuthNode.id, currentAuthNode.id, {
      actor: "benchmark:seed",
      reason: "Server-side refresh token storage replaced the alpha localStorage decision."
    });
  }

  for (const runFixture of fixtureRuns) {
    const run = await memoryfs.createRun(workspaceId, {
      task: runFixture.task,
      title: runFixture.title,
      actor: "benchmark:run"
    });
    await memoryfs.completeRun(workspaceId, run.id, {
      result: runFixture.result,
      errors: runFixture.errors,
      followups: runFixture.followups,
      actor: "benchmark:run",
      failed: Boolean(runFixture.errors && /failed|error/i.test(runFixture.errors))
    });
    if (runFixture.compileReasoning) {
      await memoryfs.compileRun(workspaceId, run.id, {
        actor: "benchmark:run",
        reasoning: true
      });
    }
    if (runFixture.handoffProject) {
      const handoff = await memoryfs.createHandoff(workspaceId, {
        run_id: run.id,
        project_hint: runFixture.handoffProject,
        actor: "benchmark:run"
      });
      index.set("supabaseHandoff", { path: handoff.path, nodeId: handoff.node?.id });
    }

    if (runFixture.label === "supabase") {
      index.set("supabaseRunError", { path: `${run.run_path}/errors.md`, nodeId: latestNodeForPath(memoryfs, workspaceId, `${run.run_path}/errors.md`)?.id });
    }
    if (runFixture.label === "largeUpload") {
      index.set("largeUploadRunError", { path: `${run.run_path}/errors.md`, nodeId: latestNodeForPath(memoryfs, workspaceId, `${run.run_path}/errors.md`)?.id });
      index.set("largeUploadCandidate", {
        path: `${run.run_path}/candidates.md`,
        nodeId: latestNodeForPath(memoryfs, workspaceId, `${run.run_path}/candidates.md`)?.id
      });
      index.set("largeUploadReasoning", {
        path: `${run.run_path}/reasoning-memories.json`,
        nodeId: latestNodeForPath(memoryfs, workspaceId, `${run.run_path}/reasoning-memories.json`)?.id
      });
    }
    if (runFixture.label === "onboarding") {
      index.set("onboardingFailure", { path: `${run.run_path}/errors.md`, nodeId: latestNodeForPath(memoryfs, workspaceId, `${run.run_path}/errors.md`)?.id });
    }
  }

  for (const archive of fixtureArchives) {
    const entry = await memoryfs.archive.importText(workspaceId, {
      archive_type: archive.archive_type,
      title: archive.title,
      content: archive.content,
      actor: "benchmark:archive"
    });
    index.set(archive.label, { path: entry.path });
  }

  return index;
}

async function retrieve(memoryfs: MemoryFS, workspaceId: string, query: BenchmarkQuery): Promise<BenchmarkResultItem[]> {
  if (query.mode === "brief") {
    const brief = await memoryfs.createBrief(workspaceId, {
      task: query.query,
      project_slug: query.projectSlug,
      project_hint: query.projectSlug,
      files: query.files,
      include_candidates: true,
      limit: query.limit ?? 12,
      actor: "benchmark:brief"
    });
    return briefResults(brief);
  }

  const grep = await memoryfs.grepMemory(workspaceId, query.query, {
    mode: "hybrid",
    project_slug: query.projectSlug,
    project_hint: query.projectSlug,
    include_runs: true,
    include_sources: true,
    include_stale: false,
    limit: query.limit ?? 10
  });
  return grep.results.map(fromGrepResult);
}

function scoreQuery(query: BenchmarkQuery, results: BenchmarkResultItem[], index: SeedIndex): QueryMetrics {
  const expected = resolveExpected(query.expected, index);
  const absent = resolveExpected(query.absent ?? [], index);
  const top3 = results.slice(0, 3);
  const topResult = results[0] ?? null;
  const top1Hit = topResult ? matchesAny(topResult, expected) : false;
  const top3Hit = top3.some((result) => matchesAny(result, expected));
  const sourceReferencePresent = Boolean(topResult?.source_path && (topResult.raw_ref || topResult.node_id));
  const staleMemoryExcluded = !results.some((result) => matchesAny(result, absent) || result.status === "stale" || result.status === "superseded");
  const trustedResultPreferred = query.trustedPreferred
    ? Boolean(topResult && trustRank(topResult.trust) >= trustRank("source_backed"))
    : null;

  return {
    query,
    resultCount: results.length,
    topResult,
    top1Hit,
    top3Hit,
    sourceReferencePresent,
    staleMemoryExcluded,
    trustedResultPreferred
  };
}

function briefResults(brief: BriefResponse): BenchmarkResultItem[] {
  return brief.memory_results.map(fromRecallResult);
}

function fromRecallResult(result: RecallResult): BenchmarkResultItem {
  return {
    source_path: result.source_path,
    node_id: result.node_id,
    raw_ref: result.raw_ref,
    score: result.score,
    trust: result.trust_level ?? null,
    status: result.status ?? null,
    summary: result.summary
  };
}

function fromGrepResult(result: MemoryGrepResult): BenchmarkResultItem {
  return {
    source_path: result.source_path,
    node_id: result.node_id,
    raw_ref: result.raw_ref,
    score: result.score,
    trust: result.trust,
    status: null,
    summary: result.snippet
  };
}

function latestNodeForPath(memoryfs: MemoryFS, workspaceId: string, sourcePath: string): MemoryNode | null {
  return memoryfs.listMemoryNodes(workspaceId).find((node) => node.source_path === sourcePath) ?? null;
}

function nodeForLabel(memoryfs: MemoryFS, workspaceId: string, index: SeedIndex, label: FixtureLabel): MemoryNode | null {
  const nodeId = index.get(label)?.nodeId;
  return nodeId ? memoryfs.getMemoryNode(workspaceId, nodeId) : null;
}

function resolveExpected(labels: FixtureLabel[], index: SeedIndex): Array<{ path?: string; nodeId?: string }> {
  return labels.map((label) => index.get(label)).filter((entry): entry is { path?: string; nodeId?: string } => Boolean(entry));
}

function matchesAny(result: BenchmarkResultItem, expected: Array<{ path?: string; nodeId?: string }>): boolean {
  return expected.some((entry) => {
    if (entry.nodeId && result.node_id === entry.nodeId) return true;
    if (entry.path && result.source_path === entry.path) return true;
    return false;
  });
}

function trustRank(trust: MemoryTrustLevel | null): number {
  switch (trust) {
    case "trusted":
      return 5;
    case "reviewed":
      return 4;
    case "source_backed":
      return 3;
    case "agent_generated":
      return 2;
    case "ephemeral":
      return 1;
    case "superseded":
    case "rejected":
    case null:
      return 0;
  }
}

function printReport(metrics: QueryMetrics[]): void {
  console.log("MemFS retrieval benchmark");
  console.log("Dataset: project facts, decisions, constraints, runs, handoffs, reasoning memories, stale/superseded memory, archive transcripts");
  console.log("");
  const rows = [
    ["query", "mode", "top1", "top3", "source", "stale", "trusted", "top result"],
    ...metrics.map((metric) => [
      metric.query.query,
      metric.query.mode,
      mark(metric.top1Hit),
      mark(metric.top3Hit),
      mark(metric.sourceReferencePresent),
      mark(metric.staleMemoryExcluded),
      metric.trustedResultPreferred === null ? "NA" : mark(metric.trustedResultPreferred),
      metric.topResult ? `${metric.topResult.source_path} (${metric.topResult.trust ?? "unknown"}, ${metric.topResult.score.toFixed(3)})` : "(none)"
    ])
  ];
  printTable(rows);
  console.log("");
  console.log(`Summary: top-1 ${count(metrics, "top1Hit")}/${metrics.length}, top-3 ${count(metrics, "top3Hit")}/${metrics.length}, source refs ${count(metrics, "sourceReferencePresent")}/${metrics.length}, stale excluded ${count(metrics, "staleMemoryExcluded")}/${metrics.length}, trusted preferred ${countTrusted(metrics)}/${metrics.filter((metric) => metric.trustedResultPreferred !== null).length}`);
  console.log("");
  console.log("Limitations:");
  for (const limitation of benchmarkLimitations) {
    console.log(`- ${limitation}`);
  }
}

function printTable(rows: string[][]): void {
  const widths = rows[0]!.map((_, index) => Math.min(58, Math.max(...rows.map((row) => row[index]!.length))));
  for (const [rowIndex, row] of rows.entries()) {
    const line = row.map((cell, index) => truncate(cell, widths[index]!).padEnd(widths[index]!)).join("  ");
    console.log(line);
    if (rowIndex === 0) {
      console.log(widths.map((width) => "-".repeat(width)).join("  "));
    }
  }
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(0, width - 3))}...`;
}

function mark(value: boolean): string {
  return value ? "PASS" : "FAIL";
}

function count(metrics: QueryMetrics[], key: keyof Pick<QueryMetrics, "top1Hit" | "top3Hit" | "sourceReferencePresent" | "staleMemoryExcluded">): number {
  return metrics.filter((metric) => metric[key]).length;
}

function countTrusted(metrics: QueryMetrics[]): number {
  return metrics.filter((metric) => metric.trustedResultPreferred === true).length;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
