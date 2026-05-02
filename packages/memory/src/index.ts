import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildExtractMemoryNodesPrompt } from "./prompts/extract-memory-nodes.js";
import { buildExtractReasoningMemoriesPrompt } from "./prompts/extract-reasoning-memories.js";

export * from "./curation/index.js";

export const memoryTypes = [
  "preference",
  "decision",
  "constraint",
  "fact",
  "task",
  "error",
  "research_finding",
  "unresolved_question",
  "run_summary",
  "reasoning_memory",
  "other"
] as const;

export type MemoryType = (typeof memoryTypes)[number];

export const recallModes = [
  "general",
  "task_preparation",
  "fact_lookup",
  "debugging",
  "handoff",
  "research",
  "decision_review"
] as const;

export type RecallMode = (typeof recallModes)[number];

export interface ExtractedMemoryNode {
  summary: string;
  trigger: string;
  detail: string;
  raw_excerpt: string;
  tags: string[];
  memory_type: MemoryType;
  importance: 1 | 2 | 3 | 4 | 5;
  confidence: number;
}

export interface ExtractedReasoningMemory {
  type: "reasoning_memory";
  title: string;
  trigger: string;
  context: string;
  strategy: string;
  failure_pattern: string;
  success_pattern: string;
  applies_to: string[];
  preconditions: string[];
  anti_patterns: string[];
  source_run: string;
  source_refs: string[];
  confidence: number;
  status: "candidate";
  reason: string;
}

export interface ReasoningMemoryRunInput {
  run_path: string;
  task: string;
  status: string;
  artifacts: Record<string, string>;
  options?: MemoryModelOptions;
}

export interface MemoryModelOptions {
  apiKey?: string;
  baseUrl?: string;
  chatModel?: string;
  embedModel?: string;
  useLlm?: boolean;
  useLocalEmbeddings?: boolean;
  localEmbedModel?: string;
  allowEmbeddingFallback?: boolean;
}

export interface Bm25Document {
  id: string;
  text: string;
}

export interface RankedItem {
  id: string;
  score: number;
}

export interface RrfRanking {
  items: RankedItem[];
  weight?: number;
}

export interface RecallPlannerInput {
  query: string;
  project_hint?: string;
  mode?: RecallMode;
  memory_types?: string[];
  trust_levels?: string[];
  include_detail?: boolean;
  include_raw?: boolean;
  include_why?: boolean;
  include_contradictions?: boolean;
  limit?: number;
}

export interface RecallQueryPlan {
  normalized_query: string;
  mode: RecallMode;
  topics: string[];
  project_hint?: string;
  memory_types: string[];
  needs_recent_runs: boolean;
  needs_contradictions: boolean;
  needs_raw: boolean;
  retrieval_strategy: {
    trigger_weight: number;
    summary_weight: number;
    keyword_weight: number;
    detail_weight: number;
    importance_weight: number;
    recency_weight: number;
    path_project_weight: number;
    graph_weight: number;
  };
}

const durablePattern =
  /\b(prefer|prefers|preference|decision|decided|must|constraint|never|avoid|required|requires|error|failed|failure|todo|task|open question|unresolved|tbd|research|finding|remember|important|onboarding|profile)\b/i;

const stopWords = new Set([
  "about",
  "above",
  "after",
  "again",
  "agent",
  "also",
  "and",
  "before",
  "below",
  "between",
  "content",
  "could",
  "every",
  "files",
  "for",
  "from",
  "have",
  "into",
  "is",
  "just",
  "local",
  "markdown",
  "memory",
  "more",
  "must",
  "need",
  "only",
  "project",
  "should",
  "source",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "through",
  "using",
  "user",
  "when",
  "who",
  "with",
  "work"
]);

export function planRecallQuery(input: RecallPlannerInput): RecallQueryPlan {
  const normalizedQuery = input.query.trim().replace(/\s+/g, " ");
  const lower = normalizedQuery.toLowerCase();
  const mode = input.mode ?? inferRecallMode(lower);
  const topics = inferTopics(normalizedQuery, input.project_hint);
  const memoryTypes = input.memory_types?.length
    ? input.memory_types
    : defaultMemoryTypesForMode(mode);
  const needsRecentRuns =
    mode === "debugging" ||
    mode === "handoff" ||
    /\b(recent|latest|last run|what happened|status|handoff|summary)\b/i.test(lower);
  const needsContradictions =
    Boolean(input.include_contradictions) ||
    mode === "decision_review" ||
    /\b(conflict|contradict|contradiction|superseded|changed|still true|outdated)\b/i.test(lower);
  const needsRaw = Boolean(input.include_raw) || /\b(raw|source text|exact source|quote|verbatim)\b/i.test(lower);

  return {
    normalized_query: normalizedQuery,
    mode,
    topics,
    project_hint: input.project_hint,
    memory_types: memoryTypes,
    needs_recent_runs: needsRecentRuns,
    needs_contradictions: needsContradictions,
    needs_raw: needsRaw,
    retrieval_strategy: strategyForMode(mode)
  };
}

function inferRecallMode(lowerQuery: string): RecallMode {
  if (/\b(before|prior to|prep|prepare|remember before)\b/.test(lowerQuery)) return "task_preparation";
  if (/\b(what did we decide|decision|decided|why did we choose|review decision)\b/.test(lowerQuery)) {
    return "decision_review";
  }
  if (/\b(why did this fail|fail|failed|bug|debug|error|regression|broken)\b/.test(lowerQuery)) return "debugging";
  if (/\b(summarize what matters|handoff|brief me|summary for|catch me up)\b/.test(lowerQuery)) return "handoff";
  if (/\b(find source|source for|where did|exact source|fact|lookup)\b/.test(lowerQuery)) return "fact_lookup";
  if (/\b(research|finding|competitor|evidence)\b/.test(lowerQuery)) return "research";
  return "general";
}

function inferTopics(query: string, projectHint?: string): string[] {
  const tokens = tokenize(query)
    .filter((token) => !stopWords.has(token))
    .slice(0, 8);
  return unique(projectHint ? [projectHint.toLowerCase(), ...tokens] : tokens);
}

function defaultMemoryTypesForMode(mode: RecallMode): string[] {
  switch (mode) {
    case "task_preparation":
      return ["decision", "constraint", "preference", "task", "error", "run_summary", "reasoning_memory"];
    case "fact_lookup":
      return ["fact", "research_finding", "decision", "constraint"];
    case "debugging":
      return ["error", "run_summary", "constraint", "decision", "task", "reasoning_memory"];
    case "handoff":
      return ["run_summary", "decision", "task", "unresolved_question", "constraint"];
    case "research":
      return ["research_finding", "fact", "unresolved_question", "decision"];
    case "decision_review":
      return ["decision", "constraint", "unresolved_question", "run_summary"];
    default:
      return [...memoryTypes];
  }
}

function strategyForMode(mode: RecallMode): RecallQueryPlan["retrieval_strategy"] {
  const base = {
    trigger_weight: 0.35,
    summary_weight: 0.23,
    keyword_weight: 0.14,
    detail_weight: 0.08,
    importance_weight: 0.08,
    recency_weight: 0.05,
    path_project_weight: 0.04,
    graph_weight: 0.03
  };

  switch (mode) {
    case "task_preparation":
      return { ...base, trigger_weight: 0.4, importance_weight: 0.1, graph_weight: 0.05, summary_weight: 0.2 };
    case "fact_lookup":
      return { ...base, summary_weight: 0.28, keyword_weight: 0.18, detail_weight: 0.1, trigger_weight: 0.26 };
    case "debugging":
      return { ...base, keyword_weight: 0.17, detail_weight: 0.12, recency_weight: 0.1, trigger_weight: 0.28 };
    case "handoff":
      return { ...base, recency_weight: 0.12, importance_weight: 0.11, summary_weight: 0.24, trigger_weight: 0.26 };
    case "research":
      return { ...base, summary_weight: 0.27, keyword_weight: 0.17, detail_weight: 0.12, trigger_weight: 0.26 };
    case "decision_review":
      return { ...base, trigger_weight: 0.32, summary_weight: 0.25, importance_weight: 0.12, graph_weight: 0.06 };
    default:
      return base;
  }
}

export function chunkMarkdown(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^#{1,6}\s+\S/.test(line) && current.length > 0) {
      sections.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    sections.push(current.join("\n").trim());
  }

  return sections.flatMap(splitLongChunk).filter(Boolean);
}

function splitLongChunk(chunk: string): string[] {
  if (chunk.length <= 4000) {
    return [chunk];
  }

  const paragraphs = chunk.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > 4000 && current) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export async function extractMemoryNodesFromContent(input: {
  content: string;
  path: string;
  options?: MemoryModelOptions;
}): Promise<ExtractedMemoryNode[]> {
  const options = input.options ?? {};
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;

  if (options.useLlm !== false && apiKey) {
    try {
      const prompt = buildExtractMemoryNodesPrompt(input);
      const content = await requestChatCompletion(prompt, {
        ...options,
        apiKey
      });
      return validateExtractedNodesJson(content, input.content);
    } catch {
      return fallbackExtractMemoryNodes(input.content, input.path);
    }
  }

  return fallbackExtractMemoryNodes(input.content, input.path);
}

export function validateExtractedNodesJson(jsonText: string, sourceContent?: string): ExtractedMemoryNode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Memory extraction did not return valid JSON: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Memory extraction JSON must be an array.");
  }

  return parsed.map((item, index) => validateExtractedNode(item, index, sourceContent));
}

export async function extractReasoningMemoriesFromRun(input: ReasoningMemoryRunInput): Promise<ExtractedReasoningMemory[]> {
  const options = input.options ?? {};
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const sourceContent = reasoningSourceContent(input);

  if (options.useLlm !== false && apiKey) {
    try {
      const prompt = buildExtractReasoningMemoriesPrompt(input);
      const content = await requestChatCompletion(prompt, {
        ...options,
        apiKey
      });
      return validateReasoningMemoriesJson(content, sourceContent, input.run_path);
    } catch {
      return fallbackExtractReasoningMemories(input);
    }
  }

  return fallbackExtractReasoningMemories(input);
}

export function validateReasoningMemoriesJson(
  jsonText: string,
  sourceContent?: string,
  sourceRun?: string
): ExtractedReasoningMemory[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Reasoning memory extraction did not return valid JSON: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Reasoning memory JSON must be an array.");
  }

  return parsed.map((item, index) => validateReasoningMemory(item, index, sourceContent, sourceRun));
}

export function validateReasoningMemory(
  item: unknown,
  index = 0,
  sourceContent?: string,
  sourceRun?: string
): ExtractedReasoningMemory {
  if (!item || typeof item !== "object") {
    throw new Error(`Reasoning memory at index ${index} must be an object.`);
  }

  const candidate = item as Record<string, unknown>;
  if (candidate.type !== "reasoning_memory") {
    throw new Error(`Reasoning memory at index ${index} type must be reasoning_memory.`);
  }
  if (candidate.status !== "candidate") {
    throw new Error(`Reasoning memory at index ${index} status must be candidate.`);
  }

  const title = requiredString(candidate.title, "title", index);
  const trigger = requiredString(candidate.trigger, "trigger", index);
  const context = requiredString(candidate.context, "context", index);
  const strategy = requiredString(candidate.strategy, "strategy", index);
  const failurePattern = requiredString(candidate.failure_pattern, "failure_pattern", index);
  const successPattern = requiredString(candidate.success_pattern, "success_pattern", index);
  const sourceRunValue = requiredString(candidate.source_run, "source_run", index);
  const reason = requiredString(candidate.reason, "reason", index);

  if (sourceRun && sourceRunValue !== sourceRun) {
    throw new Error(`Reasoning memory at index ${index} source_run must be ${sourceRun}.`);
  }

  const appliesTo = requiredStringArray(candidate.applies_to, "applies_to", index);
  const preconditions = requiredStringArray(candidate.preconditions, "preconditions", index);
  const antiPatterns = requiredStringArray(candidate.anti_patterns, "anti_patterns", index);
  const sourceRefs = requiredStringArray(candidate.source_refs, "source_refs", index);

  if (sourceRefs.length === 0 || !sourceRefs.every((ref) => ref.startsWith(sourceRunValue))) {
    throw new Error(`Reasoning memory at index ${index} source_refs must point inside source_run.`);
  }

  if (typeof candidate.confidence !== "number" || candidate.confidence < 0 || candidate.confidence > 1) {
    throw new Error(`Reasoning memory at index ${index} confidence must be a number from 0 to 1.`);
  }

  if (sourceContent) {
    const support = [title, trigger, context, strategy, failurePattern, successPattern, reason].some((field) =>
      sourceContent.toLowerCase().includes(field.toLowerCase().slice(0, Math.min(field.length, 80)))
    );
    if (!support) {
      throw new Error(`Reasoning memory at index ${index} must be grounded in the run artifacts.`);
    }
  }

  return {
    type: "reasoning_memory",
    title,
    trigger,
    context,
    strategy,
    failure_pattern: failurePattern,
    success_pattern: successPattern,
    applies_to: appliesTo,
    preconditions,
    anti_patterns: antiPatterns,
    source_run: sourceRunValue,
    source_refs: sourceRefs,
    confidence: candidate.confidence,
    status: "candidate",
    reason
  };
}

export function validateExtractedNode(
  item: unknown,
  index = 0,
  sourceContent?: string
): ExtractedMemoryNode {
  if (!item || typeof item !== "object") {
    throw new Error(`Memory node at index ${index} must be an object.`);
  }

  const candidate = item as Record<string, unknown>;
  const summary = requiredString(candidate.summary, "summary", index);
  const trigger = requiredString(candidate.trigger, "trigger", index);
  const detail = requiredString(candidate.detail, "detail", index);
  const rawExcerpt = requiredString(candidate.raw_excerpt, "raw_excerpt", index);
  const memoryType = requiredString(candidate.memory_type, "memory_type", index) as MemoryType;

  if (!trigger.startsWith("Recall when")) {
    throw new Error(`Memory node at index ${index} trigger must begin with "Recall when".`);
  }

  if (!memoryTypes.includes(memoryType)) {
    throw new Error(`Memory node at index ${index} has invalid memory_type.`);
  }

  if (!Array.isArray(candidate.tags)) {
    throw new Error(`Memory node at index ${index} tags must be an array.`);
  }

  const tags = candidate.tags.map((tag, tagIndex) => {
    if (typeof tag !== "string" || !tag.trim()) {
      throw new Error(`Memory node at index ${index} tag ${tagIndex} must be a non-empty string.`);
    }
    return tag.trim().toLowerCase();
  });

  if (tags.length < 3 || tags.length > 8) {
    throw new Error(`Memory node at index ${index} tags must contain 3 to 8 values.`);
  }

  const importance = candidate.importance;
  if (typeof importance !== "number" || !Number.isInteger(importance) || importance < 1 || importance > 5) {
    throw new Error(`Memory node at index ${index} importance must be an integer from 1 to 5.`);
  }

  if (typeof candidate.confidence !== "number" || candidate.confidence < 0 || candidate.confidence > 1) {
    throw new Error(`Memory node at index ${index} confidence must be a number from 0 to 1.`);
  }

  if (sourceContent && rawExcerpt && !sourceContent.includes(rawExcerpt)) {
    throw new Error(`Memory node at index ${index} raw_excerpt must be an exact source excerpt.`);
  }

  return {
    summary,
    trigger,
    detail,
    raw_excerpt: rawExcerpt,
    tags,
    memory_type: memoryType,
    importance: importance as 1 | 2 | 3 | 4 | 5,
    confidence: candidate.confidence
  };
}

function requiredString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Memory node at index ${index} ${field} must be a non-empty string.`);
  }

  return value.trim();
}

function requiredStringArray(value: unknown, field: string, index: number): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Reasoning memory at index ${index} ${field} must be an array.`);
  }
  const items = value.map((item, itemIndex) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Reasoning memory at index ${index} ${field}[${itemIndex}] must be a non-empty string.`);
    }
    return item.trim();
  });
  if (items.length > 12) {
    throw new Error(`Reasoning memory at index ${index} ${field} must contain at most 12 values.`);
  }
  return unique(items);
}

export function fallbackExtractMemoryNodes(content: string, path: string): ExtractedMemoryNode[] {
  return chunkMarkdown(content)
    .map((chunk) => fallbackNodeForChunk(chunk, path))
    .filter((node): node is ExtractedMemoryNode => Boolean(node));
}

export function fallbackExtractReasoningMemories(input: ReasoningMemoryRunInput): ExtractedReasoningMemory[] {
  const combined = reasoningSourceContent(input);
  if (!combined.trim()) return [];

  const lower = combined.toLowerCase();
  const hasFailure = /\b(error|failed|failure|timeout|regression|bug|blocked|invalid|exception)\b/.test(lower);
  const hasSuccess = /\b(fixed|resolved|succeeded|success|passed|avoided|worked|solution|strategy|use|used)\b/.test(lower);
  const hasLesson = /\b(lesson|learned|next time|avoid|instead|strategy|pattern|use|prefer|direct|retry)\b/.test(lower);
  if (!hasFailure && !hasSuccess && !hasLesson) return [];

  const resultText = input.artifacts["result.md"] || combined;
  const errorText = input.artifacts["errors.md"] || combined;
  const followupText = input.artifacts["followups.md"] || "";
  const sourceRefs = reasoningSourceRefs(input);
  const title = reasoningTitle(resultText, errorText, input.task);
  const failurePattern = firstMatchingSentence(errorText, /\b(error|failed|failure|timeout|regression|bug|blocked|invalid|exception)\b/i)
    ?? (hasFailure ? shortestUsefulExcerpt(errorText || combined) : "The run exposed a task pattern that can fail without the right strategy.");
  const successPattern = firstMatchingSentence(resultText, /\b(fixed|resolved|succeeded|success|passed|avoided|worked|solution|strategy|use|used)\b/i)
    ?? firstMatchingSentence(followupText, /\b(next|follow|continue|verify|promote|review)\b/i)
    ?? (hasSuccess ? shortestUsefulExcerpt(resultText || combined) : "The run identified a reusable strategy to try before repeating the failure.");
  const strategy =
    firstMatchingSentence(resultText, /\b(use|used|choose|chosen|generate|direct|avoid|instead|strategy|solution|fix|resolved)\b/i)
    ?? firstMatchingSentence(followupText, /\b(next|follow|verify|promote|review|use|avoid)\b/i)
    ?? `Review the source run and apply the successful approach from ${input.run_path}.`;

  return [
    {
      type: "reasoning_memory",
      title,
      trigger: reasoningTrigger(input.task, failurePattern),
      context: reasoningContext(input.task, combined, input.status),
      strategy,
      failure_pattern: failurePattern,
      success_pattern: successPattern,
      applies_to: reasoningAppliesTo(combined, input.task),
      preconditions: reasoningPreconditions(combined, input.task, hasFailure),
      anti_patterns: reasoningAntiPatterns(combined, failurePattern),
      source_run: input.run_path,
      source_refs: sourceRefs,
      confidence: hasFailure && hasSuccess ? 0.82 : 0.68,
      status: "candidate",
      reason: `Derived from ${input.status} run artifacts using deterministic reasoning extraction.`
    }
  ];
}

function fallbackNodeForChunk(chunk: string, path: string): ExtractedMemoryNode | null {
  const clean = chunk.trim();
  if (clean.length < 80 && !durablePattern.test(clean)) {
    return null;
  }

  if (!durablePattern.test(clean) && clean.length < 180) {
    return null;
  }

  const memoryType = classifyMemoryType(clean, path);
  const tags = extractTags(clean, path, memoryType);
  const rawExcerpt = shortestUsefulExcerpt(clean);
  const summary = summarizeChunk(clean, memoryType);
  const trigger = `Recall when working on ${tags.slice(0, 4).join(", ")} or editing ${path}.`;
  const detail = detailForChunk(clean, path);

  return {
    summary,
    trigger,
    detail,
    raw_excerpt: rawExcerpt,
    tags,
    memory_type: memoryType,
    importance: importanceForType(memoryType),
    confidence: 0.72
  };
}

function classifyMemoryType(content: string, path: string): MemoryType {
  const text = content.toLowerCase();
  if (path.startsWith("/runs/")) return "run_summary";
  if (/\b(prefer|prefers|preference|likes|wants)\b/.test(text)) return "preference";
  if (/\b(decision|decided|choose|chosen|ship|use)\b/.test(text)) return "decision";
  if (/\b(must|constraint|never|avoid|required|requires|blocked|do not|should not)\b/.test(text)) return "constraint";
  if (/\b(error|failed|failure|bug|exception|regression)\b/.test(text)) return "error";
  if (/\b(open question|unresolved|tbd|unknown|question)\b/.test(text)) return "unresolved_question";
  if (/\b(todo|task|follow up|action item|next)\b/.test(text)) return "task";
  if (/\b(research|finding|competitor|evidence|source)\b/.test(text)) return "research_finding";
  if (/\b(is|are|was|profile|located|uses)\b/.test(text)) return "fact";
  return "other";
}

function importanceForType(memoryType: MemoryType): 1 | 2 | 3 | 4 | 5 {
  if (memoryType === "decision" || memoryType === "constraint") return 5;
  if (memoryType === "preference" || memoryType === "error") return 4;
  if (memoryType === "task" || memoryType === "unresolved_question" || memoryType === "run_summary") return 3;
  if (memoryType === "fact" || memoryType === "research_finding") return 2;
  return 1;
}

function summarizeChunk(content: string, memoryType: MemoryType): string {
  const lines = content.split(/\n+/);
  const first =
    lines
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/^#{1,6}\s+/.test(line))
      ?.replace(/^[-*]\s+/, "")
      .trim() ??
    lines
      .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").trim())
      .find((line) => line.length > 0);

  const sentence = first?.split(/(?<=[.!?])\s+/)[0] ?? content.slice(0, 180);
  const trimmed = sentence.length > 180 ? `${sentence.slice(0, 177).trim()}...` : sentence;
  const label = memoryType.replace("_", " ");
  if (trimmed.toLowerCase().startsWith(`${label}:`)) {
    return trimmed;
  }
  return `${capitalize(label)}: ${trimmed}`;
}

function detailForChunk(content: string, path: string): string {
  const lines = content
    .split(/\n+/)
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  const sentences = lines.join(" ").split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3);
  const base = sentences.length > 0 ? sentences.join(" ") : content.slice(0, 400);
  return `${base} Source path: ${path}. Raw files remain the source of truth.`;
}

function shortestUsefulExcerpt(content: string): string {
  const line = content
    .split(/\n+/)
    .map((entry) => entry.trim())
    .find((entry) => entry && !/^#{1,6}\s+/.test(entry) && !/^#{1,6}\s*$/.test(entry));
  const excerpt = line ?? content.trim();
  return excerpt.length > 260 ? excerpt.slice(0, 260).trim() : excerpt;
}

function extractTags(content: string, path: string, memoryType: MemoryType): string[] {
  const pathTags = path
    .split("/")
    .flatMap((part) => part.replace(/\.[a-z0-9]+$/i, "").split(/[^a-zA-Z0-9]+/))
    .map(normalizeToken)
    .filter(Boolean);
  const contentTags = tokenize(content).filter((token) => !stopWords.has(token));
  const tags = unique([memoryType, ...pathTags, ...contentTags]).slice(0, 8);

  for (const fallback of ["workspace", "source", "memory"]) {
    if (tags.length >= 3) break;
    tags.push(fallback);
  }

  return tags.slice(0, 8);
}

function reasoningSourceContent(input: ReasoningMemoryRunInput): string {
  return [
    `Task: ${input.task}`,
    `Status: ${input.status}`,
    input.artifacts["result.md"] ? `Result:\n${input.artifacts["result.md"]}` : "",
    input.artifacts["errors.md"] ? `Errors:\n${input.artifacts["errors.md"]}` : "",
    input.artifacts["followups.md"] ? `Followups:\n${input.artifacts["followups.md"]}` : "",
    input.artifacts["actions.md"] ? `Actions:\n${input.artifacts["actions.md"]}` : "",
    input.artifacts["memory-used.md"] ? `Memory used:\n${input.artifacts["memory-used.md"]}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function reasoningSourceRefs(input: ReasoningMemoryRunInput): string[] {
  const refs = ["prompt.md", "result.md", "errors.md", "followups.md", "actions.md", "memory-used.md"]
    .filter((name) => input.artifacts[name]?.trim())
    .map((name) => `${input.run_path}/${name}`);
  return refs.length > 0 ? refs : [`${input.run_path}/prompt.md`];
}

function reasoningTitle(resultText: string, errorText: string, task: string): string {
  const source =
    firstMatchingSentence(resultText, /\b(use|used|choose|chosen|direct|avoid|instead|strategy|solution|fix|resolved)\b/i) ??
    firstMatchingSentence(errorText, /\b(error|failed|failure|timeout|regression|blocked|invalid)\b/i) ??
    task;
  const clean = source.replace(/^(decision|preference|result|error|lesson):\s*/i, "").trim();
  const words = clean.split(/\s+/).slice(0, 10).join(" ");
  return titleCase(words.length > 90 ? `${words.slice(0, 87).trim()}...` : words);
}

function reasoningTrigger(task: string, failurePattern: string): string {
  const source = firstMatchingSentence(`${failurePattern} ${task}`, /\b(when|large|upload|serverless|auth|token|deploy|test|build|storage|api|error|timeout)\b/i)
    ?? task;
  return source.length > 160 ? source.slice(0, 157).trim() : source;
}

function reasoningContext(task: string, combined: string, status: string): string {
  const sentence =
    firstMatchingSentence(combined, /\b(because|when|while|during|serverless|storage|upload|deploy|auth|test|build)\b/i) ??
    task;
  return `Run status was ${status}. ${sentence}`.slice(0, 420);
}

function reasoningAppliesTo(content: string, task: string): string[] {
  const known = [
    "Netlify",
    "Supabase",
    "Supabase Storage",
    "serverless",
    "OAuth",
    "uploads",
    "video uploads",
    "tests",
    "deployments",
    "CLI",
    "MCP"
  ];
  const combined = `${content} ${task}`.toLowerCase();
  const matches = known.filter((item) => combined.includes(item.toLowerCase()));
  const tokens = tokenize(`${task} ${content}`).filter((token) => !stopWords.has(token)).slice(0, 4);
  return unique([...matches, ...tokens]).slice(0, 8);
}

function reasoningPreconditions(content: string, task: string, hasFailure: boolean): string[] {
  const preconditions = new Set<string>();
  const combined = `${content} ${task}`.toLowerCase();
  if (combined.includes("serverless")) preconditions.add("serverless backend");
  if (combined.includes("storage")) preconditions.add("object storage available");
  if (combined.includes("upload")) preconditions.add("file upload workflow");
  if (combined.includes("test")) preconditions.add("test failure or regression");
  if (combined.includes("deploy")) preconditions.add("deployment workflow");
  if (hasFailure) preconditions.add("previous failure observed");
  if (preconditions.size === 0) preconditions.add("similar task constraints appear");
  return [...preconditions].slice(0, 8);
}

function reasoningAntiPatterns(content: string, failurePattern: string): string[] {
  const antiPatterns = new Set<string>();
  const combined = `${content} ${failurePattern}`.toLowerCase();
  if (combined.includes("serverless") && combined.includes("upload")) {
    antiPatterns.add("proxy entire binary through serverless function");
  }
  if (combined.includes("retry")) antiPatterns.add("repeat blind retries without changing strategy");
  if (combined.includes("timeout")) antiPatterns.add("ignore timeout or payload limits");
  if (combined.includes("secret")) antiPatterns.add("store secrets in durable memory");
  if (antiPatterns.size === 0) antiPatterns.add("repeat the failing approach without checking run artifacts");
  return [...antiPatterns].slice(0, 8);
}

function firstMatchingSentence(content: string, pattern: RegExp): string | null {
  const sentences = content
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  return sentences.find((sentence) => pattern.test(sentence)) ?? null;
}

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .map((word) => (word.length > 3 ? capitalize(word) : word.toLowerCase()))
    .join(" ")
    .replace(/\b(api|mcp|cli|oauth)\b/gi, (match) => match.toUpperCase());
}

export async function embedText(text: string, options: MemoryModelOptions = {}): Promise<number[]> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (options.useLlm !== false && apiKey) {
    try {
      return await requestEmbedding(text, { ...options, apiKey });
    } catch {
      // Fall through to local embeddings before the deterministic lexical fallback.
    }
  }

  if (shouldUseLocalEmbeddings(options)) {
    try {
      return await requestLocalOnnxEmbedding(text, options);
    } catch (error) {
      if (process.env.MEMORYFS_REQUIRE_LOCAL_EMBEDDINGS === "1" || options.allowEmbeddingFallback === false) {
        throw error;
      }
    }
  }

  return fallbackEmbedding(text);
}

type LocalFeatureExtractor = (
  input: string,
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Iterable<number> | ArrayLike<number> }>;

const localEmbeddingPipelines = new Map<string, Promise<LocalFeatureExtractor>>();

function shouldUseLocalEmbeddings(options: MemoryModelOptions): boolean {
  if (options.useLocalEmbeddings !== undefined) return options.useLocalEmbeddings;
  const env = process.env.MEMORYFS_USE_LOCAL_EMBEDDINGS;
  if (env === "0" || env === "false") return false;
  if (env === "1" || env === "true") return true;
  return process.env.NODE_ENV !== "test";
}

async function requestLocalOnnxEmbedding(text: string, options: MemoryModelOptions): Promise<number[]> {
  const model = options.localEmbedModel ?? process.env.MEMORYFS_LOCAL_EMBED_MODEL ?? "Xenova/all-MiniLM-L6-v2";
  let pipelinePromise = localEmbeddingPipelines.get(model);
  if (!pipelinePromise) {
    const nextPipelinePromise = createLocalEmbeddingPipeline(model).catch((error) => {
      if (localEmbeddingPipelines.get(model) === nextPipelinePromise) {
        localEmbeddingPipelines.delete(model);
      }
      throw error;
    });
    pipelinePromise = nextPipelinePromise;
    localEmbeddingPipelines.set(model, pipelinePromise);
  }
  const extractor = await pipelinePromise;
  const output = await extractor(text.slice(0, 8192), { pooling: "mean", normalize: true });
  const vector = Array.from(output.data as Iterable<number>);
  if (vector.length === 0) {
    throw new Error("Local ONNX embedding returned an empty vector.");
  }
  return normalizeVector(vector);
}

async function createLocalEmbeddingPipeline(model: string): Promise<LocalFeatureExtractor> {
  const transformers = await loadTransformersModule();
  const envConfig = transformers.env as {
    allowRemoteModels?: boolean;
    allowLocalModels?: boolean;
    cacheDir?: string;
  };
  envConfig.allowLocalModels = true;
  envConfig.allowRemoteModels = process.env.MEMORYFS_LOCAL_EMBED_LOCAL_ONLY === "1" ? false : true;
  if (process.env.MEMORYFS_MODEL_CACHE_DIR) {
    envConfig.cacheDir = process.env.MEMORYFS_MODEL_CACHE_DIR;
  }
  const pipelineOptions: { local_files_only: boolean; device?: "wasm" } = {
    local_files_only: process.env.MEMORYFS_LOCAL_EMBED_LOCAL_ONLY === "1"
  };
  if (process.env.MEMORYFS_ONNX_RUNTIME === "web") {
    pipelineOptions.device = "wasm";
  }
  const extractor = await transformers.pipeline("feature-extraction", model, pipelineOptions);
  return extractor as unknown as LocalFeatureExtractor;
}

async function loadTransformersModule(): Promise<typeof import("@huggingface/transformers")> {
  if (process.env.MEMORYFS_ONNX_RUNTIME !== "web") {
    return import("@huggingface/transformers");
  }

  const require = createRequire(import.meta.url);
  const nodeEntry = require.resolve("@huggingface/transformers");
  const distDir = path.dirname(nodeEntry);
  const webEntry = path.join(distDir, "transformers.web.js");
  const mod = (await import(pathToFileURL(webEntry).href)) as typeof import("@huggingface/transformers");
  const onnxBackend = (mod.env as { backends?: { onnx?: { wasm?: { wasmPaths?: string } } } }).backends?.onnx;
  if (onnxBackend?.wasm && !process.env.MEMORYFS_ONNX_WASM_REMOTE) {
    onnxBackend.wasm.wasmPaths = pathToFileURL(`${distDir}${path.sep}`).href;
  }
  return mod;
}

export function fallbackEmbedding(text: string, dimensions = 384): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenize(text);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const first = alphaIndex(token.charCodeAt(0));
    const second = alphaIndex(token.charCodeAt(1) || token.charCodeAt(0));
    const last = alphaIndex(token.charCodeAt(token.length - 1));
    vector[first] += 1;
    vector[26 + Math.min(15, token.length)] += 0.35;
    vector[42 + first] += token.length > 6 ? 0.25 : 0.1;
    vector[68 + ((first * 26 + second) % 128)] += 0.65;
    vector[196 + ((first * 26 + last) % 128)] += 0.45;

    const semanticIndex = semanticFeatureIndex(token);
    if (semanticIndex !== null) {
      vector[324 + semanticIndex] += 1.2;
    }

    const next = tokens[index + 1];
    if (next) {
      const nextFirst = alphaIndex(next.charCodeAt(0));
      vector[348 + ((first * 26 + nextFirst) % 36)] += 0.5;
    }
  }

  return normalizeVector(vector);
}

function alphaIndex(code: number): number {
  const lower = String.fromCharCode(code).toLowerCase().charCodeAt(0);
  if (lower >= 97 && lower <= 122) return lower - 97;
  if (lower >= 48 && lower <= 57) return lower - 48;
  return 25;
}

function semanticFeatureIndex(token: string): number | null {
  const groups = [
    ["prefer", "preference", "want", "like"],
    ["decision", "decide", "choose", "chosen"],
    ["constraint", "must", "never", "avoid", "require"],
    ["error", "fail", "failure", "bug", "exception"],
    ["task", "todo", "follow", "next", "action"],
    ["question", "unknown", "unresolved", "tbd"],
    ["research", "finding", "evidence", "source"],
    ["run", "result", "summary", "handoff"],
    ["project", "onboard", "profile", "user"],
    ["security", "protected", "trust", "audit"],
    ["sync", "cloud", "team", "local"],
    ["file", "path", "blob", "raw"]
  ];
  const index = groups.findIndex((group) => group.some((entry) => token.startsWith(entry)));
  return index === -1 ? null : index;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }

  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function keywordScore(query: string, target: string): number {
  const queryTokens = unique(tokenize(query));
  if (queryTokens.length === 0) return 0;

  const targetTokens = new Set(tokenize(target));
  const matches = queryTokens.filter((token) => targetTokens.has(token)).length;
  return matches / queryTokens.length;
}

export function bm25Scores(query: string, documents: Bm25Document[]): Map<string, number> {
  const queryTerms = unique(tokenize(query));
  const tokenized = documents.map((document) => ({
    id: document.id,
    tokens: tokenize(document.text)
  }));
  if (queryTerms.length === 0 || tokenized.length === 0) {
    return new Map(documents.map((document) => [document.id, 0]));
  }

  const documentCount = tokenized.length;
  const averageLength =
    tokenized.reduce((sum, document) => sum + document.tokens.length, 0) / Math.max(1, documentCount);
  const documentFrequencies = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequencies.set(
      term,
      tokenized.filter((document) => new Set(document.tokens).has(term)).length
    );
  }

  const k1 = 1.2;
  const b = 0.75;
  const rawScores = new Map<string, number>();
  for (const document of tokenized) {
    const termFrequency = new Map<string, number>();
    for (const token of document.tokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }

    let score = 0;
    for (const term of queryTerms) {
      const frequency = termFrequency.get(term) ?? 0;
      if (frequency === 0) continue;
      const df = documentFrequencies.get(term) ?? 0;
      const idf = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
      const denominator = frequency + k1 * (1 - b + b * (document.tokens.length / Math.max(1, averageLength)));
      score += idf * ((frequency * (k1 + 1)) / denominator);
    }
    rawScores.set(document.id, score);
  }

  return normalizeScoreMap(rawScores, documents.map((document) => document.id));
}

export function reciprocalRankFusion(rankings: RrfRanking[], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  const ids = new Set<string>();
  for (const ranking of rankings) {
    const weight = ranking.weight ?? 1;
    ranking.items
      .filter((item) => Number.isFinite(item.score))
      .sort((left, right) => right.score - left.score)
      .forEach((item, index) => {
        ids.add(item.id);
        if (item.score <= 0) return;
        const rank = index + 1;
        scores.set(item.id, (scores.get(item.id) ?? 0) + weight / (k + rank));
      });
  }
  return normalizeScoreMap(scores, [...ids]);
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(normalizeToken)
    .filter((token): token is string => Boolean(token && token.length > 1));
}

function normalizeToken(token: string): string {
  const lower = token.toLowerCase().trim();
  if (!lower || stopWords.has(lower)) return "";
  if (lower.endsWith("ies") && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("ing") && lower.length > 5) return lower.slice(0, -3);
  if (lower.endsWith("ed") && lower.length > 4) return lower.slice(0, -2);
  if (lower.endsWith("s") && lower.length > 3) return lower.slice(0, -1);
  return lower;
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}

function normalizeScoreMap(scores: Map<string, number>, ids: string[]): Map<string, number> {
  const complete = new Map<string, number>();
  for (const id of ids) {
    complete.set(id, scores.get(id) ?? 0);
  }
  const max = Math.max(0, ...complete.values());
  if (max === 0) {
    return complete;
  }
  for (const [id, score] of complete) {
    complete.set(id, Math.max(0, score / max));
  }
  return complete;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

async function requestChatCompletion(prompt: string, options: Required<Pick<MemoryModelOptions, "apiKey">> & MemoryModelOptions): Promise<string> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1");
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: options.chatModel ?? process.env.MEMORYFS_CHAT_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    throw new Error(`Memory extraction request failed with ${response.status}.`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Memory extraction response did not include content.");
  }

  return content;
}

async function requestEmbedding(text: string, options: Required<Pick<MemoryModelOptions, "apiKey">> & MemoryModelOptions): Promise<number[]> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1");
  const response = await fetchWithTimeout(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: options.embedModel ?? process.env.MEMORYFS_EMBED_MODEL ?? "text-embedding-3-small",
      input: text
    })
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed with ${response.status}.`);
  }

  const json = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = json.data?.[0]?.embedding;

  if (!embedding) {
    throw new Error("Embedding response did not include a vector.");
  }

  return normalizeVector(embedding);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const timeoutMs = Number(process.env.MEMORYFS_MODEL_TIMEOUT_MS ?? 20000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}
