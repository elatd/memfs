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

  it("creates, explains, and deletes typed graph links through the API", async () => {
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
        path: "/scratch/api-graph-a.md",
        content: "Decision: API graph links should be stable.",
        ingest: true
      }
    });
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/files/write`,
      payload: {
        path: "/scratch/api-graph-b.md",
        content: "Constraint: API graph links should keep source references.",
        ingest: true
      }
    });

    const nodesResponse = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/memory/nodes`
    });
    const nodes = nodesResponse.json() as Array<{ id: string; source_path: string }>;
    const first = nodes.find((node) => node.source_path === "/scratch/api-graph-a.md")!;
    const second = nodes.find((node) => node.source_path === "/scratch/api-graph-b.md")!;

    const link = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/graph/links`,
      payload: {
        from_node_id: first.id,
        to_node_id: second.id,
        relation_type: "supports",
        confidence: 0.93,
        reason: "API graph test"
      }
    });
    const edge = link.json() as { id: string; relation_type: string };
    expect(link.statusCode).toBe(200);
    expect(edge.relation_type).toBe("supports");

    const related = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/memory/graph/nodes/${first.id}/related`
    });
    expect((related.json() as Array<{ node: { id: string } }>).some((entry) => entry.node.id === second.id)).toBe(true);

    const pathResponse = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/memory/graph/path?from_node_id=${first.id}&to_node_id=${second.id}`
    });
    expect((pathResponse.json() as { found: boolean }).found).toBe(true);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/workspaces/${workspace.id}/memory/graph/links/${edge.id}`
    });
    expect((deleted.json() as { deleted: boolean }).deleted).toBe(true);
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

  it("supports dashboard candidate review actions", async () => {
    const workspaceResponse = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "demo" }
    });
    const workspace = workspaceResponse.json() as { id: string };

    const create = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/candidates`,
      payload: {
        memory_text: "Decision: OAuth refresh tokens should be reviewed before promotion.",
        type: "decision",
        promotion_target_path: "/preferences.md",
        reason: "Proposed by dashboard test.",
        actor: "agent:test"
      }
    });
    const candidate = create.json() as { id: string; status: string };
    expect(create.statusCode).toBe(200);
    expect(candidate.status).toBe("candidate");

    const edit = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/candidates/${candidate.id}/update`,
      payload: {
        memory_text: "Decision: OAuth refresh tokens are rotated server-side.",
        type: "decision",
        scope: "project",
        project_slug: "auth",
        tags: ["oauth", "tokens", "auth"],
        promotion_target_path: "/projects/auth/decisions.md",
        reason: "Edited in review inbox.",
        actor: "human:test"
      }
    });
    const edited = edit.json() as {
      id: string;
      memory_text: string;
      scope: string;
      promotion_target_path: string;
      node: { tags: string[]; project_slug: string | null };
    };
    expect(edit.statusCode).toBe(200);
    expect(edited.memory_text).toContain("rotated server-side");
    expect(edited.scope).toBe("project");
    expect(edited.node.project_slug).toBe("auth");
    expect(edited.node.tags).toContain("oauth");
    expect(edited.promotion_target_path).toBe("/projects/auth/decisions.md");

    const approve = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/candidates/${candidate.id}/approve`,
      payload: { reviewer: "human:test", apply: true }
    });
    expect(approve.statusCode).toBe(200);
    expect((approve.json() as { status: string }).status).toBe("approved");

    const durable = await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/files/read?path=${encodeURIComponent("/projects/auth/decisions.md")}`
    });
    expect((durable.json() as { content: string }).content).toContain("rotated server-side");

    const rejectCreate = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/candidates`,
      payload: {
        memory_text: "Fact: Temporary dashboard rejection sentinel.",
        reason: "Should be rejected.",
        actor: "agent:test"
      }
    });
    const rejectedCandidate = rejectCreate.json() as { id: string };
    const reject = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/candidates/${rejectedCandidate.id}/reject`,
      payload: { reviewer: "human:test", comment: "Not durable." }
    });
    expect((reject.json() as { status: string }).status).toBe("rejected");

    const staleCreate = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/candidates`,
      payload: {
        memory_text: "Fact: Dashboard stale/conflict sentinel.",
        reason: "Needs lifecycle flags.",
        actor: "agent:test"
      }
    });
    const staleCandidate = staleCreate.json() as { id: string };
    const stale = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/candidates/${staleCandidate.id}/update`,
      payload: { status: "stale", reason: "Outdated.", actor: "human:test" }
    });
    expect((stale.json() as { status: string }).status).toBe("stale");
    const conflicted = await app.inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/memory/candidates/${staleCandidate.id}/update`,
      payload: { status: "conflicted", reason: "Contradicts newer memory.", actor: "human:test" }
    });
    expect((conflicted.json() as { status: string }).status).toBe("conflicted");

    const events = (await app.inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/audit-events`
    })).json() as Array<{ event_type: string }>;
    const eventTypes = events.map((event) => event.event_type);
    expect(eventTypes).toContain("candidate.edited");
    expect(eventTypes).toContain("candidate.approved");
    expect(eventTypes).toContain("candidate.rejected");
    expect(eventTypes).toContain("candidate.marked_stale");
    expect(eventTypes).toContain("candidate.marked_conflicted");
  });
});
