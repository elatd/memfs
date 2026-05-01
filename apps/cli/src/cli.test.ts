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

  it("returns structured JSON for hybrid grep", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run("write", "/scratch/auth.md", "Decision: OAuth refresh tokens are stored server-side for the CLI test.");

    const grep = await run("grep", "--json", "OAuth refresh tokens");
    const parsed = JSON.parse(grep.stdout) as {
      query: string;
      mode: string;
      workspace_id: string;
      results: Array<{
        path: string;
        source_path: string;
        raw_ref: string | null;
        line: number | null;
        snippet: string;
        score: number;
        trust: string | null;
        node_id: string | null;
        match_type: string;
      }>;
    };

    expect(parsed.query).toBe("OAuth refresh tokens");
    expect(parsed.mode).toBe("hybrid");
    expect(parsed.workspace_id).toBeTruthy();
    expect(parsed.results[0]).toMatchObject({
      path: "/scratch/auth.md",
      source_path: "/scratch/auth.md",
      line: 1,
      match_type: "literal"
    });
    expect(parsed.results[0]?.raw_ref).toContain("memoryfs://");
    expect(parsed.results[0]?.snippet).toContain("OAuth refresh tokens");
    expect(typeof parsed.results[0]?.score).toBe("number");
    expect(parsed.results[0]).toHaveProperty("trust");
    expect(parsed.results[0]).toHaveProperty("node_id");
  });

  it("marks stale memory and includes it in grep only when requested", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run("write", "/scratch/backend.md", "Decision: Backend plan uses the legacy Rails flow.");
    const nodes = JSON.parse((await run("node", "list", "--json")).stdout) as Array<{ id: string; source_path: string }>;
    const node = nodes.find((entry) => entry.source_path === "/scratch/backend.md")!;

    const stale = await run("memory", "mark-stale", node.id, "--reason", "MVP backend changed", "--json");
    const staleJson = JSON.parse(stale.stdout) as { status: string; stale_reason: string };
    const grep = JSON.parse((await run("grep", "--semantic", "backend plan rails", "--json")).stdout) as {
      results: Array<{ node_id: string | null }>;
    };
    const grepWithStale = JSON.parse((await run("grep", "--semantic", "--include-stale", "backend plan rails", "--json")).stdout) as {
      results: Array<{ node_id: string | null }>;
    };
    const confirmed = JSON.parse((await run("memory", "confirm", node.id, "--json")).stdout) as {
      status: string;
      last_confirmed_at: string | null;
    };

    expect(staleJson).toMatchObject({ status: "stale", stale_reason: "MVP backend changed" });
    expect(grep.results.some((result) => result.node_id === node.id)).toBe(false);
    expect(grepWithStale.results.some((result) => result.node_id === node.id)).toBe(true);
    expect(confirmed.status).toBe("active");
    expect(confirmed.last_confirmed_at).toBeTruthy();
  });

  it("applies scope flags to grep recall and node list", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run(
      "write",
      "/projects/pipsqueak/decisions.md",
      "Decision: OAuth refresh tokens for Pipsqueak stay server-side and rotated on login.",
      "--allow-protected"
    );
    await run(
      "write",
      "/projects/other/decisions.md",
      "Decision: OAuth refresh tokens for Other stay in a different auth service.",
      "--allow-protected"
    );
    await run("write", "/preferences.md", "Preference: Workspace scoped OAuth defaults are separate.", "--allow-protected");

    const grep = await run("grep", "OAuth refresh tokens", "--scope", "project", "--project", "pipsqueak", "--json");
    const grepJson = JSON.parse(grep.stdout) as { results: Array<{ scope: string; project_slug: string | null; path: string }> };
    expect(grepJson.results.length).toBeGreaterThan(0);
    expect(grepJson.results.every((result) => result.scope === "project" && result.project_slug === "pipsqueak")).toBe(true);

    const recall = await run("recall", "OAuth defaults", "--scope", "workspace", "--json");
    const recallJson = JSON.parse(recall.stdout) as { results: Array<{ scope: string }> };
    expect(recallJson.results.every((result) => result.scope === "workspace")).toBe(true);

    const nodes = await run("node", "list", "--scope", "project", "--json");
    const nodeJson = JSON.parse(nodes.stdout) as Array<{ scope: string }>;
    expect(nodeJson.every((node) => node.scope === "project")).toBe(true);
  });

  it("creates, inspects, relates, explains, and deletes graph links", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run("write", "/scratch/graph-cli-a.md", "Decision: CLI graph links should be inspectable.");
    await run("write", "/scratch/graph-cli-b.md", "Constraint: CLI graph links should keep source references.");

    const nodes = JSON.parse((await run("node", "list", "--json")).stdout) as Array<{ id: string; source_path: string }>;
    const first = nodes.find((node) => node.source_path === "/scratch/graph-cli-a.md")!;
    const second = nodes.find((node) => node.source_path === "/scratch/graph-cli-b.md")!;

    const link = await run("graph", "link", first.id, "supports", second.id, "--reason", "CLI graph smoke test", "--json");
    const edge = JSON.parse(link.stdout) as { id: string; relation_type: string; from_id: string; to_id: string };
    expect(edge).toMatchObject({
      relation_type: "supports",
      from_id: first.id,
      to_id: second.id
    });

    const node = JSON.parse((await run("graph", "node", first.id, "--json")).stdout) as { edges: Array<{ id: string; relation_type: string }> };
    expect(node.edges.some((entry) => entry.id === edge.id && entry.relation_type === "supports")).toBe(true);

    const related = JSON.parse((await run("graph", "related", first.id, "--json")).stdout) as Array<{ node: { id: string; source_path: string }; path: Array<{ id: string }> }>;
    expect(related.some((entry) => entry.node.id === second.id && entry.path.some((pathEdge) => pathEdge.id === edge.id))).toBe(true);

    const pathResult = JSON.parse((await run("graph", "path", first.id, second.id, "--json")).stdout) as { found: boolean; path: Array<{ id: string }> };
    expect(pathResult.found).toBe(true);
    expect(pathResult.path.some((entry) => entry.id === edge.id)).toBe(true);

    const unlink = JSON.parse((await run("graph", "unlink", edge.id, "--json")).stdout) as { deleted: boolean; edge: { id: string } };
    expect(unlink).toMatchObject({ deleted: true, edge: { id: edge.id } });
  });

  it("imports, lists, shows, extracts, and searches archive entries", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    const localPath = path.join(tempDir, "conversation.txt");
    await writeFile(
      localPath,
      "Decision: OAuth refresh tokens should remain source-backed in archived conversations before promotion. This transcript is the canonical source."
    );

    const add = await run("archive", "add", localPath, "--type", "conversation", "--title", "Claude coding session", "--json");
    const entry = JSON.parse(add.stdout) as { id: string; path: string; raw_ref: string };
    expect(entry.path).toContain("/archive/conversations/");
    expect(entry.raw_ref).toContain("memoryfs://");

    const list = await run("archive", "list");
    expect(list.stdout).toContain(entry.id);

    const show = await run("archive", "show", entry.id);
    expect(show.stdout).toContain("OAuth refresh tokens");

    const extract = await run("archive", "extract", entry.id);
    expect(extract.stdout).toContain("candidate memories");
    expect(extract.stdout).toContain("trust=agent_generated");

    const search = await run("archive", "search", "OAuth refresh tokens");
    expect(search.stdout).toContain(entry.path);
    expect(search.stdout).toContain("archive");
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

  it("reviews candidates from the CLI", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run("write", "/scratch/candidate.md", "Preference: Candidate inbox should approve durable memory.");

    await run("promote", "/scratch/candidate.md", "--to", "/preferences.md");
    const candidates = await run("candidates", "--json");
    const parsed = JSON.parse(candidates.stdout) as Array<{ id: string; status: string; promotion_target_path: string }>;
    expect(parsed[0]?.status).toBe("candidate");
    expect(parsed[0]?.promotion_target_path).toBe("/preferences.md");

    const show = await run("candidate", "show", parsed[0]!.id);
    expect(show.stdout).toContain("Candidate inbox");

    const edit = await run("candidate", "edit", parsed[0]!.id, "--summary", "Preference: Candidate inbox approvals use durable targets.");
    expect(edit.stdout).toContain("durable targets");

    const approve = await run("candidate", "approve", parsed[0]!.id);
    expect(approve.stdout).toContain("approved");

    const cat = await run("cat", "/preferences.md");
    expect(cat.stdout).toContain("Candidate inbox approvals");
  });

  it("filters duplicate and conflicting candidates from the CLI", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");

    await run("write", "/scratch/duplicate.md", "Preference: CLI duplicate candidates use pnpm.");
    await run("promote", "/scratch/duplicate.md", "--to", "/preferences.md");
    await run("promote", "/scratch/duplicate.md", "--to", "/preferences.md");
    const duplicates = JSON.parse((await run("candidates", "--duplicates", "--json")).stdout) as Array<{
      id: string;
      status: string;
      duplicate_of: string | null;
    }>;
    expect(duplicates.some((candidate) => candidate.status === "duplicate" && candidate.duplicate_of)).toBe(true);

    await run(
      "write",
      "/projects/auth/constraints.md",
      "Constraint: Auth project stores OAuth refresh tokens in browser local storage during alpha.",
      "--allow-protected"
    );
    await run(
      "write",
      "/scratch/auth-conflict.md",
      "Constraint: Auth project must not store OAuth refresh tokens in browser local storage. Store refresh tokens server-side only."
    );
    await run("promote", "/scratch/auth-conflict.md", "--to", "/projects/auth/constraints.md");
    const conflicts = JSON.parse((await run("candidates", "--conflicts", "--json")).stdout) as Array<{
      id: string;
      status: string;
      conflicts_with: string[];
    }>;
    const conflict = conflicts.find((candidate) => candidate.status === "conflicted");
    expect(conflict?.conflicts_with.length).toBeGreaterThan(0);

    const blocked = await run("candidate", "approve", conflict!.id);
    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain("Conflicting candidates require resolution");

    const resolved = await run(
      "candidate",
      "resolve-conflict",
      conflict!.id,
      "--mode",
      "mark_superseded",
      "--reason",
      "Server-side storage replaces the alpha local-storage constraint."
    );
    expect(resolved.stdout).toContain("candidate");

    const approved = await run("candidate", "approve", conflict!.id);
    expect(approved.stdout).toContain("approved");
  });

  it("compiles and lists run reasoning lessons", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");

    const created = await run("run", "create", "Debug large uploads", "--json");
    const runRecord = JSON.parse(created.stdout) as { id: string; run_path: string };
    await run("run", "complete", runRecord.id, "Use signed upload URLs and upload directly to object storage.");
    await run(
      "write",
      `${runRecord.run_path}/errors.md`,
      "Large upload failed because the serverless function timed out while proxying the binary."
    );

    const compiled = await run("run", "compile", runRecord.id, "--reasoning", "--json");
    const compiledJson = JSON.parse(compiled.stdout) as { reasoning_candidates: Array<{ type: string; status: string; source_run: string }> };
    expect(compiledJson.reasoning_candidates[0]).toMatchObject({
      type: "reasoning_memory",
      status: "candidate",
      source_run: runRecord.run_path
    });

    const lessons = await run("run", "lessons", runRecord.id);
    expect(lessons.stdout).toContain("source_run:");
    expect(lessons.stdout).toContain(runRecord.run_path);
  });

  it("returns structured pre-task brief JSON with project scope", async () => {
    await run("workspace", "create", "demo");
    await run("use", "demo");
    await run(
      "write",
      "/projects/auth/decisions.md",
      "Decision: Auth OAuth refresh tokens stay server-side for CLI briefs.",
      "--allow-protected"
    );
    await run(
      "write",
      "/projects/auth/constraints.md",
      "Constraint: Auth OAuth refresh token flow must avoid browser storage.",
      "--allow-protected"
    );

    const brief = await run("brief", "Fix OAuth refresh token flow", "--project", "auth", "--json");
    const parsed = JSON.parse(brief.stdout) as {
      sections: {
        decisions: Array<{ source: { source_path: string; trust_level: string }; status: string }>;
        constraints: Array<{ source: { source_path: string } }>;
      };
      memory_results: Array<{ project_slug: string; raw_content?: string }>;
    };

    expect(parsed.sections.decisions[0]?.source.source_path).toBe("/projects/auth/decisions.md");
    expect(parsed.sections.decisions[0]?.source.trust_level).toBeTruthy();
    expect(parsed.sections.constraints[0]?.source.source_path).toBe("/projects/auth/constraints.md");
    expect(parsed.memory_results.every((result) => result.project_slug === "auth")).toBe(true);
    expect(parsed.memory_results.some((result) => result.raw_content)).toBe(false);
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
