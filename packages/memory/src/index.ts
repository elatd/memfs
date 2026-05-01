import { createHash } from "node:crypto";
import { buildExtractMemoryNodesPrompt } from "./prompts/extract-memory-nodes.js";

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
  "other"
] as const;

export type MemoryType = (typeof memoryTypes)[number];

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

export interface MemoryModelOptions {
  apiKey?: string;
  baseUrl?: string;
  chatModel?: string;
  embedModel?: string;
  useLlm?: boolean;
}

export type RecallMode =
  | "general"
  | "task_preparation"
  | "fact_lookup"
  | "debugging"
  | "handoff"
  | "research"
  | "decision_review";

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
      return ["decision", "constraint", "preference", "task", "error", "run_summary"];
    case "fact_lookup":
      return ["fact", "research_finding", "decision", "constraint"];
    case "debugging":
      return ["error", "run_summary", "constraint", "decision", "task"];
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

export function fallbackExtractMemoryNodes(content: string, path: string): ExtractedMemoryNode[] {
  return chunkMarkdown(content)
    .map((chunk) => fallbackNodeForChunk(chunk, path))
    .filter((node): node is ExtractedMemoryNode => Boolean(node));
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

export async function embedText(text: string, options: MemoryModelOptions = {}): Promise<number[]> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (options.useLlm !== false && apiKey) {
    try {
      return await requestEmbedding(text, { ...options, apiKey });
    } catch {
      return fallbackEmbedding(text);
    }
  }

  return fallbackEmbedding(text);
}

export function fallbackEmbedding(text: string, dimensions = 256): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const hash = createHash("sha256").update(token).digest();
    const index = hash.readUInt32BE(0) % dimensions;
    const sign = hash[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  return normalizeVector(vector);
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
