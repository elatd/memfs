import { MemoryFS } from "@memoryfs/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryFsShell, splitArgs } from "./index.js";

let tempDir: string;
let memoryfs: MemoryFS;
let workspaceId: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "memfs-shell-test-"));
  memoryfs = new MemoryFS({
    dataDir: tempDir,
    memory: { useLlm: false }
  });
  await memoryfs.initialize();
  workspaceId = memoryfs.createWorkspace("demo").id;
});

afterEach(async () => {
  memoryfs.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("virtual bash", () => {
  it("parses quoted commands deterministically", () => {
    expect(splitArgs('write /runs/demo/result.md "We decided to simplify onboarding."')).toEqual([
      "write",
      "/runs/demo/result.md",
      "We decided to simplify onboarding."
    ]);
  });

  it("executes ls cat write grep sgrep and recall", async () => {
    const shell = createMemoryFsShell({ memoryfs, workspaceId });

    const write = await shell.exec('write /runs/demo/result.md "Decision: We decided to simplify onboarding."');
    expect(write.displayText).toContain("Wrote");

    const ls = await shell.exec("ls /runs");
    expect(ls.displayText).toContain("/runs/demo/result.md");

    const cat = await shell.exec("cat /runs/demo/result.md");
    expect(cat.displayText).toContain("simplify onboarding");

    const grep = await shell.exec('grep "simplify onboarding"');
    expect(grep.displayText).toContain("/runs/demo/result.md");

    const sgrep = await shell.exec('sgrep "onboarding decision"');
    expect(sgrep.displayText).toContain("raw_ref:");

    const recall = await shell.exec('recall "What should I remember before changing onboarding?"');
    expect(recall.displayText).toContain("source: /runs/demo/result.md");
  });

  it("rejects unsupported commands", async () => {
    const shell = createMemoryFsShell({ memoryfs, workspaceId });
    await expect(shell.exec("pwd")).rejects.toThrow(/Unsupported/);
  });

  it("rejects path traversal", async () => {
    const shell = createMemoryFsShell({ memoryfs, workspaceId });
    await expect(shell.exec('cat /../secret.md')).rejects.toThrow(/Path traversal/);
  });

  it("rejects shell injection patterns", async () => {
    const shell = createMemoryFsShell({ memoryfs, workspaceId });
    await expect(shell.exec('write /scratch/a.md "ok"; rm /scratch/a.md')).rejects.toThrow(/Unsupported shell syntax/);
  });
});
