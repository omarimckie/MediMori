import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  InMemoryCursorBridgeRunnerLockStore,
  releaseRunnerLock,
  tryAcquireRunnerLock,
} from "./cursor-bridge-runner-singleton";
import { FileCursorBridgeRunnerLockStore } from "./cursor-bridge-runner-file-lock";

const NOW = "2026-10-26T14:00:00.000Z";

test("in-memory runner lock rejects concurrent acquire for same path", async () => {
  const store = new InMemoryCursorBridgeRunnerLockStore();
  const path = "/locks/runner-a";
  const first = await tryAcquireRunnerLock({
    lockPath: path,
    runnerId: "runner-a",
    pid: 1001,
    now: NOW,
    store,
  });
  const second = await tryAcquireRunnerLock({
    lockPath: path,
    runnerId: "runner-b",
    pid: 1002,
    now: NOW,
    store,
  });
  assert.equal(first, true);
  assert.equal(second, false);
  await releaseRunnerLock({ lockPath: path, runnerId: "runner-a", store });
  const third = await tryAcquireRunnerLock({
    lockPath: path,
    runnerId: "runner-b",
    pid: 1002,
    now: NOW,
    store,
  });
  assert.equal(third, true);
});

test("file runner lock enforces exclusive create and owner release", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-runner-lock-"));
  const lockPath = join(dir, "runner.lock.json");
  const store = new FileCursorBridgeRunnerLockStore();
  try {
    const acquired = await tryAcquireRunnerLock({
      lockPath,
      runnerId: "runner-file",
      pid: 4242,
      now: NOW,
      store,
    });
    assert.equal(acquired, true);
    const blocked = await tryAcquireRunnerLock({
      lockPath,
      runnerId: "runner-other",
      pid: 4243,
      now: NOW,
      store,
    });
    assert.equal(blocked, false);
    await releaseRunnerLock({ lockPath, runnerId: "runner-other", store });
    const stillHeld = await store.read(lockPath);
    assert.equal(stillHeld?.runnerId, "runner-file");
    await releaseRunnerLock({ lockPath, runnerId: "runner-file", store });
    assert.equal(await store.read(lockPath), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
