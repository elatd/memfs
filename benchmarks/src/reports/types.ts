import type { MemoryMetadata, MemoryRetrievedItem } from "../adapters/memory-system-adapter.js";

interface SmokeBenchmarkSource {
  sourceId: string;
  text: string;
  metadata?: MemoryMetadata;
}

export interface SmokeBenchmarkCase {
  id: string;
  description?: string;
  sources: SmokeBenchmarkSource[];
  question: string;
  expected_answer_keywords: string[];
  expected_source_ids: string[];
  should_abstain: boolean;
}

export interface SmokeCaseTrace {
  caseId: string;
  description?: string;
  question: string;
  expectedAnswerKeywords: string[];
  expectedSourceIds: string[];
  shouldAbstain: boolean;
  answer: string;
  retrieved: MemoryRetrievedItem[];
  latencyMs: number;
  contextTokenEstimate: number;
  scores: {
    recallAtK: number;
    sourceRefAccuracy: number;
    keywordMatchAccuracy: number;
    abstentionAccuracy: number;
  };
  details: {
    matchedKeywords: string[];
    missingKeywords: string[];
    missingSourceIds: string[];
    unexpectedSourceIds: string[];
    abstained: boolean;
  };
}

export interface AdapterBenchmarkResult {
  adapter: string;
  scores: {
    cases: number;
    recall_at_k: number;
    source_ref_accuracy: number;
    keyword_match_accuracy: number;
    abstention_accuracy: number;
    avg_latency_ms: number;
    avg_context_tokens: number;
  };
  traces: SmokeCaseTrace[];
}

export interface SmokeBenchmarkResult {
  benchmark: string;
  generated_at: string;
  dataset: {
    path: string;
    cases: number;
  };
  adapters: AdapterBenchmarkResult[];
}
