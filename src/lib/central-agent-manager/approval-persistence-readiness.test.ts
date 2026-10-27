import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unavailableApprovalStore } from "./supervisor/trusted-approval";
import { createSupervisorTask } from "./supervisor/task";
import { SupervisorContractError } from "./supervisor/types";

test("production approval route remains wired to unavailable store", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/central-agent-manager/approval-handler.ts"), "utf8");
  assert.match(source, /unavailableApprovalStore/);
});

test("unavailable store fails closed for all durable operations", async () => {
  const now = "2026-10-26T12:00:00.000Z";
  await assert.rejects(() => unavailableApprovalStore.readTask("id"), SupervisorContractError);
  const task = createSupervisorTask({
    id: "task-readiness",
    goalId: "goal",
    specialistId: "engineering",
    description: "readiness",
    requestedOperations: ["prepare_plan"],
    idempotencyKey: "idem-readiness",
    now,
  });
  await assert.rejects(() => unavailableApprovalStore.saveTask(task), SupervisorContractError);
  await assert.rejects(() => unavailableApprovalStore.readApproval("id"), SupervisorContractError);
  await assert.rejects(() => unavailableApprovalStore.revokeApproval("id", now), SupervisorContractError);
});
