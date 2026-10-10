import { test } from "node:test";
import assert from "node:assert/strict";
import { assertBudget, assertExecutable, assertTransition, classifyRisk, limits, parsePlan, protectedOperations } from "./policy";

const plan = { summary: "Fix layout", files: ["src/components/card.tsx"], validations: ["lint"], operations: [] };
test("scope is bounded and commands cannot become shell input", () => {
  assert.deepEqual(parsePlan(plan), plan);
  for (const files of [["../secret"], ["/etc/passwd"], ["src/../secret"], ["x;curl"], Array(21).fill("src/a.ts")]) assert.throws(() => parsePlan({ ...plan, files }));
  assert.throws(() => parsePlan({ ...plan, validations: ["lint; deploy"] }));
  assert.throws(() => parsePlan({ ...plan, operations: ["unknown"] }));
});
test("risk classification fails conservatively for protected paths", () => {
  assert.equal(classifyRisk(parsePlan(plan)), "low");
  assert.equal(classifyRisk(parsePlan({ ...plan, files: ["src/app/api/demo/route.ts"] })), "medium");
  for (const file of ["src/lib/admin-auth.ts", "sql/schema.sql", ".github/workflows/run.yml", "vercel.json", "src/middleware.ts", "src/lib/stripe.ts", "src/lib/marketing/publish.ts"]) assert.equal(classifyRisk(parsePlan({ ...plan, files: [file] })), "high", file);
  assert.equal(classifyRisk(parsePlan({ ...plan, operations: ["production_deploy"] })), "high");
});
test("lifecycle cannot skip approval or exit stopped tasks", () => {
  assertTransition("intake", "analyzing");
  assertTransition("awaiting_approval", "awaiting_execution");
  assertTransition("awaiting_execution", "implementing");
  assert.throws(() => assertTransition("awaiting_approval", "implementing"));
  assert.throws(() => assertTransition("planned", "implementing"));
  assert.throws(() => assertTransition("validating", "awaiting_merge"));
  for (const status of ["blocked", "cancelled", "awaiting_merge", "merging", "completed", "escalated"] as const) assert.throws(() => assertTransition(status, "implementing"));
  assert.throws(() => assertTransition("merging", "cancelled"));
  assert.throws(() => assertTransition("completed", "blocked"));
});
test("hard budgets cover costs, tokens, calls, repair attempts and elapsed time", () => {
  const now = 2000000;
  const usage = { repairs: 3, modelCalls: 12, tokens: 60000, costUsd: 5, startedAt: now };
  assertBudget(usage, now);
  for (const patch of [{ repairs: 4 }, { modelCalls: 13 }, { tokens: 60001 }, { costUsd: 5.01 }, { costUsd: NaN }, { tokens: -1 }, { startedAt: now + 1 }]) assert.throws(() => assertBudget({ ...usage, ...patch }, now));
  assert.throws(() => assertBudget(usage, now + limits.durationMs));
});
test("protected execution stays unavailable even after plan approval", () => {
  for (const operation of protectedOperations) assert.throws(() => assertExecutable(operation));
  assert.throws(() => assertExecutable("run_shell"));
});
