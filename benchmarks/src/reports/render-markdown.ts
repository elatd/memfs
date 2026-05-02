import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SmokeBenchmarkResult } from "./types.js";

export async function renderMarkdown(path: string, result: SmokeBenchmarkResult): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, toMarkdown(result), "utf8");
}

function toMarkdown(result: SmokeBenchmarkResult): string {
  const lines = [
    "# VeriFS Smoke Benchmark Report",
    "",
    `Generated: ${result.generated_at}`,
    "",
    `Dataset: \`${result.dataset.path}\` (${result.dataset.cases} cases)`,
    "",
    "## Summary",
    "",
    [
      "| Adapter | Cases | Recall@k | Source Ref Accuracy | Keyword Match | Abstention | Avg Latency | Avg Context Tokens |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    ].join("\n")
  ];

  for (const adapter of result.adapters) {
    lines.push(
      `| ${adapter.adapter} | ${adapter.scores.cases} | ${pct(adapter.scores.recall_at_k)} | ${pct(
        adapter.scores.source_ref_accuracy
      )} | ${pct(adapter.scores.keyword_match_accuracy)} | ${pct(
        adapter.scores.abstention_accuracy
      )} | ${adapter.scores.avg_latency_ms.toFixed(2)}ms | ${adapter.scores.avg_context_tokens.toFixed(0)} |`
    );
  }

  for (const adapter of result.adapters) {
    lines.push("", `## ${adapter.adapter} Trace`, "");
    lines.push(
      "| Case | Recall@k | Source Ref | Keywords | Abstention | Retrieved Sources |",
      "| --- | ---: | ---: | ---: | ---: | --- |"
    );

    for (const trace of adapter.traces) {
      const retrievedSources =
        trace.retrieved.map((item) => item.sourceId ?? "unknown").join(", ") || "none";
      lines.push(
        `| ${trace.caseId} | ${pct(trace.scores.recallAtK)} | ${pct(
          trace.scores.sourceRefAccuracy
        )} | ${pct(trace.scores.keywordMatchAccuracy)} | ${pct(
          trace.scores.abstentionAccuracy
        )} | ${escapeTable(retrievedSources)} |`
      );
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|");
}
