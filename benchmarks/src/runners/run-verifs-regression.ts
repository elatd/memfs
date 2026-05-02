import { fileURLToPath } from "node:url";
import { VeriFSAdapter } from "../adapters/verifs-adapter.js";
import { runSmokeSuite } from "./smoke-suite.js";

const resultsJsonPath = fileURLToPath(
  new URL("../../results/verifs-regression-results.json", import.meta.url)
);
const reportMarkdownPath = fileURLToPath(
  new URL("../../results/verifs-regression-report.md", import.meta.url)
);

const result = await runSmokeSuite({
  benchmarkName: "verifs-regression",
  adapters: [new VeriFSAdapter()],
  resultsJsonPath,
  reportMarkdownPath
});

const [adapter] = result.adapters;

if (!adapter) {
  throw new Error("VeriFS regression did not produce an adapter result.");
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
