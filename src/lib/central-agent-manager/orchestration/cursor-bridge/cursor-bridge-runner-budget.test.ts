import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  budgetAllowsCycle,
  normalizeBudgetState,
  reserveDailyCreateSlot,
} from "./cursor-bridge-runner-budget";
import {
  CursorBridgeRunnerBudgetFileError,
  loadBudgetStateFromFile,
  saveBudgetStateToFile,
} from "./cursor-bridge-runner-budget-file";

const NOW = "2026-04-10T12:00:00.000Z";
const LIMITS = { dailyCreateBudget: 1, hourlyCycleLimit: 10 };

test("reserveDailyCreateSlot persists before external create and blocks second reservation", () => {
  const now = new Date(NOW);
  let state = normalizeBudgetState(null, now);
  state = reserveDailyCreateSlot(state, LIMITS, now);
  assert.equal(state.createsToday, 1);
  assert.throws(() => reserveDailyCreateSlot(state, LIMITS, now), /daily_create_budget/);
});

test("missing budget file normalizes to zero usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-budget-missing-"));
  const budgetPath = join(dir, "budget.json");
  try {
    const state = await loadBudgetStateFromFile(budgetPath, new Date(NOW));
    assert.equal(state.createsToday, 0);
    assert.equal(state.cyclesThisHour, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt budget file fails closed at load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-budget-corrupt-"));
  const budgetPath = join(dir, "budget.json");
  try {
    await writeFile(budgetPath, "{not-json", "utf8");
    await assert.rejects(
      () => loadBudgetStateFromFile(budgetPath, new Date(NOW)),
      CursorBridgeRunnerBudgetFileError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("explicitly initialized budget file loads persisted counters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-budget-init-"));
  const budgetPath = join(dir, "budget.json");
  try {
    const now = new Date(NOW);
    let state = normalizeBudgetState(null, now);
    state = reserveDailyCreateSlot(state, LIMITS, now);
    await saveBudgetStateToFile(budgetPath, state);
    const reloaded = await loadBudgetStateFromFile(budgetPath, now);
    assert.equal(reloaded.createsToday, 1);
    assert.equal(budgetAllowsCycle(reloaded, LIMITS, true).allowed, false);
    const raw = await readFile(budgetPath, "utf8");
    assert.match(raw, /"createsToday":1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restart reloads reserved create capacity after simulated crash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cam-budget-crash-"));
  const budgetPath = join(dir, "budget.json");
  try {
    const now = new Date(NOW);
    let state = normalizeBudgetState(null, now);
    state = reserveDailyCreateSlot(state, LIMITS, now);
    await saveBudgetStateToFile(budgetPath, state);
    const reloaded = await loadBudgetStateFromFile(budgetPath, now);
    assert.equal(reloaded.createsToday, 1);
    assert.equal(budgetAllowsCycle(reloaded, LIMITS, true).allowed, false);
    const raw = await readFile(budgetPath, "utf8");
    assert.match(raw, /"createsToday":1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
