/**
 * Offline rehearsal for Phase 5a-2 owner queue-management smoke (no network).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerQueueManagementResponse } from "../queue-management-handler";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
const ownerDeps = {
  isEnabled: () => true,
  isOwnerConfigured: () => true,
  getUsername: async () => "omari",
  isOwner: () => true,
  managementEnabled: () => true,
};

test("offline staging smoke: owner enqueue and list via durable store", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  const jobId = "job-staging-smoke-offline-01";
  const enqueue = await centralAgentManagerQueueManagementResponse(
    new Request("http://local/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "enqueue",
        id: jobId,
        projectId: "medimori",
        goalId: "goal-staging-smoke",
        description: "Phase 5a-2 offline rehearsal",
      }),
    }),
    { ...ownerDeps, resolveStore: async () => durable },
  );
  assert.equal(enqueue.status, 200);
  const list = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    resolveStore: async () => durable,
  });
  assert.equal(list.status, 200);
  const body = (await list.json()) as { durable: boolean; queuedByProject: { medimori: { id: string }[] } };
  assert.equal(body.durable, true);
  assert.ok(body.queuedByProject.medimori.some((job) => job.id === jobId));
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  assert.ok(reloaded.getMemoryStore().getJobSync(jobId));
});
