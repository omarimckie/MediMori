import { test } from "node:test";
import assert from "node:assert/strict";
import { assertBudget, assertTransition, classifyRisk, limits, parsePlan, protectedOperations, statuses, validationCommands } from "./policy";

const plan = { summary: "Fix layout", files: ["src/components/card.tsx"], validations: ["lint"], operations: [] };

test("plans bound paths, validations, operations, and request size", () => {
  assert.deepEqual(parsePlan(plan), plan);
  for (const files of [["../secret"], ["/etc/passwd"], ["src/../secret"], ["x;curl"], Array(limits.contextFiles + 1).fill("src/a.ts")]) {
    assert.throws(() => parsePlan({ ...plan, files }));
  }
  assert.throws(() => parsePlan({ ...plan, summary: " " }));
  assert.throws(() => parsePlan({ ...plan, summary: "x".repeat(4001) }));
  assert.throws(() => parsePlan({ ...plan, validations: ["lint; deploy"] }));
  assert.throws(() => parsePlan({ ...plan, operations: ["unknown"] }));
  assert.deepEqual(validationCommands, ["test", "lint", "typecheck", "build", "security:check", "test:engineering"]);
  assert.ok(protectedOperations.includes("production_deploy"));
});

test("risk classification fails conservatively for protected paths and operations", () => {
  assert.equal(classifyRisk(parsePlan(plan)), "low");
  assert.equal(classifyRisk(parsePlan({ ...plan, files: ["src/components/admin/api/demo.ts"] })), "medium");
  for (const file of ["src/lib/admin-auth.ts", "sql/schema.sql", ".github/workflows/run.yml", "vercel.json", "src/middleware.ts", "src/lib/stripe.ts", "src/lib/marketing/publish.ts"]) {
    assert.equal(classifyRisk(parsePlan({ ...plan, files: [file] })), "high", file);
  }
  assert.equal(classifyRisk(parsePlan({ ...plan, operations: ["production_deploy"] })), "high");
});

test("control-plane lifecycle cannot skip planning or human approval", () => {
  assertTransition("intake", "analyzing");
  assertTransition("analyzing", "planned");
  assertTransition("planned", "awaiting_approval");
  assertTransition("awaiting_approval", "implementing");
  assert.throws(() => assertTransition("intake", "implementing"));
  assert.throws(() => assertTransition("planned", "implementing"));
  assertTransition("implementing", "validating");
  assertTransition("validating", "repairing");
  assertTransition("repairing", "validating");
  assertTransition("validating", "reviewing");
  assertTransition("reviewing", "awaiting_merge");
  for (const status of ["blocked", "cancelled", "escalated"] as const) assert.throws(() => assertTransition(status, "implementing"));
  assert.throws(() => assertTransition("implementing", "awaiting_approval"));
  assert.equal(statuses.includes("validating"), true);
  assert.equal(statuses.includes("repairing"), true);
  assert.equal(statuses.includes("awaiting_merge"), true);
  assert.equal(statuses.includes("merging" as never), false);
  assert.equal(statuses.includes("completed" as never), false);
});

test("execution budgets preserve validated limits and reject exhaustion or invalid usage", () => {
  assert.deepEqual(limits, { repairs: 3, modelCalls: 12, tokens: 60000, costUsd: 5, durationMs: 30 * 60 * 1000, contextFiles: 20 });
  const now = 2_000_000;
  const usage = { repairs: 3, modelCalls: 12, tokens: 60000, costUsd: 5, startedAt: now };
  assert.doesNotThrow(() => assertBudget(usage, now));
  for (const patch of [{ repairs: 4 }, { modelCalls: 13 }, { tokens: 60001 }, { costUsd: 5.01 }, { costUsd: Number.NaN }, { tokens: -1 }, { startedAt: now + 1 }]) {
    assert.throws(() => assertBudget({ ...usage, ...patch }, now));
  }
  assert.throws(() => assertBudget(usage, now + limits.durationMs));
});
