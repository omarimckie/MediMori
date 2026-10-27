import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerQueueManagementResponse } from "../queue-management-handler";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";

const ownerDeps = {
  isEnabled: () => true,
  isOwnerConfigured: () => true,
  getUsername: async () => "omari",
  isOwner: () => true,
  managementEnabled: () => true,
};

test("queue management rejects invalid project id on enqueue", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const response = await centralAgentManagerQueueManagementResponse(
    new Request("http://local/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "enqueue",
        id: "job-bad-project",
        projectId: "not-a-registered-project",
        goalId: "g1",
        description: "bad",
      }),
    }),
    { ...ownerDeps, resolveStore: async () => store },
  );
  assert.equal(response.status, 400);
  assert.equal((await store.listJobs()).length, 0);
});

test("queue management durable enqueue survives store reconstruction", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  const jobId = "job-phase5-reload-persist";
  const enqueue = await centralAgentManagerQueueManagementResponse(
    new Request("http://local/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "enqueue",
        id: jobId,
        projectId: "medimori",
        goalId: "goal-phase5",
        description: "reload persistence",
      }),
    }),
    { ...ownerDeps, resolveStore: async () => durable },
  );
  assert.equal(enqueue.status, 200);
  const freshPort = await createDurableOrchestrationQueueStore(sql);
  const list = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    resolveStore: async () => freshPort,
  });
  const body = (await list.json()) as { queuedByProject: { medimori: { id: string }[] } };
  assert.ok(body.queuedByProject.medimori.some((job) => job.id === jobId));
});

test("queue management does not invoke scheduler on GET", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  const memory = durable.getMemoryStore();
  let schedulerCalls = 0;
  const original = memory.runSchedulerSync.bind(memory);
  memory.runSchedulerSync = (...args) => {
    schedulerCalls += 1;
    return original(...args);
  };
  const response = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    resolveStore: async () => durable,
  });
  assert.equal(response.status, 200);
  assert.equal(schedulerCalls, 0);
});
