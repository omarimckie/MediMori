import assert from "node:assert/strict";
import test from "node:test";
import { createDurableOrchestrationQueueStore } from "../orchestration/durable-orchestration-queue-store";
import { DurableObjectiveExecutionStore } from "../phase6c/durable-objective-execution-store";
import { DurableObjectiveQueueManager } from "../phase6c/durable-objective-queue-manager";
import { createCamPgliteBundle } from "./cam-pglite-schema";

const backends = [
  { role: "engineering" as const, adapterEnabled: true, concurrentSlots: 1 },
  { role: "qa_independent_review" as const, adapterEnabled: true, concurrentSlots: 1 },
];

let tick = 0;
const NOW = "2026-10-27T12:00:00.000Z";
function now(): string {
  tick += 1;
  return new Date(Date.parse(NOW) + tick * 1000).toISOString();
}

test("PGlite objective flush before queue survives restart without duplicate accepted outcomes", async () => {
  const bundle = await createCamPgliteBundle();
  const durableQueue = await createDurableOrchestrationQueueStore(bundle.orchestrationSql);
  const objectiveStore = await DurableObjectiveExecutionStore.openSql(bundle.objectiveSql);
  let manager = new DurableObjectiveQueueManager({
    store: durableQueue.getMemoryStore(),
    durableQueue,
    objectiveStore,
    objectiveSqlPort: bundle.objectiveSql,
    backends,
    now,
  });
  manager.bootstrapAgents();
  manager.submitObjective({
    objectiveId: "obj-crash-pg",
    parentObjective: "Crash",
    projectId: "medimori",
    idempotencyKey: "idem-crash-pg",
  });
  await manager.managerTick("obj-crash-pg");
  await objectiveStore.flush();
  await durableQueue.persistMutations();

  const outcomeKey = "job:task-implement:complete";
  objectiveStore.markOutcomeAccepted("obj-crash-pg", outcomeKey);
  await objectiveStore.flush();
  await manager.simulateCrashRecovery();
  manager = await DurableObjectiveQueueManager.recover({
    options: {
      store: durableQueue.getMemoryStore(),
      durableQueue,
      objectiveStore,
      objectiveSqlPort: bundle.objectiveSql,
      backends,
      now,
    },
  });
  assert.ok(manager.objectiveStore.getAcceptedOutcomeKeys("obj-crash-pg").includes(outcomeKey));
});
