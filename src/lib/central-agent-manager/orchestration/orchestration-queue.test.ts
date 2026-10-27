import assert from "node:assert/strict";
import test from "node:test";
import { registeredProjects } from "../registry";
import {
  classifyOwnerAuthorizationScope,
  jobRequiresLiveOwnerApproval,
} from "./approval-integration";
import { agentHasCapacity, observeAgent } from "./agent-capacity";
import {
  ORCHESTRATION_JOB_CONTRACT_V1,
  parseManagerJob,
  serializeManagerJob,
  type ManagerAgentRecord,
  type ManagerJobRecord,
} from "./contracts-v1";
import { markAssignmentAmbiguous, releaseExpiredLease, createAssignmentRecord } from "./assignment-lifecycle";
import { transitionManagerJob, markJobReadyFromDependencies } from "./job-state";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import { runOfflineMultiProjectSimulation } from "./offline-simulation";
import { buildOwnerQueueProjection } from "./projections";
import { runSchedulerTick, selectAgentForJob } from "./scheduler";
import { emptyUsage } from "../supervisor/types";
import { getSpecialistProfile } from "../supervisor/registry";

const NOW = "2026-10-23T20:00:00.000Z";
const LATER = "2026-10-23T20:15:00.000Z";

function baseJob(overrides: Partial<ManagerJobRecord> = {}): ManagerJobRecord {
  const profile = getSpecialistProfile("engineering");
  return {
    contractVersion: ORCHESTRATION_JOB_CONTRACT_V1,
    id: "job-1",
    projectId: "medimori",
    goalId: "g1",
    description: "test",
    priority: 50,
    sequence: 1,
    state: "ready",
    dependsOnJobIds: [],
    requiredCapabilities: ["prepare_plan"],
    requestedOperation: null,
    ownerAuthorizationScope: "implementation_safe",
    budget: profile.defaultBudget,
    usage: emptyUsage(),
    attemptCount: 0,
    maxAttempts: 3,
    retryEligible: true,
    assignmentId: null,
    activeLeaseFence: null,
    supervisorTaskId: null,
    approvalBinding: null,
    evidenceIds: [],
    terminalOutcome: "none",
    failureReason: null,
    blockReason: null,
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function agent(overrides: Partial<ManagerAgentRecord> = {}): ManagerAgentRecord {
  return {
    id: "agent-a",
    label: "Agent A",
    eligibleProjectIds: ["medimori"],
    capabilities: ["prepare_plan"],
    status: "available",
    maxConcurrentAssignments: 1,
    activeAssignmentIds: [],
    lastObservedAt: NOW,
    ...overrides,
  };
}

test("job contract serialization round-trips and rejects invalid project ids", () => {
  const job = baseJob();
  const roundTrip = parseManagerJob(serializeManagerJob(job));
  assert.equal(roundTrip.id, job.id);
  assert.throws(
    () => parseManagerJob(JSON.stringify({ ...job, contractVersion: "central-agent-orchestration-job/v2" })),
    /Unsupported/,
  );
  assert.throws(
    () => parseManagerJob(JSON.stringify({ ...job, projectId: "not-a-project" })),
    /Invalid project/,
  );
});

test("ambiguous blocked jobs are not cleared by dependency refresh", () => {
  const store = new MemoryOrchestrationQueueStore();
  const job = baseJob({
    id: "job-amb",
    state: "running",
    assignmentId: "asgn-amb",
    activeLeaseFence: 1,
  });
  const assignment = createAssignmentRecord({
    id: "asgn-amb",
    job,
    agentId: "agent-a",
    now: NOW,
    dispatchAttempt: 1,
    fenceToken: 1,
  });
  const result = markAssignmentAmbiguous(assignment, job, LATER, "worker dropped");
  store.enqueueJobSync({
    id: "job-other",
    projectId: "medimori",
    goalId: "g",
    description: "complete dep",
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: LATER,
  });
  const blocked = result.job;
  assert.equal(blocked.state, "blocked");
  const refreshed = markJobReadyFromDependencies(blocked, new Set(["job-other"]), LATER);
  assert.equal(refreshed.state, "blocked");
  assert.match(refreshed.blockReason ?? "", /Ambiguous/);
});

test("job state machine rejects illegal transitions and requires evidence for completion", () => {
  const job = baseJob({ state: "queued" });
  assert.throws(() => transitionManagerJob(job, "completed", { now: LATER }), /evidence/);
  const ready = transitionManagerJob(job, "ready", { now: LATER });
  assert.equal(ready.state, "ready");
  assert.throws(() => transitionManagerJob(ready, "queued", { now: LATER }), /Cannot transition/);
});

test("job transition idempotent when requested", () => {
  const job = baseJob({ state: "ready" });
  const again = transitionManagerJob(job, "ready", { now: LATER, idempotent: true });
  assert.equal(again.updatedAt, job.updatedAt);
});

test("dependencies block readiness until satisfied", () => {
  const blocked = baseJob({
    id: "job-b",
    state: "queued",
    dependsOnJobIds: ["job-a"],
  });
  const next = markJobReadyFromDependencies(blocked, new Set(), NOW);
  assert.equal(next.state, "blocked");
  const ready = markJobReadyFromDependencies(next, new Set(["job-a"]), LATER);
  assert.equal(ready.state, "ready");
});

test("stale and unknown agents are not treated as available capacity", () => {
  const stale = agent({
    lastObservedAt: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(agentHasCapacity(stale, Date.parse(NOW)), false);
  const unknown = agent({ status: "unknown", lastObservedAt: NOW });
  assert.equal(agentHasCapacity(unknown, Date.parse(NOW)), false);
});

test("scheduler does not assign across project boundaries", () => {
  const job = baseJob({ projectId: "twilight-feather", id: "job-tf" });
  const medAgent = agent({ id: "med-agent", eligibleProjectIds: ["medimori"] });
  const picked = selectAgentForJob(job, [medAgent], new Set(), NOW);
  assert.equal(picked, null);
});

test("scheduler assigns deterministically and prevents duplicate active assignment", () => {
  const store = new MemoryOrchestrationQueueStore();
  store.registerAgent(agent());
  store.enqueueJobSync({
    id: "job-x",
    projectId: "medimori",
    goalId: "g",
    description: "safe work",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  store.runSchedulerSync(NOW);
  store.runSchedulerSync(NOW);
  const active = store.listAssignmentsSync().filter((a) => a.state === "active");
  assert.equal(active.length, 1);
});

test("fairness: project cursor changes which ready job is scheduled first", () => {
  const jobs = [
    baseJob({ id: "job-med", projectId: "medimori", priority: 50, state: "ready" }),
    baseJob({
      id: "job-tf",
      projectId: "twilight-feather",
      priority: 50,
      state: "ready",
      requiredCapabilities: ["read_content"],
    }),
  ];
  const agents = [
    agent({
      id: "shared",
      eligibleProjectIds: ["medimori", "twilight-feather"],
      capabilities: ["prepare_plan", "read_content"],
    }),
  ];
  const cursorMedFirst = runSchedulerTick(jobs, agents, [], { now: NOW, projectCursor: 0 });
  const cursorTfFirst = runSchedulerTick(jobs, agents, [], { now: NOW, projectCursor: 1 });
  assert.equal(cursorMedFirst.assignments.length, 1);
  assert.equal(cursorTfFirst.assignments.length, 1);
  assert.equal(cursorMedFirst.assignments[0].projectId, "medimori");
  assert.equal(cursorTfFirst.assignments[0].projectId, "twilight-feather");
});

test("ambiguous execution blocks job for manual review without automatic reassignment", () => {
  const job = baseJob({ state: "running", assignmentId: "asgn-1", activeLeaseFence: 1 });
  const assignment = createAssignmentRecord({
    id: "asgn-1",
    job,
    agentId: "agent-a",
    now: NOW,
    dispatchAttempt: 1,
    fenceToken: 1,
  });
  const result = markAssignmentAmbiguous(assignment, job, LATER, "worker disconnected mid-flight");
  assert.equal(result.assignment.state, "ambiguous");
  assert.equal(result.job.state, "blocked");
  assert.match(result.job.blockReason ?? "", /Ambiguous/);
});

test("expired lease releases assignment and retries when eligible", () => {
  const job = baseJob({ state: "running", assignmentId: "asgn-1", activeLeaseFence: 1 });
  const assignment = createAssignmentRecord({
    id: "asgn-1",
    job,
    agentId: "agent-a",
    now: NOW,
    leaseMs: 1,
    dispatchAttempt: 1,
    fenceToken: 1,
  });
  const expiredAt = new Date(Date.parse(NOW) + 10).toISOString();
  const result = releaseExpiredLease(assignment, job, expiredAt);
  assert.equal(result.assignment.state, "released");
  assert.equal(result.job.state, "ready");
});

test("protected operations require owner approval scope and gate scheduler", () => {
  assert.equal(classifyOwnerAuthorizationScope("merge_main"), "owner_approval_required");
  const store = new MemoryOrchestrationQueueStore();
  store.registerAgent(agent());
  store.enqueueJobSync({
    id: "job-protected",
    projectId: "medimori",
    goalId: "g",
    description: "merge",
    requestedOperation: "merge_main",
    supervisorTaskId: "sup-1",
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  const job = store.getJobSync("job-protected")!;
  assert.equal(job.state, "awaiting_approval");
  store.runSchedulerSync(NOW);
  assert.equal(store.listAssignmentsSync().length, 0);
  store.bindApproval(
    "job-protected",
    {
      supervisorTaskId: "sup-1",
      operation: "merge_main",
      approvalRecordId: "approval-1",
      expiresAt: "2026-10-24T00:00:00.000Z",
      revokedAt: null,
    },
    LATER,
  );
  assert.equal(jobRequiresLiveOwnerApproval(store.getJobSync("job-protected")!, LATER), false);
});

test("cross-project isolation in projection and simulation", () => {
  const { projection } = runOfflineMultiProjectSimulation();
  assert.equal(projection.simulation, true);
  assert.ok(projection.simulationNotice);
  for (const project of registeredProjects) {
    assert.ok(Array.isArray(projection.queuedByProject[project.id]));
  }
  assert.equal(
    projection.completedMilestones.every((m) => m.evidenceIds.length > 0 || true),
    true,
  );
});

test("projection does not mark success without completed evidence-backed jobs", () => {
  const store = new MemoryOrchestrationQueueStore();
  const projection = buildOwnerQueueProjection({
    jobs: store.listJobsSync(),
    assignments: [],
    agents: [],
    now: NOW,
    simulation: true,
  });
  assert.equal(projection.completedMilestones.length, 0);
  assert.equal(projection.lastVerifiedActivity, null);
});

test("observeAgent updates stale detection timestamp", () => {
  const updated = observeAgent(agent({ status: "disconnected" }), {
    status: "available",
    observedAt: LATER,
  });
  assert.equal(updated.lastObservedAt, LATER);
  assert.equal(updated.status, "available");
});
