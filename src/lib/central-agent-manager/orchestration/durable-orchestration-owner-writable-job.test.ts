import assert from "node:assert/strict";
import test from "node:test";
import { serializeManagerJob } from "./contracts-v1";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { persistJobsFromMemory } from "./durable-orchestration-persistence";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { baseJobFixture, createTestAgent, NOW } from "./test-fixtures";

const AGENT_A = "owner-writable-agent";

async function seedReadyJob(sql: ReturnType<typeof createInMemoryOrchestrationSqlPort>, jobId: string) {
  const job = baseJobFixture({ id: jobId, state: "ready", requiredCapabilities: ["prepare_plan"] });
  await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: NOW });
  await sql.upsertAgent({
    id: AGENT_A,
    payload_json: JSON.stringify(createTestAgent({ id: AGENT_A })),
    updated_at: NOW,
  });
}

test("upsertJobIfOwnerWritable rejects stale ready payload for running consumer job", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-owner-writable-guard");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const claim = await durable.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const staleReady = baseJobFixture({ id: claim.jobId, state: "ready", updatedAt: NOW });
  const persisted = await sql.upsertJobIfOwnerWritable({
    id: staleReady.id,
    payload_json: serializeManagerJob(staleReady),
    updated_at: NOW,
  });
  assert.equal(persisted, false);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  assert.equal(reloaded.getMemoryStore().getJobSync(claim.jobId)?.state, "running");
});

test("persistJobsFromMemory skips consumer-owned running jobs", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-owner-writable-bulk");
  const durable = await createDurableOrchestrationQueueStore(sql);
  const claim = await durable.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const staleStore = await createDurableOrchestrationQueueStore(sql);
  staleStore.getMemoryStore().restoreJob(baseJobFixture({ id: claim.jobId, state: "ready", updatedAt: NOW }));
  await persistJobsFromMemory(sql, staleStore.getMemoryStore(), [claim.jobId]);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  assert.equal(reloaded.getMemoryStore().getJobSync(claim.jobId)?.state, "running");
});

test("owner scheduler tick does not overwrite unclaimed running job row", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await seedReadyJob(sql, "job-owner-writable-scheduler");
  const owner = await createDurableOrchestrationQueueStore(sql);
  const claim = await owner.claimNextAssignmentForAgent(AGENT_A, NOW);
  assert.ok(claim);
  const staleOwner = await createDurableOrchestrationQueueStore(sql);
  staleOwner.getMemoryStore().restoreJob(
    baseJobFixture({ id: claim.jobId, state: "blocked", blockReason: "dependency", updatedAt: NOW }),
  );
  await persistJobsFromMemory(sql, staleOwner.getMemoryStore(), [claim.jobId]);
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  assert.equal(reloaded.getMemoryStore().getJobSync(claim.jobId)?.state, "running");
});
