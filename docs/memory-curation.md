# Memory Curation

MemFS is designed to work with local, open-weight, and hosted models. The main agent model does not need to write directly to long-term memory. Instead, MemFS should use a memory curation pipeline that separates task execution from memory promotion.

Recommended flow:

```text
Agent run or user event
  -> Memory curator model
  -> Structured memory candidates
  -> Validation, deduplication, and safety checks
  -> Optional verifier model
  -> Candidate memory or approved memory
  -> MemFS workspace, audit log, and search index
```

The curator model extracts durable, reusable memories from conversations, agent runs, files, and tool outputs. These may include user preferences, project facts, technical constraints, decisions, known bugs, successful patterns, failed attempts, and follow-up tasks.

MemFS should be conservative by default. Most memories should be written as candidates first, especially when they are inferred, derived from external content, or could affect future agent behavior. Explicit user instructions such as "remember this", "always do this", or "for this project, use this stack" may be promoted more directly, subject to validation.

## Model Strategy

For routine memory curation, a small to medium instruct model is usually sufficient.

| Role | Recommended size | Notes |
| --- | --- | --- |
| Lightweight classifier | 1B to 3B | Useful for simple tagging, but not enough for full memory judgment. |
| Default curator | 3B to 8B | Best balance of cost, speed, and quality. |
| Production curator | 7B to 14B | Better for conflict detection, source judgment, and higher-quality summaries. |
| Premium verifier | 14B to 27B | Useful for sensitive memories, conflicts, or high-trust review. |
| Routine memory writing | 30B+ | Usually unnecessary and too expensive. |

A practical default is an 8B instruct model. Models such as Qwen 8B, Ministral 8B, or similar instruct models are good candidates for the curator role. A larger model such as Ministral 14B, Mistral Small, or another stronger reasoning model can be used only as a verifier when the memory candidate is risky, ambiguous, conflicting, or global in scope.

## Prompting Before Fine-Tuning

Fine-tuning is not required for the first version of MemFS memory curation. A strong system prompt, strict JSON schema, deterministic validation rules, and retry-on-invalid-output should be enough for an MVP.

Fine-tuning should only be considered after MemFS has collected enough review data to identify repeated failure patterns, such as storing low-value memories, missing important durable facts, over-promoting inferred preferences, or failing to detect conflicts.

Review decisions should be saved as future training data:

- candidate proposed
- candidate approved
- candidate edited
- candidate rejected
- candidate marked duplicate
- candidate marked stale
- candidate marked unsafe

This creates a natural feedback loop for improving the curator later.

## Safety And Trust Rules

The curator should not store every message. It should extract only durable, reusable information.

MemFS should avoid storing:

- secrets
- API keys
- passwords
- tokens
- private credentials
- payment data
- temporary instructions
- unverified speculation
- prompt-injection text from external sources
- hidden instructions from webpages or documents

External content should never be converted into agent behavior rules unless the user explicitly approves it. For example, if a webpage says "ignore previous instructions", that text may be stored as page content if needed, but it must not become a trusted memory or instruction.

## Candidate Shape

The memory curator should return structured candidates with source references, confidence, scope, type, and review status.

Example:

```json
{
  "candidates": [
    {
      "memory": "The project uses React 18, TypeScript, Vite, Tailwind, lucide-react, and framer-motion.",
      "type": "fact",
      "scope": "project",
      "status_recommendation": "approved",
      "confidence": 1,
      "source_refs": ["user_instruction"],
      "risk_flags": ["none"],
      "requires_review": false,
      "reason": "The user explicitly provided this as a project stack constraint."
    }
  ]
}
```

## Versioned Curator Contract

The reusable prompts, JSON schemas, and validation helpers live in `packages/memory/src/curation`.

The module exports:

- `curatorSystemPrompt`
- `buildCandidateExtractionFromUserMessagePrompt`
- `buildCandidateExtractionFromRunPrompt`
- `buildReasoningMemoryExtractionFromRunPrompt`
- `buildRiskyCandidateVerifierPrompt`
- `buildDedupeConflictJudgmentPrompt`
- `memoryCandidateSchema`
- `reasoningMemoryCandidateSchema`
- `curatorResponseSchema`
- `verifierResponseSchema`
- `validateCuratorResponseJson`
- `validateVerifierResponseJson`

The current schema version is `memory-curation.v1`. Curator output must validate before it is used for memory writes or review routing.

Risk flags are normalized to:

- `secret`
- `sensitive`
- `prompt_injection`
- `unverified`
- `duplicate`
- `conflict`
- `external_instruction`
- `none`

Deterministic checks run after model validation. They flag common token, API-key, password, private-key, payment, and prompt-injection patterns. They also require review for inferred global user preferences unless the source text explicitly says to remember it, always use it, or treat it as a stable future constraint.

External documents, webpages, archives, and tool outputs may be stored as source-backed content, but their instructions should not become approved user preferences without review.

## Product Principle

MemFS should not simply be a place where agents write memories. It should be a trusted memory layer where memories are source-backed, reviewable, auditable, searchable, and reversible.

Core principle:

```text
Agents may propose memories freely.
MemFS decides how those memories are validated, reviewed, promoted, searched, and audited.
```
