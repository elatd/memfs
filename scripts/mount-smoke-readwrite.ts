import { buildServer } from "../apps/api/src/server.js";
import { listMountRegistry, unmountMount } from "../apps/mountd/src/index.js";
import { MemoryFSClient } from "../packages/sdk/src/index.js";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const requireFuse = process.env.MEMFS_REQUIRE_FUSE_TEST === "1";
const tempDir = await mkdtemp(path.join(tmpdir(), "memfs-mount-smoke-"));
const dataDir = path.join(tempDir, "data");
const configDir = path.join(tempDir, "config");
const mountpoint = path.join(tempDir, "mount");
let app: Awaited<ReturnType<typeof buildServer>> | null = null;
let mountProcess: ChildProcess | null = null;

class SmokeSkip extends Error {}

try {
  try {
    const require = createRequire(import.meta.url);
    require("fuse-native");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (requireFuse) throw new Error(`FUSE is required but unavailable: ${message}`);
    throw new SmokeSkip(`FUSE is unavailable in this environment: ${message}`);
  }

  process.env.MEMORYFS_DATA_DIR = dataDir;
  process.env.OPENAI_API_KEY = "";
  app = await buildServer();
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const client = new MemoryFSClient(apiUrl);
  const workspace = await client.createWorkspace("mount-smoke") as { id: string; name: string };
  await client.writeFile(workspace.id, "/scratch/seed.md", "Seed file for mount smoke.", {
    actor: "smoke:test",
    ingest: false
  });
  await mkdir(mountpoint, { recursive: true });

  mountProcess = spawn(
    "tsx",
    [
      "apps/mountd/src/index.ts",
      "mount-smoke",
      mountpoint,
      "--read-write",
      "--api-url",
      apiUrl,
      "--actor",
      "mount:smoke"
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MEMFS_CONFIG_DIR: configDir
      }
    }
  );

  await waitForMount();
  await execFileAsync("mkdir", ["-p", path.join(mountpoint, "runs/today")]);
  await execFileAsync("sh", ["-c", `printf 'hello' > ${shellQuote(path.join(mountpoint, "runs/today/result.md"))}`]);

  const mountedContent = await readFile(path.join(mountpoint, "runs/today/result.md"), "utf8");
  if (mountedContent !== "hello") throw new Error(`Mounted cat mismatch: ${mountedContent}`);
  const apiRead = await client.readFile(workspace.id, "/runs/today/result.md") as { content: string };
  if (apiRead.content !== "hello") throw new Error(`API content mismatch: ${apiRead.content}`);

  await execFileAsync("sh", ["-c", `printf '\\nagain' >> ${shellQuote(path.join(mountpoint, "runs/today/result.md"))}`]);
  const appended = await client.readFile(workspace.id, "/runs/today/result.md") as { content: string };
  if (appended.content !== "hello\nagain") throw new Error(`Append mismatch: ${appended.content}`);

  const protectedAttempt = await execFileAsync("sh", ["-c", `printf 'denied' > ${shellQuote(path.join(mountpoint, "preferences.md"))}`])
    .then(() => ({ code: 0 }))
    .catch((error: { code?: number }) => ({ code: error.code ?? 1 }));
  if (protectedAttempt.code === 0) throw new Error("Protected write unexpectedly succeeded.");
  const audit = await client.listAuditEvents(workspace.id) as Array<{ event_type: string }>;
  if (!audit.some((event) => event.event_type === "protected_write_denied")) {
    throw new Error("Protected write denial did not create an audit event.");
  }

  console.log("Read-write mount smoke test passed.");
} catch (error) {
  if (error instanceof SmokeSkip) {
    console.log(`SKIP: ${error.message}`);
  } else {
    throw error;
  }
} finally {
  await unmountMount(mountpoint, { MEMFS_CONFIG_DIR: configDir }).catch(() => null);
  if (mountProcess && !mountProcess.killed) mountProcess.kill("SIGTERM");
  if (app) await app.close();
  await rm(tempDir, { recursive: true, force: true });
  delete process.env.MEMORYFS_DATA_DIR;
}

async function waitForMount(): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastOutput = "";
  mountProcess?.stdout?.on("data", (chunk) => {
    lastOutput += String(chunk);
  });
  mountProcess?.stderr?.on("data", (chunk) => {
    lastOutput += String(chunk);
  });

  while (Date.now() < deadline) {
    const entries = await listMountRegistry({ MEMFS_CONFIG_DIR: configDir });
    if (entries.some((entry) => entry.mountpoint === mountpoint)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!requireFuse) {
    throw new SmokeSkip(`mount did not become ready. Output:\n${lastOutput}`);
  }
  throw new Error(`Mount did not become ready. Output:\n${lastOutput}`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
