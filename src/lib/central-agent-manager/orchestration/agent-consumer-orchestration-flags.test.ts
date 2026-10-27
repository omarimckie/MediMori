import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerAgentConsumerResponse } from "../agent-consumer-handler";
import {
  isAgentConsumerEnabled,
  isAgentConsumerOrchestrationResolvable,
  isDurableOrchestrationQueueEnabled,
  isOwnerQueueManagementEnabled,
} from "./flags";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";

function restoreEnv(keys: string[], snapshot: Record<string, string | undefined>) {
  for (const key of keys) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("consumer HTTP returns 503 when consumer flag is disabled", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const response = await centralAgentManagerAgentConsumerResponse(new Request("http://local/assignments"), {
    isCamEnabled: () => true,
    isConsumerEnabled: () => false,
    resolveBackend: async () => ({ memory: store, queue: store }),
  });
  assert.equal(response.status, 503);
});

test("orchestration resolvable when durable queue or queue management enabled", () => {
  const keys = [
    "CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED",
    "CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED",
    "CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED",
  ];
  const snapshot = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    delete process.env.CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED;
    delete process.env.CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED;
    assert.equal(isAgentConsumerOrchestrationResolvable(), false);
    process.env.CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED = "true";
    assert.equal(isDurableOrchestrationQueueEnabled(), true);
    assert.equal(isAgentConsumerOrchestrationResolvable(), true);
    process.env.CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED = "true";
    process.env.CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED = "true";
    assert.equal(isOwnerQueueManagementEnabled(), true);
    assert.equal(isAgentConsumerOrchestrationResolvable(), true);
    process.env.CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED = "true";
    assert.equal(isAgentConsumerEnabled(), true);
  } finally {
    restoreEnv(keys, snapshot);
  }
});
