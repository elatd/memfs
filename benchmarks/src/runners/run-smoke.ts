import { fileURLToPath } from "node:url";
import { MemFSAdapter } from "../adapters/memfs-adapter.js";
import { NoMemoryAdapter } from "../adapters/no-memory-adapter.js";
import { runSmokeSuite } from "./smoke-suite.js";

const resultsJsonPath = fileURLToPath(new URL("../../results/smoke-results.json", import.meta.url));
const reportMarkdownPath = fileURLToPath(new URL("../../results/smoke-report.md", import.meta.url));

const result = await runSmokeSuite({
  benchmarkName: "memfs-smoke",
  adapters: [new NoMemoryAdapter(), new MemFSAdapter()],
  resultsJsonPath,
  reportMarkdownPath
});

for (const adapter of result.adapters) {
  console.log(
    `${adapter.adapter}: recall@k=${format(adapter.scores.recall_at_k)} source_refs=${format(
      adapter.scores.source_ref_accuracy
    )} keywords=${format(adapter.scores.keyword_match_accuracy)} abstention=${format(
      adapter.scores.abstention_accuracy
    )}`
  );
}

function format(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
