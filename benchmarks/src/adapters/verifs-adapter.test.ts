import { describe, expect, it } from "vitest";
import { sourcePathFor } from "./verifs-adapter.js";

describe("sourcePathFor", () => {
  it("keeps sanitized source id collisions distinct", () => {
    expect(sourcePathFor("a:b")).not.toBe(sourcePathFor("a/b"));
  });

  it("preserves explicit absolute fixture paths", () => {
    expect(sourcePathFor("a:b", { path: "/benchmarks/custom.md" })).toBe("/benchmarks/custom.md");
  });
});
