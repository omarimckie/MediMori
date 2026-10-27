import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { centralAgentManagerDispatchRecoveryResponse } from "./dispatch-recovery-handler";
import { MemoryOrchestrationQueueStore } from "./orchestration/memory-queue-store";
import { createTestAgent, NOW } from "./orchestration/test-fixtures";
import { claimNextAssignmentForAgentSync } from "./orchestration/agent-consumer-operations";
import { requireDispatchRecoverySync } from "./orchestration/cursor-dispatch-intent";
import type { DurableOrchestrationQueueStore } from "./orchestration/durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./orchestration/in-memory-orchestration-sql-port";
import { createDurableOrchestrationQueueStore } from "./orchestration/durable-orchestration-queue-store";
import { ownerConfirmVerifiedCursorIdsSync } from "./orchestration/cursor-dispatch-recovery-operations";
import type { ManagerAssignmentRecord } from "./orchestration/contracts-v1";
import { serializeManagerJob } from "./orchestration/contracts-v1";

const OWNER = "owner-alpha";

describe("dispatch-recovery-handler", { timeout: 45_000 }, () => {

function recoveryDeps(store: DurableOrchestrationQueueStore | MemoryOrchestrationQueueStore) {
  return {
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    recoveryEnabled: () => true,
    isOwner: (username: string) => username === OWNER,
    getUsername: async () => OWNER,
    resolveStore: async () => store as DurableOrchestrationQueueStore,
    now: () => NOW,
  };
}

async function seedRecoveryAssignment(store: MemoryOrchestrationQueueStore) {
  store.registerAgentSync(createTestAgent({ id: "cursor-bridge-agent" }));
  await store.enqueueJob({
    id: "job-recovery-api",
    projectId: "medimori",
    goalId: "goal",
    description: "recovery api test",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  const claimed = claimNextAssignmentForAgentSync(store, "cursor-bridge-agent", NOW);
  assert.ok(claimed);
  requireDispatchRecoverySync(
    store,
    "cursor-bridge-agent",
    claimed.id,
    claimed.lease.fenceToken,
    NOW,
    "Ambiguous create for recovery API test.",
  );
  return claimed.id;
}

test("dispatch recovery GET lists recovery-required assignments for owner", async () => {
  const memory = new MemoryOrchestrationQueueStore();
  await seedRecoveryAssignment(memory);
  const response = await centralAgentManagerDispatchRecoveryResponse(
    new Request("http://local/dispatch-recovery", { method: "GET" }),
    recoveryDeps(memory),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { recoveryRequired: { assignmentId: string }[] };
  assert.equal(body.recoveryRequired.length, 1);
});

test("dispatch recovery confirm persists verified cursor ids with audit", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  const memory = durable.getMemoryStore();
  const assignmentId = await seedRecoveryAssignment(memory);
  for (const job of memory.listJobsSync()) {
    await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: job.updatedAt });
  }
  for (const assignment of memory.listAssignmentsSync()) {
    await sql.upsertAssignment({
      id: assignment.id,
      job_id: assignment.jobId,
      payload_json: JSON.stringify(assignment),
      updated_at: assignment.updatedAt,
    });
  }
  const fence = memory.listAssignmentsSync().find((row) => row.id === assignmentId)!.lease.fenceToken;
  const response = await centralAgentManagerDispatchRecoveryResponse(
    new Request("http://local/dispatch-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "confirm_verified_external_ids",
        assignmentId,
        auditId: "audit-confirm-0001",
        externalRefs: {
          cursorAgentId: "bc-recovery-00000001",
          cursorRunId: "run-recovery-00000001",
        },
      }),
    }),
    recoveryDeps(durable),
  );
  assert.equal(response.status, 200);
  await durable.reloadFromSql();
  const assignment = durable.getMemoryStore().listAssignmentsSync().find((row) => row.id === assignmentId);
  assert.equal(assignment?.state, "active");
  assert.equal(assignment?.cursorDispatchIntent?.state, "external_confirmed");
  assert.equal(assignment?.externalRefs?.cursorAgentId, "bc-recovery-00000001");
  assert.equal(assignment?.cursorDispatchRecoveryAudit?.length, 1);
  assert.equal(assignment?.lease.fenceToken, fence);
});

test("dispatch recovery is disabled unless recovery flag is enabled", async () => {
  const memory = new MemoryOrchestrationQueueStore();
  const response = await centralAgentManagerDispatchRecoveryResponse(
    new Request("http://local/dispatch-recovery", { method: "GET" }),
    {
      ...recoveryDeps(memory),
      recoveryEnabled: () => false,
    },
  );
  assert.equal(response.status, 503);
});

test("dispatch recovery rejects non-owner principals", async () => {
  const memory = new MemoryOrchestrationQueueStore();
  const response = await centralAgentManagerDispatchRecoveryResponse(
    new Request("http://local/dispatch-recovery", { method: "GET" }),
    {
      ...recoveryDeps(memory),
      getUsername: async () => "not-an-owner",
    },
  );
  assert.equal(response.status, 403);
});

test("dispatch recovery fail and cancel keep audit without resetting to ready", async () => {
  const memory = new MemoryOrchestrationQueueStore();
  const assignmentId = await seedRecoveryAssignment(memory);
  const fail = await centralAgentManagerDispatchRecoveryResponse(
    new Request("http://local/dispatch-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "fail_external_dispatch",
        assignmentId,
        auditId: "audit-fail-0001",
        reason: "Verified failure after operator review.",
      }),
    }),
    recoveryDeps(memory),
  );
  assert.equal(fail.status, 200);
  const assignment = memory.listAssignmentsSync().find((row) => row.id === assignmentId);
  assert.equal(assignment?.state, "ambiguous");
  assert.equal(assignment?.cursorDispatchIntent?.state, "dispatch_failed");
  assert.equal(assignment?.cursorDispatchRecoveryAudit?.length, 1);
});

test("dispatch recovery confirm rejects protected job without approval binding", async () => {
  const memory = new MemoryOrchestrationQueueStore();
  const assignmentId = await seedRecoveryAssignment(memory);
  const assignment = memory.listAssignmentsSync().find((row) => row.id === assignmentId)!;
  const job = memory.getJobSync(assignment.jobId)!;
  const protectedJob = {
    ...job,
    requestedOperation: "production_deploy",
    ownerAuthorizationScope: "owner_approval_required" as const,
    approvalBinding: undefined,
  };
  const internalJobs = memory as unknown as { jobs: Map<string, typeof protectedJob> };
  internalJobs.jobs = new Map([[protectedJob.id, protectedJob]]);
  assert.throws(
    () =>
      ownerConfirmVerifiedCursorIdsSync(memory, {
        assignmentId,
        ownerUsername: OWNER,
        auditId: "audit-protected",
        now: NOW,
        externalRefs: {
          cursorAgentId: "bc-protected-00000001",
          cursorRunId: "run-protected-00000001",
        },
      }),
    /owner approval/i,
  );
});

test("dispatch recovery confirm rejects conflicting stored external ids", async () => {
  const memory = new MemoryOrchestrationQueueStore();
  const assignmentId = await seedRecoveryAssignment(memory);
  const row = memory.listAssignmentsSync().find((r) => r.id === assignmentId)!;
  const withRefs: ManagerAssignmentRecord = {
    ...row,
    externalRefs: {
      cursorAgentId: "bc-existing-00000001",
      cursorRunId: "run-existing-00000001",
    },
  };
  const patched = memory.listAssignmentsSync().map((assignment) =>
    assignment.id === assignmentId ? withRefs : assignment,
  );
  const internalAssignments = memory as unknown as { assignments: Map<string, ManagerAssignmentRecord> };
  internalAssignments.assignments = new Map(patched.map((assignment) => [assignment.id, assignment]));
  assert.throws(
    () =>
      ownerConfirmVerifiedCursorIdsSync(memory, {
        assignmentId,
        ownerUsername: OWNER,
        auditId: "audit-conflict",
        now: NOW,
        externalRefs: {
          cursorAgentId: "bc-other-00000001",
          cursorRunId: "run-other-00000001",
        },
      }),
    /conflicts with stored assignment refs/i,
  );
});
});
