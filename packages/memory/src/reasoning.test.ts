import { describe, expect, it } from "vitest";
import { fallbackExtractReasoningMemories, validateReasoningMemoriesJson } from "./index.js";

describe("reasoning memory extraction", () => {
  it("validates strict reasoning memory JSON", () => {
    const memories = validateReasoningMemoriesJson(
      JSON.stringify([
        {
          type: "reasoning_memory",
          title: "Use signed upload URLs for large files",
          trigger: "Large file upload fails through serverless function",
          context: "Serverless functions may fail when proxying large binary uploads.",
          strategy: "Generate a signed upload URL and upload directly to object storage.",
          failure_pattern: "Routing large binaries through the function caused errors or timeouts.",
          success_pattern: "Direct upload avoided function payload limits.",
          applies_to: ["Netlify", "Supabase Storage", "video uploads"],
          preconditions: ["large file upload", "serverless backend", "object storage available"],
          anti_patterns: ["proxy entire binary through serverless function"],
          source_run: "/runs/test-upload-debug",
          source_refs: ["/runs/test-upload-debug/result.md", "/runs/test-upload-debug/errors.md"],
          confidence: 0.87,
          status: "candidate",
          reason: "The run showed a reusable upload strategy."
        }
      ]),
      "Generate a signed upload URL and upload directly to object storage.",
      "/runs/test-upload-debug"
    );

    expect(memories[0]?.type).toBe("reasoning_memory");
    expect(memories[0]?.status).toBe("candidate");
  });

  it("rejects invalid model output", () => {
    expect(() =>
      validateReasoningMemoriesJson(
        JSON.stringify([{ type: "reasoning_memory", title: "Missing fields" }]),
        "Missing fields",
        "/runs/test"
      )
    ).toThrow(/status|trigger|context|strategy/i);
  });

  it("extracts deterministic failure lessons", () => {
    const memories = fallbackExtractReasoningMemories({
      run_path: "/runs/test-upload-debug",
      task: "Debug video upload",
      status: "failed",
      artifacts: {
        "prompt.md": "Debug video upload",
        "errors.md": "Large video upload failed because the serverless function timed out.",
        "result.md": "Use signed upload URLs and upload directly to Supabase Storage instead.",
        "followups.md": ""
      }
    });

    expect(memories[0]?.source_run).toBe("/runs/test-upload-debug");
    expect(memories[0]?.source_refs.length).toBeGreaterThan(0);
    expect(memories[0]?.status).toBe("candidate");
  });
});
