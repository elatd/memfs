#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/index.ts");
const result = spawnSync("tsx", [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});

process.exitCode = result.status ?? 1;
