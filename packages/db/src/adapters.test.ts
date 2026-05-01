import { describe, expect, it } from "vitest";
import { PostgresMetadataStore, type MetadataBlob, type MetadataFile, type MetadataMemoryNode } from "./adapters.js";

describe("metadata adapters", () => {
  it("PostgresMetadataStore can create workspace, file, blob, and memory node with the test fallback", async () => {
    const store = new PostgresMetadataStore();
    await store.initialize();
    try {
      const workspace = await store.createWorkspace("team-demo");
      const blob: MetadataBlob = {
        sha256: "sha-test",
        storage_path: "blobs/sh/sha-test",
        content_text: "Decision: Postgres metadata adapter stores nodes.",
        mime_type: "text/markdown",
        size_bytes: 48,
        created_at: new Date().toISOString()
      };
      const file: MetadataFile = {
        id: "file-test",
        workspace_id: workspace.id,
        path: "/scratch/postgres.md",
        current_blob_sha256: blob.sha256,
        mime_type: blob.mime_type,
        size_bytes: blob.size_bytes,
        created_at: blob.created_at,
        updated_at: blob.created_at
      };
      const node: MetadataMemoryNode = {
        id: "node-test",
        workspace_id: workspace.id,
        source_file_id: file.id,
        source_blob_sha256: blob.sha256,
        summary: "The Postgres metadata adapter stores memory nodes.",
        trigger: "Recall when testing team metadata storage.",
        detail: "This exercises the adapter boundary used by team and cloud mode.",
        raw_excerpt: "Postgres metadata adapter stores nodes.",
        raw_ref: "memoryfs://team-demo/file-test/sha-test",
        source_location_json: JSON.stringify({ type: "markdown" }),
        tags_json: JSON.stringify(["postgres", "metadata", "adapter"]),
        memory_type: "fact",
        importance: 3,
        confidence: 0.8,
        trust_level: "source_backed",
        status: "active",
        ttl_expires_at: null,
        created_at: blob.created_at,
        updated_at: blob.created_at
      };

      await store.putBlob(blob);
      await store.putFile(file);
      await store.putMemoryNode(node);

      expect(await store.listWorkspaces()).toEqual([workspace]);
      expect(await store.getMemoryNode(node.id)).toMatchObject({
        id: node.id,
        source_file_id: file.id,
        source_blob_sha256: blob.sha256
      });
    } finally {
      await store.close();
    }
  });
});
