import assert from "node:assert/strict";
import test from "node:test";
import { parseManagerJob, serializeManagerJob } from "./contracts-v1";
import {
  projectExternalExecutionReferences,
  validateExternalExecutionReferences,
} from "./external-execution-refs";
import { validateManagerJobPayload } from "./record-validation";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import { buildOwnerQueueProjection } from "./projections";
import { baseJobFixture, createTestAgent, NOW } from "./test-fixtures";
import { runSchedulerTick } from "./scheduler";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { createPostgresOrchestrationQueuePort, loadOrchestrationFromSql } from "./postgres-orchestration-queue-port";

const TASK_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const RUN_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

test("validateExternalExecutionReferences accepts bounded correlation fields", () => {
  const refs = validateExternalExecutionReferences({
    correlationKey: "demo-owner-key-1",
    engineeringTaskId: TASK_ID,
    engineeringRunId: RUN_ID,
    cursorAgentId: "agent_abc123",
    cursorRunId: "run_xyz789",
  });
  assert.deepEqual(refs, {
    correlationKey: "demo-owner-key-1",
    engineeringTaskId: TASK_ID,
    engineeringRunId: RUN_ID,
    cursorAgentId: "agent_abc123",
    cursorRunId: "run_xyz789",
  });
});

test("validateExternalExecutionReferences rejects unknown keys and secret-like values", () => {
  assert.throws(
    () => validateExternalExecutionReferences({ engineeringTaskId: TASK_ID, extra: "x" }),
    /Unknown external reference field/,
  );
  assert.throws(
    () => validateExternalExecutionReferences({ correlationKey: "sk_abcdefghijklmnop" }),
    /secret-like/i,
  );
  assert.throws(
    () => validateExternalExecutionReferences({ engineeringTaskId: "not-a-uuid" }),
    /engineeringTaskId/,
  );
});

test("backward compatibility: jobs without externalRefs round-trip", () => {
  const job = baseJobFixture({ id: "job-no-refs" });
  assert.equal(job.externalRefs, undefined);
  const json = serializeManagerJob(job);
  const parsed = parseManagerJob(json);
  assert.equal(parsed.externalRefs, undefined);
  assert.throws(() => validateManagerJobPayload(JSON.stringify({ ...job, externalRefs: { bad: 1 } })));
});

test("durable persistence preserves valid externalRefs", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const port = createPostgresOrchestrationQueuePort(sql);
  const refs = {
    correlationKey: "persist-demo",
    cursorAgentId: "cursor-agent-1",
  };
  await port.enqueueJob({
    id: "job-ext-refs",
    projectId: "medimori",
    goalId: "g1",
    description: "with refs",
    externalRefs: refs,
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  const reloaded = await loadOrchestrationFromSql(sql);
  const job = reloaded.getJobSync("job-ext-refs");
  assert.deepEqual(job?.externalRefs, refs);
});

test("owner projection exposes sanitized externalRefs and omits invalid stored shapes", () => {
  const store = new MemoryOrchestrationQueueStore();
  store.enqueueJobSync({
    id: "job-proj",
    projectId: "medimori",
    goalId: "g1",
    description: "proj",
    externalRefs: { correlationKey: "owner-visible", engineeringTaskId: TASK_ID },
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  const projection = buildOwnerQueueProjection({
    jobs: store.listJobsSync(),
    assignments: [],
    agents: [],
    now: NOW,
  });
  const row = projection.queuedByProject.medimori.find((j) => j.id === "job-proj");
  assert.deepEqual(row?.externalRefs, {
    correlationKey: "owner-visible",
    engineeringTaskId: TASK_ID,
  });

  const invalid = baseJobFixture({
    externalRefs: { correlationKey: "ok", engineeringTaskId: "bad" } as never,
  });
  const sanitized = buildOwnerQueueProjection({
    jobs: [invalid],
    assignments: [],
    agents: [],
    now: NOW,
  });
  assert.equal(sanitized.queuedByProject.medimori[0].externalRefs, null);
});

test("scheduler copies job externalRefs onto new assignments", () => {
  const refs = { correlationKey: "assign-copy", cursorRunId: "run-1" };
  const job = baseJobFixture({
    id: "job-assign-refs",
    state: "ready",
    externalRefs: refs,
    requiredCapabilities: ["prepare_plan"],
  });
  const agents = [createTestAgent()];
  const tick = runSchedulerTick([job], agents, [], { now: NOW });
  assert.equal(tick.assignments.length, 1);
  assert.deepEqual(tick.assignments[0].externalRefs, refs);
});

test("externalRefs do not change owner authorization scope classification", () => {
  const store = new MemoryOrchestrationQueueStore();
  const job = store.enqueueJobSync({
    id: "job-scope",
    projectId: "medimori",
    goalId: "g1",
    description: "scope",
    requestedOperation: "merge_main",
    externalRefs: { engineeringTaskId: TASK_ID },
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  assert.equal(job.ownerAuthorizationScope, "owner_approval_required");
  assert.equal(projectExternalExecutionReferences(job.externalRefs)?.engineeringTaskId, TASK_ID);
});
