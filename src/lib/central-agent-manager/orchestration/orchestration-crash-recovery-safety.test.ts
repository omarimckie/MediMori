import assert from "node:assert/strict";
import test from "node:test";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { serializeManagerJob } from "./contracts-v1";
import { baseJobFixture, createTestAgent, NOW } from "./test-fixtures";

const AGENT_A = "crash-safety-agent";

async function seedReadyJob(sql: ReturnType<typeof createInMemoryOrchestrationSqlPort>, jobId: string) {
  const job = baseJobFixture({ id: jobId, state: "ready", requiredCapabilities: ["prepare_plan"] });
  await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: NOW });
  await sql.upsertAgent({
    id: AGENT_A,
    payload_json: JSON.stringify(createTestAgent({ id: AGENT_A })),
    updated_at: NOW,
  });
}

test("recoverFromCrash is not exposed on queue management HTTP path", async () => {
  const { centralAgentManagerQueueManagementResponse } = await import("../queue-management-handler");
  const sql = createInMemoryOrchestrationSqlPort();
  const durable = await createDurableOrchestrationQueueStore(sql);
  let recoverCalls = 0;
  const port = {
    ...durable,
    recoverFromCrash: async () => {
      recoverCalls += 1;
      return durable.recoverFromCrash(NOW);
    },
  };
  await centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    getUsername: async () => "omari",
    isOwner: () => true,
    managementEnabled: () => true,
    resolveStore: async () => port,
  });
  assert.equal(recoverCalls, 0);
});

test("recoverFromCrash refuses while active consumer assignment exists", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-crash-active");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const claim = await durable.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  await assert.rejects(() => durable.recoverFromCrash(NOW), /recoverFromCrash refused/);
});
