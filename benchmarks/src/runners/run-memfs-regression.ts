import { fileURLToPath } from "node:url";
import { MemFSAdapter } from "../adapters/memfs-adapter.js";
import { runSmokeSuite } from "./smoke-suite.js";

const resultsJsonPath = fileURLToPath(
  new URL("../../results/memfs-regression-results.json", import.meta.url)
);
const reportMarkdownPath = fileURLToPath(
  new URL("../../results/memfs-regression-report.md", import.meta.url)
);

const result = await runSmokeSuite({
  benchmarkName: "memfs-regression",
  adapters: [new MemFSAdapter()],
  resultsJsonPath,
  reportMarkdownPath
});

const [adapter] = result.adapters;

if (!adapter) {
  throw new Error("MemFS regression did not produce an adapter result.");
}

console.log(
  `${adapter.adapter}: recall@k=${format(adapter.scores.recall_at_k)} source_refs=${format(
    adapter.scores.source_ref_accuracy
  )} keywords=${format(adapter.scores.keyword_match_accuracy)} abstention=${format(
    adapter.scores.abstention_accuracy
  )}`
);

function format(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
