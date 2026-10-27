/**
 * Offline readiness for Phase 5a-2B HTTP queue-management smoke (no network, no auth bypass).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerQueueManagementResponse } from "../queue-management-handler";
import {
  isAgentConsumerEnabled,
  isCursorBridgeEnabled,
  isCursorBridgeRunnerEnabled,
} from "./flags";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";

const ownerDeps = {
  isEnabled: () => true,
  isOwnerConfigured: () => true,
  getUsername: async () => "omari",
  isOwner: () => true,
  managementEnabled: () => true,
};

test("queue management HTTP smoke: unauthorized and forbidden without owner session", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  const unauth = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    getUsername: async () => null,
    resolveStore: async () => durable,
  });
  assert.equal(unauth.status, 401);
  const forbidden = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    isOwner: () => false,
    resolveStore: async () => durable,
  });
  assert.equal(forbidden.status, 403);
});

test("queue management HTTP smoke: GET documents durable management contract", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  const response = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    ...ownerDeps,
    resolveStore: async () => durable,
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    durable: boolean;
    managementEnabled: boolean;
    queuedByProject: Record<string, unknown>;
  };
  assert.equal(body.durable, true);
  assert.equal(body.managementEnabled, true);
  assert.ok(body.queuedByProject);
});

test("queue management HTTP smoke: enqueue list and reload without consumer or bridge flags", async () => {
  const keys = [
    "CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED",
    "CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED",
    "CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED",
  ];
  const snapshot = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(isAgentConsumerEnabled(), false);
    assert.equal(isCursorBridgeEnabled(), false);
    assert.equal(isCursorBridgeRunnerEnabled(), false);

    const sql = createInMemoryOrchestrationSqlPort();
    const durable = await createDurableOrchestrationQueueStore(sql);
    const jobId = "job-http-smoke-readiness-01";
    const enqueue = await centralAgentManagerQueueManagementResponse(
      new Request("http://local/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "enqueue",
          id: jobId,
          projectId: "medimori",
          goalId: "goal-http-smoke",
          description: "5a-2B readiness",
        }),
      }),
      { ...ownerDeps, resolveStore: async () => durable },
    );
    assert.equal(enqueue.status, 200);
    const list = await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
      ...ownerDeps,
      resolveStore: async () => durable,
    });
    const listed = (await list.json()) as { queuedByProject: { medimori: { id: string }[] } };
    assert.ok(listed.queuedByProject.medimori.some((job) => job.id === jobId));
    const reloaded = await createDurableOrchestrationQueueStore(sql);
    assert.ok(reloaded.getMemoryStore().getJobSync(jobId));
  } finally {
    for (const key of keys) {
      const value = snapshot[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
