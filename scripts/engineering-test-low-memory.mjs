#!/usr/bin/env node
/**
 * Controlled engineering test profile for memory-constrained hosts (Windows-friendly).
 * Does not change default `npm run test:engineering` behavior.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const heapMb = Number(process.env.ENGINEERING_TEST_HEAP_MB ?? "8192");
if (!Number.isFinite(heapMb) || heapMb < 2048 || heapMb > 32768) {
  console.error("ENGINEERING_TEST_HEAP_MB must be a number between 2048 and 32768.");
  process.exit(2);
}

const concurrency = process.env.ENGINEERING_TEST_CONCURRENCY ?? "1";
const patternArg = process.argv[2] ?? "src/lib/engineering/*.test.ts";
const patterns = patternArg.trim().split(/\s+/).filter(Boolean);

const env = {
  ...process.env,
  NODE_OPTIONS: `--max-old-space-size=${heapMb}`,
};

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  npx,
  ["tsx", "--test", `--test-concurrency=${concurrency}`, ...patterns],
  { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
