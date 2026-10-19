import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorizationDurationMs,
  checkRepairCycleBudget,
  checkValidationCycleBudget,
  checkValidationGateBudget,
  maxValidationCycleMs,
  remainingAuthorizedMs,
  terminalizationReserveMs,
  validationGateMaxMs,
} from "./worker-runtime-budget";

test("remaining authorized runtime follows the SQL 30-minute fence from started_at", () => {
  const startedAt = 1_000_000;
  assert.equal(remainingAuthorizedMs(startedAt, startedAt), authorizationDurationMs);
  assert.equal(remainingAuthorizedMs(startedAt, startedAt + authorizationDurationMs), 0);
  assert.equal(remainingAuthorizedMs(startedAt, startedAt + authorizationDurationMs + 1), -1);
});

test("validation cycle budget requires reserve plus env prep and all gate maxima", () => {
  const startedAt = 0;
  const gateCount = 6;
  const required = terminalizationReserveMs + maxValidationCycleMs(gateCount);
  const passNow = authorizationDurationMs - required - 1;
  assert.equal(checkValidationCycleBudget({ startedAtMs: startedAt, nowMs: passNow, validationCount: gateCount, validationRevision: "a".repeat(40) }), null);
  const exceeded = checkValidationCycleBudget({ startedAtMs: startedAt, nowMs: authorizationDurationMs - required + 1, validationCount: gateCount, validationRevision: "a".repeat(40) });
  assert.equal(exceeded?.code, "runtime_deadline_exceeded");
  assert.equal(exceeded?.validationStage, "validation_cycle");
});

test("validation gate budget declines when gate maximum exceeds remaining budget after reserve", () => {
  const startedAt = 0;
  const passNow = authorizationDurationMs - terminalizationReserveMs - validationGateMaxMs - 1;
  assert.equal(checkValidationGateBudget({ startedAtMs: startedAt, nowMs: passNow, validationRevision: "a".repeat(40), validationGate: "test" }), null);
  const exceeded = checkValidationGateBudget({ startedAtMs: startedAt, nowMs: authorizationDurationMs - terminalizationReserveMs - validationGateMaxMs + 1, validationRevision: "a".repeat(40), validationGate: "lint" });
  assert.equal(exceeded?.validationStage, "validation_gate");
  assert.equal(exceeded?.validationGate, "lint");
});

test("repair cycle budget matches the next validation cycle requirement", () => {
  const startedAt = 0;
  const gateCount = 6;
  const required = terminalizationReserveMs + maxValidationCycleMs(gateCount);
  assert.deepEqual(
    checkRepairCycleBudget({ startedAtMs: startedAt, nowMs: required, validationCount: gateCount, validationRevision: "a".repeat(40) }),
    checkValidationCycleBudget({ startedAtMs: startedAt, nowMs: required, validationCount: gateCount, validationRevision: "a".repeat(40) }),
  );
});
