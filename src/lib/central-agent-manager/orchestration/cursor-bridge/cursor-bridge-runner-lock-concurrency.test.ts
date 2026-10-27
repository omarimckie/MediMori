import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  InMemoryCursorBridgeRunnerLockStore,
  tryAcquireRunnerLock,
} from "./cursor-bridge-runner-singleton";
import { FileCursorBridgeRunnerLockStore } from "./cursor-bridge-runner-file-lock";
import { CURSOR_BRIDGE_SINGLE_RUNNER_POLICY } from "./cursor-bridge-runner-lock-policy";

const NOW = "2026-10-26T15:00:00.000Z";

test("concurrent startup: only one runner acquires lock", async () => {
  const store = new InMemoryCursorBridgeRunnerLockStore();
  const path = "/locks/concurrent";
  const results = await Promise.all(
    ["a", "b", "c"].map((id) =>
      tryAcquireRunnerLock({ lockPath: path, runnerId: id, pid: 100, now: NOW, store }),
    ),
  );
  assert.equal(results.filter(Boolean).length, 1);
});

test("tampered lock file is treated as unreadable on acquire retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-lock-tamper-"));
  const lockPath = join(dir, "runner.lock.json");
  const store = new FileCursorBridgeRunnerLockStore();
  try {
    await writeFile(lockPath, "{not-json", "utf8");
    const read = await store.read(lockPath);
    assert.equal(read, null);
    const acquired = await tryAcquireRunnerLock({
      lockPath,
      runnerId: "runner-fresh",
      pid: 1,
      now: NOW,
      store,
    });
    assert.equal(acquired, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("single-runner policy documents no distributed exactly-once", () => {
  assert.equal(CURSOR_BRIDGE_SINGLE_RUNNER_POLICY.distributedExactlyOnce, false);
  assert.equal(CURSOR_BRIDGE_SINGLE_RUNNER_POLICY.maxConcurrentRunnersPerHost, 1);
});
