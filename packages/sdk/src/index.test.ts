import { afterEach, describe, expect, it, vi } from "vitest";
import { MemFSClient } from "./index.js";

interface FetchCall {
  url: URL;
  method: string;
  body: unknown;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MemFSClient", () => {
  it("remembers candidate memory by default without approving protected durable memory", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.pathname === "/workspaces") {
        return [{ id: "ws-1", name: "doozy" }];
      }
      if (call.method === "POST" && call.url.pathname === "/workspaces/ws-1/memory/candidates") {
        return { id: "candidate-1", status: "candidate", body: call.body };
      }
      throw new Error(`Unexpected request: ${call.method} ${call.url.pathname}`);
    });
    const memfs = new MemFSClient({ apiUrl: "http://localhost:3131" });

    const remembered = await memfs.remember({
      workspace: "doozy",
      text: "The user prefers Netlify Functions for backend MVPs.",
      scope: "workspace",
      source: "explicit_user_instruction"
    });

    expect(remembered.status).toBe("candidate");
    expect(calls.some((call) => call.url.pathname.includes("/approve"))).toBe(false);
    const create = calls.find((call) => call.url.pathname === "/workspaces/ws-1/memory/candidates")!;
    expect(create.body).toMatchObject({
      memory_text: "The user prefers Netlify Functions for backend MVPs.",
      memory_type: "preference",
      promotion_target_path: "/preferences.md",
      actor: "agent:sdk"
    });
  });

  it("can explicitly approve a remembered user instruction through the candidate workflow", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.pathname === "/workspaces") {
        return [{ id: "ws-1", name: "doozy" }];
      }
      if (call.method === "POST" && call.url.pathname === "/workspaces/ws-1/memory/candidates") {
        return { id: "candidate-1", status: "candidate" };
      }
      if (call.method === "POST" && call.url.pathname === "/workspaces/ws-1/memory/candidates/candidate-1/approve") {
        return { id: "candidate-1", status: "approved", body: call.body };
      }
      throw new Error(`Unexpected request: ${call.method} ${call.url.pathname}`);
    });
    const memfs = new MemFSClient({ apiUrl: "http://localhost:3131", actor: "human:test" });

    const remembered = await memfs.remember({
      workspace: "doozy",
      text: "Preference: Use Netlify Functions for backend MVPs.",
      source: "explicit_user_instruction",
      approved: true,
      reviewer: "human:test"
    });

    expect(remembered.status).toBe("approved");
    const approve = calls.find((call) => call.url.pathname.endsWith("/approve"))!;
    expect(approve.body).toMatchObject({
      reviewer: "human:test",
      target_path: "/preferences.md",
      apply: true
    });
  });

  it("supports the high-level run flow", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.pathname === "/workspaces") {
        return [{ id: "ws-1", name: "doozy" }];
      }
      if (call.method === "POST" && call.url.pathname === "/workspaces/ws-1/runs") {
        return runPacket("created");
      }
      if (call.method === "POST" && call.url.pathname === "/workspaces/ws-1/runs/run-1/start") {
        return runPacket("running");
      }
      if (call.method === "GET" && call.url.pathname === "/workspaces/ws-1/files/read") {
        return jsonError("File not found.", 404);
      }
      if (call.method === "POST" && call.url.pathname === "/workspaces/ws-1/files/write") {
        return { path: "/runs/run-1/result.md", body: call.body };
      }
      if (call.method === "POST" && call.url.pathname === "/workspaces/ws-1/runs/run-1/events") {
        return { id: "event-1" };
      }
      if (call.method === "POST" && call.url.pathname === "/workspaces/ws-1/runs/run-1/complete") {
        return runPacket("completed");
      }
      if (call.method === "POST" && call.url.pathname === "/workspaces/ws-1/runs/run-1/compile") {
        return { reasoning_candidates: [] };
      }
      throw new Error(`Unexpected request: ${call.method} ${call.url.pathname}`);
    });
    const memfs = new MemFSClient({ apiUrl: "http://localhost:3131" });

    const run = await memfs.runs.start({
      workspace: "doozy",
      task: "Fix OAuth refresh tokens"
    });
    await memfs.runs.append(run.id, {
      kind: "result",
      text: "Refresh token rotation fixed."
    });
    await memfs.runs.finish(run.id);
    await memfs.runs.compile(run.id, { reasoning: true });

    expect(run.status).toBe("running");
    expect(calls.some((call) => call.url.pathname === "/workspaces/ws-1/runs/run-1/start")).toBe(true);
    expect(calls.find((call) => call.url.pathname === "/workspaces/ws-1/files/write")?.body).toMatchObject({
      path: "/runs/run-1/result.md",
      content: "Refresh token rotation fixed.",
      ingest: false,
      run_id: "run-1"
    });
    expect(calls.find((call) => call.url.pathname === "/workspaces/ws-1/runs/run-1/compile")?.body).toMatchObject({
      reasoning: true
    });
  });
});

function mockFetch(handler: (call: FetchCall) => unknown): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const call = { url, method, body };
      calls.push(call);
      const response = handler(call);
      if (response instanceof Response) return response;
      return jsonResponse(response);
    })
  );
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function jsonError(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function runPacket(status: string) {
  return {
    id: "run-1",
    workspace_id: "ws-1",
    title: "Fix OAuth refresh tokens",
    task: "Fix OAuth refresh tokens",
    actor: "agent:sdk",
    status,
    run_path: "/runs/run-1",
    created_at: "2026-05-01T00:00:00.000Z",
    completed_at: status === "completed" ? "2026-05-01T00:01:00.000Z" : null
  };
}
