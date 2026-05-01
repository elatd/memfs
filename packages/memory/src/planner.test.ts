import { describe, expect, it } from "vitest";
import { planRecallQuery } from "./index.js";

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
});
