# Explainable Recall

MemFS recall is planned before retrieval. The planner is deterministic and works without an LLM.

Planner input:

```json
{
  "query": "What should I remember before changing onboarding?",
  "project_hint": "pipsqueak",
  "mode": "task_preparation",
  "memory_types": ["decision", "constraint"],
  "include_detail": true,
  "include_raw": false,
  "include_why": true,
  "include_contradictions": true,
  "limit": 8
}
```

Detected modes:

- `task_preparation`: phrases like "before doing X".
- `decision_review`: "what did we decide".
- `debugging`: "why did this fail".
- `handoff`: "summarize what matters".
- `fact_lookup`: "find source".
- `research`: research and findings queries.
- `general`: fallback.

When `include_why=true`, each result includes score components:

- `trigger_similarity`
- `summary_similarity`
- `keyword_score`
- `detail_similarity`
- `raw_excerpt_similarity`
- `importance_score`
- `recency_score`
- `path_project_score`
- `graph_score`
- `matched_terms`
- `explanation`

Example explanation:

```text
This was recalled because its trigger fits task preparation recall, it matches onboarding, it is an important decision.
```

Why explanations describe why a derived memory index was retrieved. They do not make the memory canonical truth. Follow `source_path` and `raw_ref` when truth matters.
