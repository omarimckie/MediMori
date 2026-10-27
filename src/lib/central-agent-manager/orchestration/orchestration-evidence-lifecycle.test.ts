import assert from "node:assert/strict";
import test from "node:test";
import { createAssignmentRecord } from "./assignment-lifecycle";
import { baseJobFixture, NOW } from "./test-fixtures";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import {
  appendPersistedEvidenceToAssignment,
  reconcileUnverifiableCompletedJobs,
  rehydrateEvidenceStoreFromAssignments,
} from "./orchestration-evidence-lifecycle";
import { OrchestrationEvidenceStore, acceptOrchestrationEvidence } from "./orchestration-evidence";

test("rehydrate and reconcile fail closed on missing completion evidence", () => {
  const store = new MemoryOrchestrationQueueStore();
  const job = baseJobFixture({
    id: "job-reconcile",
    state: "completed",
    evidenceIds: ["ev-1"],
    terminalOutcome: "succeeded",
  });
  const running = baseJobFixture({ id: job.id, state: "running", assignmentId: "asgn-1", activeLeaseFence: 1 });
  const assignment = createAssignmentRecord({
    id: "asgn-1",
    job: running,
    agentId: "agent-a",
    now: NOW,
    dispatchAttempt: 1,
    fenceToken: 1,
  });
  const completedAssignment = { ...assignment, state: "completed" as const, updatedAt: NOW };
  store.restoreJob(job);
  store.restoreAssignment(completedAssignment);
  rehydrateEvidenceStoreFromAssignments(store);
  const blocked = reconcileUnverifiableCompletedJobs(store, NOW);
  assert.deepEqual(blocked, ["job-reconcile"]);
  assert.equal(store.getJobSync("job-reconcile")?.state, "blocked");
});

test("persisted evidence on assignment rehydrates into the process-local store", () => {
  const store = new MemoryOrchestrationQueueStore();
  const job = baseJobFixture({ id: "job-hydrate", state: "running", assignmentId: "asgn-h", activeLeaseFence: 1 });
  const assignment = createAssignmentRecord({
    id: "asgn-h",
    job,
    agentId: "agent-a",
    now: NOW,
    dispatchAttempt: 1,
    fenceToken: 1,
  });
  const record = acceptOrchestrationEvidence({
    id: "ev-hydrate",
    jobId: job.id,
    assignmentId: assignment.id,
    agentId: "agent-a",
    kind: "work_completed",
    createdAt: NOW,
  });
  const withEvidence = appendPersistedEvidenceToAssignment(assignment, record, NOW);
  store.restoreAssignment(withEvidence);
  store.evidenceStore = new OrchestrationEvidenceStore();
  rehydrateEvidenceStoreFromAssignments(store);
  assert.equal(store.evidenceStore.get("ev-hydrate")?.kind, "work_completed");
});
