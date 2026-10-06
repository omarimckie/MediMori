import { test } from "node:test";
import assert from "node:assert/strict";
import { assertTransition, classifyRisk, limits, parsePlan, protectedOperations, statuses, validationCommands } from "./policy";

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
  for (const status of ["blocked", "cancelled", "escalated"] as const) assert.throws(() => assertTransition(status, "implementing"));
  assert.throws(() => assertTransition("implementing", "awaiting_approval"));
  assert.equal(statuses.includes("awaiting_merge" as never), false);
});
