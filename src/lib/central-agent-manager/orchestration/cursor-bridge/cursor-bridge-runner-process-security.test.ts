import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileCursorBridgeRunnerLockStore } from "./cursor-bridge-runner-file-lock";
import { saveBudgetStateToFile, loadBudgetStateFromFile } from "./cursor-bridge-runner-budget-file";
import { createEmptyBudgetState } from "./cursor-bridge-runner-budget";

const NOW = new Date("2026-10-26T12:00:00.000Z");

test("lock release ignores foreign runner id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-lock-owner-"));
  const lockPath = join(dir, "runner.lock.json");
  const store = new FileCursorBridgeRunnerLockStore();
  try {
    await store.tryAcquire(lockPath, { runnerId: "owner-a", pid: 10, acquiredAt: NOW.toISOString() });
    await store.release(lockPath, "owner-b");
    const still = await store.read(lockPath);
    assert.equal(still?.runnerId, "owner-a");
    await store.release(lockPath, "owner-a");
    assert.equal(await store.read(lockPath), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lock path traversal segments stay under provided base directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-lock-traverse-"));
  const store = new FileCursorBridgeRunnerLockStore();
  const nested = join(dir, "nested", "runner.lock.json");
  try {
    const acquired = await store.tryAcquire(nested, {
      runnerId: "runner-safe",
      pid: 1,
      acquiredAt: NOW.toISOString(),
    });
    assert.equal(acquired, true);
    assert.ok(nested.startsWith(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget save uses atomic replace without leaving temp file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-budget-atomic-"));
  const budgetPath = join(dir, "budget.json");
  try {
    const state = createEmptyBudgetState(NOW);
    state.createsToday = 2;
    await saveBudgetStateToFile(budgetPath, state);
    const raw = await readFile(budgetPath, "utf8");
    const loaded = await loadBudgetStateFromFile(budgetPath, NOW);
    assert.equal(loaded.createsToday, 2);
    assert.doesNotMatch(raw, /\.tmp-/);
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(dir));
    assert.equal(entries.filter((name) => name.includes(".tmp-")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tampered emergency stop file is still detected via existence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-estop-"));
  const stopPath = join(dir, "emergency-stop");
  try {
    await writeFile(stopPath, "STOP\n", "utf8");
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(stopPath), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
