import assert from "node:assert/strict";
import test from "node:test";
import { createAdminSessionValue } from "@/lib/admin-auth";
import {
  createMemoryApprovalStore,
  issueTrustedOwnerApproval,
  revokeTrustedOwnerApproval,
} from "../supervisor/trusted-approval";
import { createSupervisorTask, transitionTask } from "../supervisor/task";
import { createOfflineDisposableMockPort } from "./approval-disposable-offline-mock-port";
import { runDisposableCaseOffline } from "./approval-disposable-postgres-executor";
import { disposableVerificationManifest } from "../verification/disposable-verification-manifest";

const NOW = "2026-10-26T14:00:00.000Z";
const previousSecret = process.env.ADMIN_SESSION_SECRET;
const previousOwners = process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;

process.env.ADMIN_SESSION_SECRET = "cam-disposable-sm-secret";
process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = "omari";

test.after(() => {
  if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = previousSecret;
  if (previousOwners === undefined) delete process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  else process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = previousOwners;
});

async function waitingTask(store: ReturnType<typeof createMemoryApprovalStore>, taskId = "task-sm-61") {
  const created = createSupervisorTask({
    id: taskId,
    goalId: "goal",
    specialistId: "engineering",
    description: "state machine offline",
    requestedOperations: ["merge_main"],
    idempotencyKey: `idem-${taskId}`,
    now: NOW,
  });
  const waiting = transitionTask(created, "awaiting_approval", NOW);
  await store.saveTask(waiting);
  return waiting;
}

test("memory approval store enforces idempotent issue and permanent revoke", async () => {
  const store = createMemoryApprovalStore();
  await waitingTask(store);
  const sessionToken = createAdminSessionValue("omari");
  const first = await issueTrustedOwnerApproval({
    sessionToken,
    taskId: "task-sm-61",
    idempotencyKey: "approval-key-61",
    operation: "merge_main",
    environment: "disposable-local",
    store,
    now: NOW,
  });
  const second = await issueTrustedOwnerApproval({
    sessionToken,
    taskId: "task-sm-61",
    idempotencyKey: "approval-key-61",
    operation: "merge_main",
    environment: "disposable-local",
    store,
    now: NOW,
  });
  assert.equal(first.record.id, second.record.id);
  await revokeTrustedOwnerApproval({
    sessionToken,
    approvalId: first.record.id,
    store,
    now: NOW,
  });
  await assert.rejects(() =>
    issueTrustedOwnerApproval({
      sessionToken,
      taskId: "task-sm-61",
      idempotencyKey: "approval-key-61-replay",
      operation: "merge_main",
      environment: "disposable-local",
      store,
      now: NOW,
    }),
  );
});

test("offline mock port runs phase 1–7 manifest slice deterministically", async () => {
  const slice = ["1.1", "1.2", "1.3", "1.4", "4.4", "5.1", "6.1", "6.2", "7.1", "7.2"];
  for (const id of slice) {
    const case_ = disposableVerificationManifest.find((row) => row.id === id);
    assert.ok(case_);
    const port = createOfflineDisposableMockPort(case_);
    const result = await runDisposableCaseOffline(case_, port);
    assert.equal(result.ok, true, `case ${id}`);
  }
});
