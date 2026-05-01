import { describe, expect, it } from "vitest";
import { ObjectBlobStore } from "./adapters.js";

describe("storage adapters", () => {
  it("ObjectBlobStore writes and reads blobs through a mocked S3-compatible client", async () => {
    const objects = new Map<string, Uint8Array>();
    const store = new ObjectBlobStore({
      bucket: "memfs-test",
      prefix: "workspace-a",
      client: {
        async putObject(input) {
          objects.set(`${input.bucket}/${input.key}`, input.body);
        },
        async getObject(input) {
          const object = objects.get(`${input.bucket}/${input.key}`);
          if (!object) throw new Error("missing object");
          return object;
        }
      }
    });

    const stored = await store.put(Buffer.from("object storage content"), "text/plain");
    const read = await store.get(stored.sha256);

    expect(stored.storage_path).toContain("workspace-a/blobs/");
    expect(Buffer.from(read).toString("utf8")).toBe("object storage content");
  });
});
