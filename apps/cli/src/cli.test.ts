import { buildServer } from "@memoryfs/api";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./index.js";

let tempDir: string;
let app: Awaited<ReturnType<typeof buildServer>>;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "memfs-cli-test-"));
  process.env.MEMORYFS_DATA_DIR = tempDir;
  process.env.OPENAI_API_KEY = "";
  app = await buildServer();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as AddressInfo;
  env = {
    ...process.env,
    MEMFS_API_URL: `http://127.0.0.1:${address.port}`,
    MEMFS_CONFIG_DIR: path.join(tempDir, "config")
  };
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
  delete process.env.MEMORYFS_DATA_DIR;
});

describe("memfs CLI", () => {
  it("creates and selects a workspace", async () => {
    const create = await run("workspace", "create", "demo");
    expect(create.code).toBe(0);
    expect(create.stdout).toContain("Created workspace demo");

    const use = await run("use", "demo");
    expect(use.code).toBe(0);
    expect(use.stdout).toContain("Using workspace demo");

    const status = await run("status");
    expect(status.stdout).toContain("Workspace: demo");
  });

  it("writes and reads files", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");

    const write = await run("write", "/scratch/cli.md", "Preference: CLI should be easy for agents.");
    expect(write.code).toBe(0);

    const cat = await run("cat", "/scratch/cli.md");
    expect(cat.stdout).toContain("CLI should be easy for agents");
  });

  it("greps memory", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run("write", "/scratch/hosting.md", "Preference: The user prefers Netlify for hosting.");

    const grep = await run("grep", "hosting preference");
    expect(grep.code).toBe(0);
    expect(grep.stdout).toContain("/scratch/hosting.md");
    expect(grep.stdout.toLowerCase()).toContain("netlify");
  });

  it("recalls source-backed memory without raw content", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run("write", "/scratch/onboarding.md", "Decision: Onboarding should stay short.");

    const recall = await run("recall", "onboarding decision");
    expect(recall.code).toBe(0);
    expect(recall.stdout).toContain("source: /scratch/onboarding.md");
    expect(recall.stdout).toContain("raw_ref:");
    expect(recall.stdout).not.toContain("raw_content");
  });

  it("uploads and extracts local files", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    const localPath = path.join(tempDir, "prefs.json");
    await writeFile(localPath, JSON.stringify({ preference: "source references matter" }));

    const upload = await run("upload", localPath, "--to", "/uploads/prefs.json", "--no-ingest");
    expect(upload.code).toBe(0);
    expect(upload.stdout).toContain("/uploads/prefs.json");

    const extract = await run("extract", "/uploads/prefs.json");
    expect(extract.stdout).toContain("json@");

    const extracted = await run("extracted", "/uploads/prefs.json");
    expect(extracted.stdout).toContain("$.preference");
  });

  it("promotes and approves reviewed memory", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run("write", "/scratch/promote.md", "Preference: Reviewed memory should go through approval.");

    const promote = await run("promote", "/scratch/promote.md", "--to", "/preferences.md");
    expect(promote.code).toBe(0);
    expect(promote.stdout).toContain("pending");

    const promotions = await run("promotions", "--json");
    const parsed = JSON.parse(promotions.stdout) as Array<{ id: string; status: string }>;
    expect(parsed[0]?.status).toBe("pending");

    const approve = await run("approve", parsed[0]!.id);
    expect(approve.code).toBe(0);
    expect(approve.stdout).toContain("applied");

    const cat = await run("cat", "/preferences.md");
    expect(cat.stdout).toContain("Promoted from /scratch/promote.md");
  });

  it("creates snapshots, diffs, dry-run rollbacks, and reports health", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run("write", "/scratch/snapshot.md", "Decision: CLI snapshots work.");

    const create = await run("snapshot", "create", "before");
    expect(create.code).toBe(0);
    const list = await run("snapshot", "list", "--json");
    const snapshots = JSON.parse(list.stdout) as Array<{ id: string }>;
    expect(snapshots).toHaveLength(1);

    await run("write", "/scratch/snapshot.md", "Decision: CLI snapshots changed.");
    const diff = await run("snapshot", "diff", snapshots[0]!.id);
    expect(diff.stdout).toContain("changed");

    const rollback = await run("rollback", snapshots[0]!.id, "--dry-run");
    expect(rollback.stdout).toContain("\"dry_run\": true");

    const health = await run("health");
    expect(health.stdout).toContain("Memory health:");
  });

  it("shows sync status and manages team members", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run("write", "/scratch/sync-cli.md", "Decision: CLI exposes sync status.");

    const status = await run("sync", "status");
    expect(status.stdout).toContain("Sync:");
    expect(status.stdout).toContain("pending events:");

    const invite = await run("team", "invite", "agent:cli", "--role", "agent");
    expect(invite.stdout).toContain("agent:cli agent");

    const members = await run("team", "members");
    expect(members.stdout).toContain("agent:cli");

    const role = await run("team", "role", "set", "agent:cli", "viewer");
    expect(role.stdout).toContain("agent:cli viewer");
  });

  it("shows mount status when no mounts are active", async () => {
    const status = await run("mount", "status");

    expect(status.code).toBe(0);
    expect(status.stdout).toContain("(no active MemFS mounts)");
  });
});

async function run(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    env,
    io: {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    }
  });

  return {
    code,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n")
  };
}
