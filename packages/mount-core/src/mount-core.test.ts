import { MemoryFS } from "@memoryfs/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoreMountClient, createMountCore, type MountClient } from "./index.js";

let tempDir: string;
let memoryfs: MemoryFS;
let workspaceId: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "memfs-mount-core-test-"));
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

describe("mount-core", () => {
  it("lists root with workspace files and the control directory", async () => {
    await memoryfs.writeFile(workspaceId, "/runs/today/result.md", "hello", { ingest: false });
    const mount = testMount("read-only");

    const entries = await mount.list("/");

    expect(entries.map((entry) => entry.name)).toContain("runs");
    expect(entries.map((entry) => entry.name)).toContain(".memfs");
  });

  it("reads workspace files as bytes", async () => {
    await memoryfs.writeFile(workspaceId, "/runs/today/result.md", "hello", { ingest: false });
    const mount = testMount("read-only");

    const content = Buffer.from(await mount.read("/runs/today/result.md")).toString("utf8");

    expect(content).toBe("hello");
  });

  it("creates and overwrites files through core", async () => {
    const mount = testMount("read-write");

    await mount.write("/runs/today/result.md", Buffer.from("hello"));
    await mount.write("/runs/today/result.md", Buffer.from("changed"));

    const read = await memoryfs.readFile(workspaceId, "/runs/today/result.md");
    expect(read.content).toBe("changed");
    expect(memoryfs.listAuditEvents(workspaceId).some((event) => event.event_type === "mount.file.write")).toBe(true);
  });

  it("appends file content", async () => {
    const mount = testMount("read-write");

    await mount.write("/runs/today/result.md", Buffer.from("hello"));
    await mount.append("/runs/today/result.md", Buffer.from("\nagain"));

    const read = await memoryfs.readFile(workspaceId, "/runs/today/result.md");
    expect(read.content).toBe("hello\nagain");
  });

  it("deletes files through core", async () => {
    await memoryfs.writeFile(workspaceId, "/runs/today/result.md", "hello", { ingest: false });
    const mount = testMount("read-write");

    await mount.unlink("/runs/today/result.md");

    await expect(memoryfs.readFile(workspaceId, "/runs/today/result.md")).rejects.toThrow();
    expect(memoryfs.listAuditEvents(workspaceId).some((event) => event.event_type === "mount.file.delete")).toBe(true);
  });

  it("tracks transient directories and removes empty ones", async () => {
    const mount = testMount("read-write");

    await mount.mkdir("/runs/today");
    expect((await mount.list("/runs")).map((entry) => entry.name)).toContain("today");
    await mount.rmdir("/runs/today");

    await expect(mount.list("/runs")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("renames files as write then delete", async () => {
    await memoryfs.writeFile(workspaceId, "/runs/today/result.md", "hello", { ingest: false });
    const mount = testMount("read-write");

    await mount.rename("/runs/today/result.md", "/runs/today/final.md");

    expect((await memoryfs.readFile(workspaceId, "/runs/today/final.md")).content).toBe("hello");
    await expect(memoryfs.readFile(workspaceId, "/runs/today/result.md")).rejects.toThrow();
  });

  it("truncates files", async () => {
    await memoryfs.writeFile(workspaceId, "/runs/today/result.md", "hello", { ingest: false });
    const mount = testMount("read-write");

    await mount.truncate("/runs/today/result.md", 2);
    expect((await memoryfs.readFile(workspaceId, "/runs/today/result.md")).content).toBe("he");

    await mount.truncate("/runs/today/result.md", 0);
    expect((await memoryfs.readFile(workspaceId, "/runs/today/result.md")).content).toBe("");
  });

  it("rejects writes on a read-only mount", async () => {
    const mount = testMount("read-only");

    await expect(mount.write("/runs/today/result.md", Buffer.from("hello"))).rejects.toMatchObject({
      code: "EROFS",
      mountCode: "MOUNT_READ_ONLY"
    });
  });

  it("denies protected writes by default and lets core audit the denial", async () => {
    const mount = testMount("read-write");

    await expect(mount.write("/preferences.md", Buffer.from("protected"))).rejects.toMatchObject({
      code: "EACCES",
      mountCode: "MOUNT_PROTECTED_PATH_DENIED",
      message: "Protected path denied. Re-run mount with --allow-protected-write or write to /runs/ and promote later."
    });

    expect(memoryfs.listAuditEvents(workspaceId).some((event) => event.event_type === "protected_write_denied")).toBe(true);
    expect(memoryfs.listAuditEvents(workspaceId).some((event) => event.event_type === "mount.protected_write.denied")).toBe(true);
  });

  it("allows protected writes when explicitly configured", async () => {
    const mount = createMountCore({
      workspaceId,
      coreClient: createCoreMountClient(memoryfs),
      mode: "read-write",
      allowProtectedWrite: true
    });

    await mount.write("/preferences.md", Buffer.from("protected"));

    expect((await memoryfs.readFile(workspaceId, "/preferences.md")).content).toBe("protected");
  });

  it("rejects reserved control path writes except query files", async () => {
    const mount = testMount("read-write");

    await expect(mount.write("/.memfs/status.json", Buffer.from("{}"))).rejects.toMatchObject({
      code: "RESERVED_PATH",
      mountCode: "MOUNT_RESERVED_NAMESPACE"
    });
  });

  it("runs recall and search through control query files", async () => {
    await memoryfs.writeFile(workspaceId, "/runs/today/result.md", "Decision: Mounted writes should stay auditable.", {
      ingest: true
    });
    const mount = testMount("read-write");

    await mount.write("/.memfs/recall.query", Buffer.from("mounted writes"));
    const recall = Buffer.from(await mount.read("/.memfs/recall.results.md")).toString("utf8");
    expect(recall).toContain("source_path: /runs/today/result.md");
    expect(recall).toContain("trust:");
    expect(recall).toContain("node_id:");
    expect(recall).toContain("raw_ref:");
    expect(recall).toContain("Raw source content is not returned here");
    expect(recall).toContain("tags:");

    await mount.write("/.memfs/search.query", Buffer.from("auditable"));
    const search = Buffer.from(await mount.read("/.memfs/search.results.md")).toString("utf8");
    expect(search).toContain("source_path: /runs/today/result.md");
    expect(search).toContain("trust:");
    expect(search).toContain("node_id:");
    expect(search).toContain("raw_ref:");
    expect(search).toContain("Raw source content is not returned here");
    const status = JSON.parse(Buffer.from(await mount.read("/.memfs/status.json")).toString("utf8")) as {
      lastRecallAt: string | null;
      lastSearchAt: string | null;
    };
    expect(status.lastRecallAt).toBeTruthy();
    expect(status.lastSearchAt).toBeTruthy();
    const auditEvents = memoryfs.listAuditEvents(workspaceId);
    expect(auditEvents.some((event) => event.event_type === "mount.recall.query")).toBe(true);
    expect(auditEvents.some((event) => event.event_type === "mount.search.query")).toBe(true);
  });

  it("runs pre-task briefs through control query files", async () => {
    await memoryfs.writeFile(workspaceId, "/projects/auth/decisions.md", "Decision: Mounted briefs should remember OAuth refresh tokens stay server-side.", {
      ingest: true,
      allow_protected_write: true
    });
    const mount = testMount("read-write");

    await mount.write("/.memfs/brief.query", Buffer.from("Fix OAuth refresh token flow"));
    const brief = Buffer.from(await mount.read("/.memfs/brief.results.md")).toString("utf8");
    const status = JSON.parse(Buffer.from(await mount.read("/.memfs/status.json")).toString("utf8")) as {
      lastBriefQuery: string | null;
      lastBriefAt: string | null;
    };

    expect(brief).toContain("Brief results");
    expect(brief).toContain("source_path: /projects/auth/decisions.md");
    expect(brief).toContain("trust:");
    expect(brief).toContain("score:");
    expect(brief).toContain("node_id:");
    expect(brief).toContain("raw_ref:");
    expect(brief).toContain("Raw source content is not returned here");
    expect(status.lastBriefQuery).toBe("Fix OAuth refresh token flow");
    expect(status.lastBriefAt).toBeTruthy();
    expect(memoryfs.listAuditEvents(workspaceId).some((event) => event.event_type === "mount.brief.query")).toBe(true);
  });

  it("keeps recall query results scoped to one mount session", async () => {
    await memoryfs.writeFile(workspaceId, "/runs/today/result.md", "Decision: Scoped mount query state matters.", {
      ingest: true
    });
    const first = testMount("read-write");
    const second = testMount("read-write");

    await first.write("/.memfs/recall.query", Buffer.from("scoped query"));

    expect(Buffer.from(await first.read("/.memfs/recall.results.md")).toString("utf8")).toContain("source_path:");
    expect(Buffer.from(await second.read("/.memfs/recall.results.md")).toString("utf8")).toContain("No query has been run.");
  });

  it("does not render raw content in recall results", async () => {
    const mount = createMountCore({
      workspaceId,
      mode: "read-write",
      client: fakeControlClient({
        recallMemory: async () => ({
          query: "secret",
          results: [
            {
              node_id: "node_1",
              type: "memory_node",
              summary: "A safe summary.",
              trigger: "Recall when testing raw gating.",
              tags: ["safe", "raw", "test"],
              memory_type: "fact",
              importance: 3,
              confidence: 0.9,
              scope: "workspace",
              score: 0.99,
              source_path: "/runs/test/result.md",
              raw_ref: "memoryfs://workspace/runs/test/result.md#blob",
              raw_content: "SECRET_RAW_CONTENT"
            }
          ]
        })
      })
    });

    await mount.write("/.memfs/recall.query", Buffer.from("secret"));
    const results = Buffer.from(await mount.read("/.memfs/recall.results.md")).toString("utf8");

    expect(results).toContain("source_path: /runs/test/result.md");
    expect(results).toContain("raw_ref:");
    expect(results).toContain("tags: safe, raw, test");
    expect(results).not.toContain("SECRET_RAW_CONTENT");
  });

  it("renders control files and status metadata", async () => {
    const mount = createMountCore({
      workspaceId,
      coreClient: createCoreMountClient(memoryfs),
      mode: "read-write",
      actor: "mount:test",
      apiUrl: "http://localhost:3131",
      ingestOnWrite: true,
      allowProtectedWrite: true
    });

    const controlEntries = await mount.list("/.memfs");
    expect(controlEntries.map((entry) => entry.name)).toEqual([
      "README.md",
      "status.json",
      "recall.query",
      "recall.results.md",
      "search.query",
      "search.results.md",
      "brief.query",
      "brief.results.md",
      "audit.md",
      "health.md"
    ]);
    const readme = Buffer.from(await mount.read("/.memfs/README.md")).toString("utf8");
    expect(readme).toContain("echo \"What should I remember");
    expect(readme).toContain("brief.query");
    const status = JSON.parse(Buffer.from(await mount.read("/.memfs/status.json")).toString("utf8")) as {
      workspaceId: string;
      workspaceName: string;
      mountedAt: string;
      apiUrl: string;
      actor: string;
      ingestOnWrite: boolean;
      allowProtectedWrite: boolean;
    };
    expect(status.workspaceId).toBe(workspaceId);
    expect(status.workspaceName).toBe("demo");
    expect(status.apiUrl).toBe("http://localhost:3131");
    expect(status.actor).toBe("mount:test");
    expect(status.ingestOnWrite).toBe(true);
    expect(status.allowProtectedWrite).toBe(true);
    expect(new Date(status.mountedAt).toString()).not.toBe("Invalid Date");
  });

  it("fails rm and rename operations involving the reserved namespace", async () => {
    const mount = testMount("read-write");

    await expect(mount.unlink("/.memfs/status.json")).rejects.toMatchObject({ mountCode: "MOUNT_RESERVED_NAMESPACE" });
    await expect(mount.rmdir("/.memfs")).rejects.toMatchObject({ mountCode: "MOUNT_RESERVED_NAMESPACE" });
    await expect(mount.rename("/runs/today/result.md", "/.memfs/result.md")).rejects.toMatchObject({
      mountCode: "MOUNT_RESERVED_NAMESPACE"
    });
    await expect(mount.rename("/.memfs/README.md", "/runs/today/readme.md")).rejects.toMatchObject({
      mountCode: "MOUNT_RESERVED_NAMESPACE"
    });
  });

  it("renders audit and health unsupported messages when client methods are missing", async () => {
    const mount = createMountCore({
      workspaceId,
      mode: "read-only",
      client: fakeControlClient({})
    });

    expect(Buffer.from(await mount.read("/.memfs/audit.md")).toString("utf8")).toContain("Audit events are not supported");
    expect(Buffer.from(await mount.read("/.memfs/health.md")).toString("utf8")).toContain("Memory health is not supported");
  });

  it("ingests mounted writes only when ingestOnWrite is enabled", async () => {
    const noIngest = testMount("read-write");
    await noIngest.write("/runs/no-ingest/result.md", Buffer.from("Decision: This should not create memory."));
    expect(memoryfs.listMemoryNodes(workspaceId).filter((node) => node.source_path === "/runs/no-ingest/result.md")).toHaveLength(0);

    const ingest = createMountCore({
      workspaceId,
      coreClient: createCoreMountClient(memoryfs),
      mode: "read-write",
      actor: "mount:test",
      ingestOnWrite: true
    });
    await ingest.write("/runs/ingest/result.md", Buffer.from("Decision: Mounted ingestion should create agent memory."));
    const nodes = memoryfs.listMemoryNodes(workspaceId).filter((node) => node.source_path === "/runs/ingest/result.md");
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0]?.trust_level).toBe("agent_generated");
  });

  it("reads status json and rejects path traversal", async () => {
    const mount = testMount("read-only");

    const status = JSON.parse(Buffer.from(await mount.read("/.memfs/status.json")).toString("utf8")) as {
      workspaceId: string;
      mode: string;
    };
    expect(status.workspaceId).toBe(workspaceId);
    expect(status.mode).toBe("read-only");

    await expect(mount.read("/../secret.md")).rejects.toMatchObject({
      mountCode: "MOUNT_PATH_TRAVERSAL_REJECTED"
    });
  });
});

function testMount(mode: "read-only" | "read-write") {
  return createMountCore({
    workspaceId,
    coreClient: createCoreMountClient(memoryfs),
    mode,
    actor: "mount:test"
  });
}

function fakeControlClient(overrides: Partial<MountClient>): MountClient {
  return {
    getWorkspace: () => ({
      id: workspaceId,
      name: "demo",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }),
    listFiles: () => [],
    readFile: async () => {
      throw new Error("File not found.");
    },
    ...overrides
  };
}
