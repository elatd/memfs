import { describe, expect, it } from "vitest";
import { bm25Scores, fallbackEmbedding, planRecallQuery, reciprocalRankFusion } from "./index.js";

describe("recall query planner", () => {
  it("detects task preparation intent", () => {
    const plan = planRecallQuery({
      query: "What should I remember before changing onboarding?",
      project_hint: "pipsqueak"
    });

    expect(plan.mode).toBe("task_preparation");
    expect(plan.project_hint).toBe("pipsqueak");
    expect(plan.memory_types).toContain("decision");
    expect(plan.retrieval_strategy.trigger_weight).toBeGreaterThan(plan.retrieval_strategy.summary_weight);
  });

  it("detects debugging intent", () => {
    const plan = planRecallQuery({
      query: "Why did this fail in the last run?"
    });

    expect(plan.mode).toBe("debugging");
    expect(plan.needs_recent_runs).toBe(true);
    expect(plan.memory_types).toContain("error");
  });

  it("scores exact terms with BM25", () => {
    const scores = bm25Scores("onboarding decision", [
      { id: "a", text: "Decision: Keep onboarding short." },
      { id: "b", text: "Preference: Use quiet colors." }
    ]);

    expect(scores.get("a")).toBeGreaterThan(scores.get("b") ?? 0);
  });

  it("fuses dense and keyword ranks with RRF", () => {
    const scores = reciprocalRankFusion([
      { items: [{ id: "dense", score: 1 }, { id: "keyword", score: 0.2 }] },
      { items: [{ id: "keyword", score: 1 }, { id: "dense", score: 0.2 }] }
    ]);

    expect(scores.get("dense")).toBeGreaterThan(0);
    expect(scores.get("keyword")).toBeGreaterThan(0);
  });

  it("uses a deterministic non-hash lexical embedding fallback", () => {
    const first = fallbackEmbedding("Decision: Keep onboarding short.");
    const second = fallbackEmbedding("Decision: Keep onboarding short.");

    expect(first).toHaveLength(384);
    expect(second).toEqual(first);
  });
});
