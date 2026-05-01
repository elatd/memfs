import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

let tempDir: string;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "memfs-api-test-"));
  process.env.MEMORYFS_DATA_DIR = tempDir;
  process.env.OPENAI_API_KEY = "";
  app = await buildServer();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
  delete process.env.MEMORYFS_DATA_DIR;
  delete process.env.MEMFS_DATA_DIR;
  delete process.env.MEMFS_MODE;
  delete process.env.MEMFS_AUTH_REQUIRED;
  delete process.env.MEMFS_SYNC_ENABLED;
});

describe("recall graph API", () => {
  it("returns contradictions through the endpoint", async () => {
    const workspaceResponse = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "demo" }
    });
    const workspace = workspaceResponse.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/files/write`,
      payload: {
        path: "/scratch/a.md",
        content: "Decision: Onboarding should stay short.",
        ingest: true
      }
    });
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/files/write`,
      payload: {
        path: "/scratch/b.md",
        content: "Decision: Onboarding should not stay short.",
        ingest: true
      }
    });

    const contradictions = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/memory/contradictions`
    });

    expect(contradictions.statusCode).toBe(200);
    expect(contradictions.json() as unknown[]).not.toHaveLength(0);
  });

  it("explain recall returns why and keeps raw hidden", async () => {
    const workspaceResponse = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "demo" }
    });
    const workspace = workspaceResponse.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/files/write`,
      payload: {
        path: "/scratch/why.md",
        content: "Decision: Explain recall through source-backed score components.",
        ingest: true
      }
    });

    const recall = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/explain-recall`,
      payload: {
        query: "explain recall",
        include_raw: false
      }
    });

    const body = recall.json() as { results: Array<{ why?: unknown; raw_content?: string }> };
    expect(recall.statusCode).toBe(200);
    expect(body.results[0]?.why).toBeTruthy();
    expect(body.results[0]?.raw_content).toBeUndefined();
  });

  it("uploads files, stores extracted sources, and returns source locations", async () => {
    const workspaceResponse = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "demo" }
    });
    const workspace = workspaceResponse.json() as { id: string };

    const upload = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/files/upload`,
      payload: {
        path: "/uploads/status.csv",
        content_base64: Buffer.from("decision,status\nKeep source locations,open").toString("base64"),
        mime_type: "text/csv",
        ingest: true
      }
    });
    const file = upload.json() as { id: string };
    expect(upload.statusCode).toBe(200);

    const extracted = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/files/${file.id}/extracted`
    });
    expect((extracted.json() as Array<{ extractor_name: string }>)[0]?.extractor_name).toBe("csv");

    const recall = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/recall`,
      payload: {
        query: "source locations decision",
        include_detail: true
      }
    });
    const result = (recall.json() as { results: Array<{ node_id: string; source_location?: unknown }> }).results[0]!;
    expect(result.source_location).toMatchObject({ type: "csv" });

    const source = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/memory/nodes/${result.node_id}/source`
    });
    expect((source.json() as { source_kind: string }).source_kind).toBe("csv");
  });

  it("exposes promotion, snapshot, and health endpoints", async () => {
    const workspaceResponse = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "demo" }
    });
    const workspace = workspaceResponse.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/files/write`,
      payload: {
        path: "/scratch/promote.md",
        content: "Preference: API promotions require review.",
        ingest: true
      }
    });

    const promotionResponse = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/promote`,
      payload: {
        source_path: "/scratch/promote.md",
        target_path: "/preferences.md",
        actor: "agent:test",
        require_review: true
      }
    });
    const promotion = promotionResponse.json() as { id: string; status: string };
    expect(promotion.status).toBe("pending");

    const approve = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/promotions/${promotion.id}/approve`,
      payload: { reviewer: "human:test", apply: true }
    });
    expect((approve.json() as { status: string }).status).toBe("applied");

    const snapshotResponse = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/snapshots`,
      payload: { name: "api-snapshot", actor: "human:test" }
    });
    const snapshot = snapshotResponse.json() as { id: string };
    const diff = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/snapshots/${snapshot.id}/diff`
    });
    expect(diff.statusCode).toBe(200);

    const health = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/memory/health`
    });
    expect((health.json() as { overall_score: number }).overall_score).toBeTypeOf("number");
  });

  it("exposes sync status, conflicts, and team member endpoints in local mode", async () => {
    const workspaceResponse = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "demo" }
    });
    const workspace = workspaceResponse.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/files/write`,
      payload: {
        path: "/scratch/sync-api.md",
        content: "Decision: API exposes sync and team status.",
        ingest: false
      }
    });

    const status = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/sync/status`
    });
    expect(status.statusCode).toBe(200);
    expect((status.json() as { pending_events: number }).pending_events).toBeGreaterThan(0);

    const conflictPull = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/sync/pull`,
      payload: {
        actor: "agent:test",
        events: [
          {
            id: "remote-protected",
            workspace_id: workspace.id,
            object_type: "files",
            object_id: "remote-file",
            operation: "upsert",
            object_version: new Date().toISOString(),
            payload_json: JSON.stringify({
              id: "remote-file",
              workspace_id: workspace.id,
              path: "/preferences.md",
              current_blob_sha256: "remote",
              mime_type: "text/markdown",
              size_bytes: 6,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              content_base64: Buffer.from("remote").toString("base64")
            }),
            actor: "agent:remote",
            created_at: new Date().toISOString()
          }
        ]
      }
    });
    expect((conflictPull.json() as { conflicts: unknown[] }).conflicts).toHaveLength(1);

    const member = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/team/members`,
      payload: {
        handle: "agent:api",
        role: "agent"
      }
    });
    expect((member.json() as { handle: string; role: string }).role).toBe("agent");

    const members = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/team/members`
    });
    expect((members.json() as Array<{ handle: string }>)[0]?.handle).toBe("agent:api");
  });

  it("requires actor authentication when auth is enabled", async () => {
    await app.close();
    process.env.MEMFS_AUTH_REQUIRED = "true";
    app = await buildServer();

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/workspaces"
    });
    const health = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(health.statusCode).toBe(200);
  });
});
