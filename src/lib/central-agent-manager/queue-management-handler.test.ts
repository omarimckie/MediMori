import assert from "node:assert/strict";
import test from "node:test";
import { MemoryOrchestrationQueueStore } from "./orchestration/memory-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./orchestration/in-memory-orchestration-sql-port";
import { createDurableOrchestrationQueueStore } from "./orchestration/durable-orchestration-queue-store";
import { NOW } from "./orchestration/test-fixtures";
import { centralAgentManagerQueueManagementResponse } from "./queue-management-handler";

const ownerDeps = {
  isEnabled: () => true,
  isOwnerConfigured: () => true,
  getUsername: async () => "omari",
  isOwner: () => true,
  managementEnabled: () => true,
};

test("queue management returns 503 when manager disabled", async () => {
  const response = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    isEnabled: () => false,
    isOwnerConfigured: () => true,
    getUsername: async () => "omari",
    isOwner: () => true,
    managementEnabled: () => true,
  });
  assert.equal(response.status, 503);
});

test("queue management returns 401 without authenticated user", async () => {
  const response = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    getUsername: async () => null,
  });
  assert.equal(response.status, 401);
});

test("queue management returns 403 for non-owner", async () => {
  const response = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    isOwner: () => false,
  });
  assert.equal(response.status, 403);
});

test("queue management returns 503 when feature flags disable management", async () => {
  const response = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    managementEnabled: () => false,
  });
  assert.equal(response.status, 503);
});

test("queue management returns 503 when durable transport is unavailable", async () => {
  const response = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    resolveStore: async () => {
      throw new Error("Durable queue is enabled but no orchestration SQL transport is configured.");
    },
  });
  assert.equal(response.status, 503);
});

test("queue management GET uses injected durable store", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  await durable.enqueueJob({
    id: "job-mgmt-get",
    projectId: "medimori",
    goalId: "g1",
    description: "mgmt",
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  const response = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    resolveStore: async () => durable,
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    durable: boolean;
    queuedByProject: { medimori: { id: string }[] };
  };
  assert.equal(body.durable, true);
  assert.ok(body.queuedByProject.medimori.some((job) => job.id === "job-mgmt-get"));
});

test("queue management POST enqueue is owner-only", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const forbidden = await centralAgentManagerQueueManagementResponse(
    new Request("http://local/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "enqueue", id: "job-x", projectId: "medimori" }),
    }),
    {
      ...ownerDeps,
      isOwner: () => false,
      resolveStore: async () => store,
    },
  );
  assert.equal(forbidden.status, 403);
  assert.equal((await store.listJobs()).length, 0);
});

test("queue management POST enqueue and cancel for owner", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const enqueue = await centralAgentManagerQueueManagementResponse(
    new Request("http://local/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "enqueue",
        id: "job-mgmt-post",
        projectId: "medimori",
        goalId: "g1",
        description: "post",
      }),
    }),
    { ...ownerDeps, resolveStore: async () => store },
  );
  assert.equal(enqueue.status, 200);
  const cancel = await centralAgentManagerQueueManagementResponse(
    new Request("http://local/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel", jobId: "job-mgmt-post" }),
    }),
    { ...ownerDeps, resolveStore: async () => store },
  );
  assert.equal(cancel.status, 200);
  const cancelled = (await cancel.json()) as { job: { state: string } };
  assert.equal(cancelled.job.state, "cancelled");
});

test("queue management rejects unsupported actions and malformed JSON", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const badAction = await centralAgentManagerQueueManagementResponse(
    new Request("http://local/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "nope" }),
    }),
    { ...ownerDeps, resolveStore: async () => store },
  );
  assert.equal(badAction.status, 400);
  const badJson = await centralAgentManagerQueueManagementResponse(
    new Request("http://local/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
    { ...ownerDeps, resolveStore: async () => store },
  );
  assert.equal(badJson.status, 400);
});
