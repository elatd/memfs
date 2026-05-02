import { describe, expect, it } from "vitest";
import { gradeSourceRefs } from "./source-ref-grader.js";

describe("gradeSourceRefs", () => {
  it("penalizes unexpected source ids", () => {
    const grade = gradeSourceRefs(
      [
        { sourceId: "expected", text: "expected memory" },
        { sourceId: "unrelated", text: "unrelated memory" }
      ],
      ["expected"]
    );

    expect(grade.recall).toBe(1);
    expect(grade.precision).toBe(0.5);
    expect(grade.score).toBeCloseTo(2 / 3);
    expect(grade.exactMatch).toBe(false);
    expect(grade.unexpectedSourceIds).toEqual(["unrelated"]);
  });
});
