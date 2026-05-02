import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type {
  MemoryRetrievedItem,
  MemorySystemAdapter
} from "../adapters/memory-system-adapter.js";
import { gradeAbstention } from "../graders/abstention-grader.js";
import { gradeKeywordMatch } from "../graders/exact-match.js";
import { gradeRecallAtK, gradeSourceRefs } from "../graders/source-ref-grader.js";
import { renderJson } from "../reports/render-json.js";
import { renderMarkdown } from "../reports/render-markdown.js";
import type {
  AdapterBenchmarkResult,
  SmokeBenchmarkCase,
  SmokeBenchmarkResult,
  SmokeCaseTrace
} from "../reports/types.js";

export interface SmokeSuiteOptions {
  benchmarkName: string;
  adapters: MemorySystemAdapter[];
  resultsJsonPath: string;
  reportMarkdownPath: string;
  datasetPath?: string;
  k?: number;
}

const DEFAULT_DATASET_PATH = fileURLToPath(
  new URL("../../datasets/memfs-smoke/samples.jsonl", import.meta.url)
);

export async function runSmokeSuite(options: SmokeSuiteOptions): Promise<SmokeBenchmarkResult> {
  const datasetPath = options.datasetPath ?? DEFAULT_DATASET_PATH;
  const cases = await loadJsonl<SmokeBenchmarkCase>(datasetPath);
  const adapters: AdapterBenchmarkResult[] = [];

  for (const adapter of options.adapters) {
    adapters.push(await runAdapter(adapter, cases, options.k ?? 5));
  }

  const result: SmokeBenchmarkResult = {
    benchmark: options.benchmarkName,
    generated_at: new Date().toISOString(),
    dataset: {
      path: displayPath(datasetPath),
      cases: cases.length
    },
    adapters
  };

  await renderJson(options.resultsJsonPath, result);
  await renderMarkdown(options.reportMarkdownPath, result);

  return result;
}

async function runAdapter(
  adapter: MemorySystemAdapter,
  cases: SmokeBenchmarkCase[],
  k: number
): Promise<AdapterBenchmarkResult> {
  const traces: SmokeCaseTrace[] = [];

  try {
    for (const benchmarkCase of cases) {
      await adapter.reset();

      for (const source of benchmarkCase.sources) {
        await adapter.ingest(source);
      }

      const start = performance.now();
      const retrieved = await adapter.retrieve({
        text: benchmarkCase.question,
        k
      });
      const latencyMs = performance.now() - start;
      const answer = await generateAnswer(adapter, benchmarkCase.question, retrieved);
      const keywordGrade = gradeKeywordMatch(answer, benchmarkCase.expected_answer_keywords);
      const sourceGrade = gradeSourceRefs(retrieved, benchmarkCase.expected_source_ids);
      const abstentionGrade = gradeAbstention({
        answer,
        retrievedCount: retrieved.length,
        shouldAbstain: benchmarkCase.should_abstain
      });

      traces.push({
        caseId: benchmarkCase.id,
        description: benchmarkCase.description,
        question: benchmarkCase.question,
        expectedAnswerKeywords: benchmarkCase.expected_answer_keywords,
        expectedSourceIds: benchmarkCase.expected_source_ids,
        shouldAbstain: benchmarkCase.should_abstain,
        answer,
        retrieved,
        latencyMs,
        contextTokenEstimate: estimateTokens(retrieved.map((item) => item.text).join("\n")),
        scores: {
          recallAtK: gradeRecallAtK(retrieved, benchmarkCase.expected_source_ids),
          sourceRefAccuracy: sourceGrade.score,
          keywordMatchAccuracy: keywordGrade.score,
          abstentionAccuracy: abstentionGrade.score
        },
        details: {
          matchedKeywords: keywordGrade.matched,
          missingKeywords: keywordGrade.missing,
          missingSourceIds: sourceGrade.missingSourceIds,
          unexpectedSourceIds: sourceGrade.unexpectedSourceIds,
          abstained: abstentionGrade.abstained
        }
      });
    }
  } finally {
    await adapter.close?.();
  }

  return {
    adapter: adapter.name,
    scores: {
      cases: traces.length,
      recall_at_k: mean(traces.map((trace) => trace.scores.recallAtK)),
      source_ref_accuracy: mean(traces.map((trace) => trace.scores.sourceRefAccuracy)),
      keyword_match_accuracy: mean(traces.map((trace) => trace.scores.keywordMatchAccuracy)),
      abstention_accuracy: mean(traces.map((trace) => trace.scores.abstentionAccuracy)),
      avg_latency_ms: mean(traces.map((trace) => trace.latencyMs)),
      avg_context_tokens: mean(traces.map((trace) => trace.contextTokenEstimate))
    },
    traces
  };
}

async function generateAnswer(
  adapter: MemorySystemAdapter,
  question: string,
  retrieved: MemoryRetrievedItem[]
): Promise<string> {
  if (adapter.generateAnswer) {
    return adapter.generateAnswer({
      question,
      retrieved
    });
  }

  if (retrieved.length === 0) {
    return "I do not have enough memory to answer from the available sources.";
  }

  return retrieved.map((item) => `[${item.sourceId ?? "unknown"}] ${item.text}`).join("\n");
}

async function loadJsonl<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf8");

  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function displayPath(absolutePath: string): string {
  const relativePath = path.relative(process.cwd(), absolutePath);
  return relativePath.startsWith("..") ? absolutePath : relativePath;
}

function estimateTokens(text: string): number {
  if (text.trim().length === 0) {
    return 0;
  }

  return Math.ceil(text.length / 4);
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
