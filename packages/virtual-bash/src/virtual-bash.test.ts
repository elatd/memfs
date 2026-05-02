import { VeriFS } from "@verifs/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVeriFSShell, splitArgs } from "./index.js";

let tempDir: string;
let verifs: VeriFS;
let workspaceId: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "verifs-shell-test-"));
  verifs = new VeriFS({
    dataDir: tempDir,
    memory: { useLlm: false }
  });
  await verifs.initialize();
  workspaceId = verifs.createWorkspace("demo").id;
});

afterEach(async () => {
  verifs.close();
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

  it("executes ls cat write grep search and recall", async () => {
    const shell = createVeriFSShell({ verifs, workspaceId });

    const write = await shell.exec('write /runs/demo/result.md "Decision: We decided to simplify onboarding."');
    expect(write.displayText).toContain("Wrote");

    const ls = await shell.exec("ls /runs");
    expect(ls.displayText).toContain("/runs/demo/result.md");

    const cat = await shell.exec("cat /runs/demo/result.md");
    expect(cat.displayText).toContain("simplify onboarding");

	    const grep = await shell.exec('grep "simplify onboarding"');
	    expect(grep.displayText).toContain("/runs/demo/result.md");
	    expect(grep.displayText).toContain("trust:");
	    expect((grep.data as { mode: string; results: Array<{ match_type: string }> }).mode).toBe("literal");

	    const search = await shell.exec('search "onboarding decision"');
	    expect(search.displayText).toContain("raw_ref:");
	    expect(search.displayText).toContain("source: /runs/demo/result.md");
	    expect((search.data as { mode: string; results: Array<{ match_type: string }> }).mode).toBe("hybrid");

    const recall = await shell.exec('recall "What should I remember before changing onboarding?"');
    expect(recall.displayText).toContain("source: /runs/demo/result.md");
  });

  it("passes include-stale through virtual grep", async () => {
    const shell = createVeriFSShell({ verifs, workspaceId });
    await shell.exec('write /scratch/stale.md "Decision: Backend plan uses the old auth service."');
    const node = verifs.listMemoryNodes(workspaceId).find((entry) => entry.source_path === "/scratch/stale.md")!;
    verifs.markMemoryStale(workspaceId, node.id, {
      actor: "human:test",
      reason: "Auth service changed"
    });

    const hidden = await shell.exec('grep --semantic "old auth service"');
    const visible = await shell.exec('grep --semantic --include-stale "old auth service"');

    expect((hidden.data as { results: Array<{ node_id: string | null }> }).results.some((result) => result.node_id === node.id)).toBe(false);
    expect((visible.data as { results: Array<{ node_id: string | null }> }).results.some((result) => result.node_id === node.id)).toBe(true);
  });

  it("denies protected write append and delete by default and audits denials", async () => {
    const shell = createVeriFSShell({ verifs, workspaceId });
    await verifs.writeFile(workspaceId, "/preferences.md", "Protected seed", {
      actor: "test",
      ingest: false,
      allow_protected_write: true
    });

    await expect(shell.exec('write /preferences.md "should fail"')).rejects.toThrow(/Protected path/);
    await expect(shell.exec('append /preferences.md "should fail"')).rejects.toThrow(/Protected path/);
    await expect(shell.exec("rm /preferences.md")).rejects.toThrow(/Protected path/);

    const auditTypes = verifs.listAuditEvents(workspaceId).map((event) => event.event_type);
    expect(auditTypes.filter((type) => type === "protected_write_denied").length).toBeGreaterThanOrEqual(2);
    expect(auditTypes).toContain("protected_delete_denied");
    expect((await verifs.readFile(workspaceId, "/preferences.md")).content).toBe("Protected seed");
  });

  it("allows protected writes only when shell construction opts in", async () => {
    const shell = createVeriFSShell({ verifs, workspaceId, allowProtectedWrite: true });

    const write = await shell.exec('write /preferences.md "Allowed preference"');

    expect(write.displayText).toContain("Wrote /preferences.md");
    expect((await verifs.readFile(workspaceId, "/preferences.md")).content).toBe("Allowed preference");
  });

  it("executes brief run promote health and sync status commands", async () => {
    const shell = createVeriFSShell({ verifs, workspaceId });
    await shell.exec('write /runs/demo/result.md "Decision: Keep onboarding simple."');

    const brief = await shell.exec('brief "change onboarding"');
    expect(brief.displayText).toContain("# Memory Brief");

    const run = await shell.exec('run create "Change onboarding"');
    expect(run.displayText).toContain("/runs/");
    const runId = (run.data as { id: string }).id;

    const runList = await shell.exec("run list");
    expect(runList.displayText).toContain(runId);

    const runShow = await shell.exec(`run show ${runId}`);
    expect(runShow.displayText).toContain("Change onboarding");

    const runPath = await shell.exec(`run path ${runId}`);
    expect(runPath.displayText).toBe(`/runs/${runId}`);

    const today = await shell.exec("run today");
    expect(today.displayText).toMatch(/^\/runs\/\d{4}-\d{2}-\d{2}$/);

    const completed = await shell.exec(`run complete ${runId} "Finished onboarding change."`);
    expect(completed.displayText).toContain("completed");

    const compiled = await shell.exec(`run compile ${runId}`);
    expect(compiled.displayText).toContain("Compiled");

    const promotion = await shell.exec('promote /runs/demo/result.md --to /memory/onboarding.md --reason "Durable onboarding note"');
    expect(promotion.displayText).toContain("/runs/demo/result.md -> /memory/onboarding.md");

    const health = await shell.exec("health");
    expect(health.displayText).toContain("Memory health:");

    const sync = await shell.exec("sync status");
    expect(sync.displayText).toContain("Sync:");
  });

  it("rejects unsupported commands", async () => {
    const shell = createVeriFSShell({ verifs, workspaceId });
    await expect(shell.exec("pwd")).rejects.toThrow(/Unsupported/);
  });

  it("rejects path traversal", async () => {
    const shell = createVeriFSShell({ verifs, workspaceId });
    await expect(shell.exec('cat /../secret.md')).rejects.toThrow(/Path traversal/);
  });

  it("rejects shell injection patterns", async () => {
    const shell = createVeriFSShell({ verifs, workspaceId });
    await expect(shell.exec('write /scratch/a.md "ok"; rm /scratch/a.md')).rejects.toThrow(/Unsupported shell syntax/);
  });
});
