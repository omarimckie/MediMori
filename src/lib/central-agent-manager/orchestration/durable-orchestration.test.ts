import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresApprovalStore } from "../adapter/postgres-approval-store";
import { trustedTargetFromIdentity } from "../adapter/trusted-connection-target";
import { listSatelliteSourceDescriptors } from "../adapters/satellite-source-registry";
import { registeredProjects } from "../registry";
import { assertAssignmentFence } from "./assignment-lifecycle";
import { recoverOrchestrationState } from "./crash-recovery";
import { baseJobFixture, createTestAgent, NOW } from "./test-fixtures";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createInMemoryOrchestrationSqlPort } from "./in-memory-orchestration-sql-port";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import { createPostgresOrchestrationQueuePort, loadOrchestrationFromSql } from "./postgres-orchestration-queue-port";
import {
  resetOrchestrationQueueFactoryForTests,
  resolveManagementOrchestrationQueuePort,
  setOrchestrationSqlPortFactoryForTests,
} from "./queue-store-factory";
import { ORCHESTRATION_ASSIGNMENT_CONTRACT_V1, serializeManagerJob } from "./contracts-v1";

test("postgres orchestration port persists job rows through sql transport", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const port = createPostgresOrchestrationQueuePort(sql);
  await port.registerAgent(createTestAgent());
  const job = await port.enqueueJob({
    id: "job-pg-1",
    projectId: "medimori",
    goalId: "g1",
    description: "durable path",
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  assert.equal(sql.tables.jobs.size, 1);
  assert.equal(job.id, "job-pg-1");
});

test("load orchestration from sql restores jobs and assignments", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const port = createPostgresOrchestrationQueuePort(sql);
  await port.enqueueJob({
    id: "job-reload",
    projectId: "medimori",
    goalId: "g1",
    description: "x",
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  const reloaded = await loadOrchestrationFromSql(sql);
  assert.equal(reloaded.getJobSync("job-reload")?.id, "job-reload");
});

test("crash recovery blocks running jobs that lost active leases", () => {
  const job = baseJobFixture({ state: "running", assignmentId: "asgn-missing", activeLeaseFence: 2 });
  const recovered = recoverOrchestrationState({ jobs: [job], assignments: [], now: NOW });
  assert.equal(recovered.report.runningWithoutActiveLease, 1);
  assert.equal(recovered.jobs[0].state, "blocked");
});

test("assignment fence rejects stale completion after reassignment", () => {
  const job = baseJobFixture({ activeLeaseFence: 2 });
  const staleAssignment = {
    id: "asgn-stale",
    jobId: job.id,
    projectId: job.projectId,
    agentId: "agent-a",
    state: "active" as const,
    contractVersion: "central-agent-orchestration-assignment/v1" as const,
    lease: {
      holderAgentId: "agent-a",
      leasedAt: NOW,
      expiresAt: NOW,
      dispatchAttempt: 1,
      fenceToken: 1,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
  assert.throws(() => assertAssignmentFence(job, staleAssignment), /fence/i);
});

test("approval adapter per_operation mode re-verifies session each call", async () => {
  let observations = 0;
  const identity = {
    projectId: "aged-brook-70202332",
    branchId: "br-pool-verify-01",
    databaseName: "neondb",
    host: "ep-pool-verify-01",
    authorityRole: "central_agent_manager_approval_authority",
    executorRole: "central_agent_manager_executor",
  };
  const trusted = trustedTargetFromIdentity(identity);
  const store = createPostgresApprovalStore({
    identity,
    trustedTarget: trusted,
    attemptedAuthorityTarget: trusted,
    attemptedExecutorTarget: trusted,
    sessionVerificationMode: "per_operation",
    lifecycle: {
      beforeAuthorityConnect() {},
      beforeExecutorConnect() {},
      async observeAuthoritySession() {
        observations += 1;
        return {
          projectId: identity.projectId,
          branchId: identity.branchId,
          databaseName: identity.databaseName,
          host: identity.host,
          sessionUser: identity.authorityRole,
          currentDatabase: identity.databaseName,
          neonBranchId: identity.branchId,
        };
      },
      async observeExecutorSession() {
        throw new Error("unreachable");
      },
    },
    authority: {
      readTask: async () => null,
      saveTask: async () => {},
      commitApproval: async () => {
        throw new Error("unreachable");
      },
      readApproval: async () => null,
      revokeApproval: async () => null,
    },
    executor: {
      readTask: async () => null,
      readApproval: async () => null,
      markTaskRunning: async () => {
        throw new Error("unreachable");
      },
    },
  });
  await store.readTask("t1");
  await store.readTask("t2");
  assert.equal(observations, 2);
});

test("satellite source registry covers five projects without inventing URLs", () => {
  const descriptors = listSatelliteSourceDescriptors();
  assert.equal(descriptors.length, registeredProjects.length);
  for (const descriptor of descriptors) {
    assert.ok(descriptor.detail.length > 0);
    if (descriptor.kind === "unconfigured") {
      assert.match(descriptor.detail, /disconnected|missing/i);
    }
  }
});

test("memory store recoverFromCrash is exposed through port async API", async () => {
  const store = new MemoryOrchestrationQueueStore();
  const report = await store.recoverFromCrash(NOW);
  assert.equal(report.runningWithoutActiveLease, 0);
});

test("in-memory sql port rejects double claim on the same ready job", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const readyJob = baseJobFixture({ id: "job-claim-mem", state: "ready" });
  await sql.upsertJob({ id: readyJob.id, payload_json: serializeManagerJob(readyJob), updated_at: NOW });
  const running = baseJobFixture({
    id: readyJob.id,
    state: "running",
    assignmentId: "asgn-1",
    activeLeaseFence: 1,
  });
  const assignment = {
    id: "asgn-1",
    jobId: readyJob.id,
    projectId: "medimori" as const,
    agentId: "agent-test",
    state: "active" as const,
    contractVersion: ORCHESTRATION_ASSIGNMENT_CONTRACT_V1,
    lease: {
      holderAgentId: "agent-test",
      leasedAt: NOW,
      expiresAt: NOW,
      dispatchAttempt: 1,
      fenceToken: 1,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
  const first = await sql.tryClaimReadyJob({
    jobId: readyJob.id,
    jobJson: serializeManagerJob(running),
    assignmentId: assignment.id,
    assignmentJson: JSON.stringify(assignment),
    assignmentJobId: readyJob.id,
    now: NOW,
  });
  const second = await sql.tryClaimReadyJob({
    jobId: readyJob.id,
    jobJson: serializeManagerJob(running),
    assignmentId: "asgn-2",
    assignmentJson: JSON.stringify({ ...assignment, id: "asgn-2" }),
    assignmentJobId: readyJob.id,
    now: NOW,
  });
  assert.equal(first, true);
  assert.equal(second, false);
});

test("durable store rejects stale fence completion", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const job = baseJobFixture({ id: "job-fence-mem", state: "running", assignmentId: "asgn-fence", activeLeaseFence: 1 });
  const assignment = {
    id: "asgn-fence",
    jobId: job.id,
    projectId: "medimori" as const,
    agentId: "agent-test",
    state: "active" as const,
    contractVersion: ORCHESTRATION_ASSIGNMENT_CONTRACT_V1,
    lease: {
      holderAgentId: "agent-test",
      leasedAt: NOW,
      expiresAt: "2026-10-24T19:00:00.000Z",
      dispatchAttempt: 1,
      fenceToken: 1,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
  await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: NOW });
  await sql.upsertAssignment({
    id: assignment.id,
    job_id: job.id,
    payload_json: JSON.stringify(assignment),
    updated_at: NOW,
  });
  const reloaded = await createDurableOrchestrationQueueStore(sql);
  const bumped = {
    ...assignment,
    lease: { ...assignment.lease, fenceToken: 2 },
  };
  await sql.upsertAssignment({
    id: bumped.id,
    job_id: job.id,
    payload_json: JSON.stringify(bumped),
    updated_at: NOW,
  });
  await assert.rejects(
    () => reloaded.heartbeatAssignmentForAgent("agent-test", assignment.id, 1, NOW),
    /stale|fence/i,
  );
});

test("queue factory uses memory when durable flag is off", async () => {
  resetOrchestrationQueueFactoryForTests();
  const port = await resolveManagementOrchestrationQueuePort({
    managementEnabled: () => true,
    durableEnabled: () => false,
  });
  await port.enqueueJob({
    id: "job-factory-mem",
    projectId: "medimori",
    goalId: "g1",
    description: "factory",
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  const again = await resolveManagementOrchestrationQueuePort({
    managementEnabled: () => true,
    durableEnabled: () => false,
  });
  assert.equal((await again.listJobs()).some((job) => job.id === "job-factory-mem"), true);
  resetOrchestrationQueueFactoryForTests();
});

test("queue factory uses injected durable sql port when enabled", async () => {
  resetOrchestrationQueueFactoryForTests();
  const sql = createInMemoryOrchestrationSqlPort();
  setOrchestrationSqlPortFactoryForTests(async () => sql);
  const port = await resolveManagementOrchestrationQueuePort({
    managementEnabled: () => true,
    durableEnabled: () => true,
    createSqlPort: async () => sql,
  });
  await port.enqueueJob({
    id: "job-factory-durable",
    projectId: "medimori",
    goalId: "g1",
    description: "durable factory",
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  resetOrchestrationQueueFactoryForTests();
  setOrchestrationSqlPortFactoryForTests(async () => sql);
  const reloaded = await resolveManagementOrchestrationQueuePort({
    managementEnabled: () => true,
    durableEnabled: () => true,
    createSqlPort: async () => sql,
  });
  assert.equal(sql.tables.jobs.size, 1);
  assert.equal((await reloaded.listJobs()).some((job) => job.id === "job-factory-durable"), true);
  resetOrchestrationQueueFactoryForTests();
});

test("rejected sql completion reloads memory without marking assignment completed", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  const job = baseJobFixture({ id: "job-drift", state: "running", assignmentId: "asgn-drift", activeLeaseFence: 1 });
  const assignment = {
    id: "asgn-drift",
    jobId: job.id,
    projectId: "medimori" as const,
    agentId: "agent-test",
    state: "active" as const,
    contractVersion: ORCHESTRATION_ASSIGNMENT_CONTRACT_V1,
    lease: {
      holderAgentId: "agent-test",
      leasedAt: NOW,
      expiresAt: "2026-10-24T19:00:00.000Z",
      dispatchAttempt: 1,
      fenceToken: 1,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
  await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: NOW });
  await sql.upsertAssignment({
    id: assignment.id,
    job_id: job.id,
    payload_json: JSON.stringify(assignment),
    updated_at: NOW,
  });
  const store = await createDurableOrchestrationQueueStore(sql);
  const bumped = { ...assignment, lease: { ...assignment.lease, fenceToken: 2 } };
  await sql.upsertAssignment({
    id: bumped.id,
    job_id: job.id,
    payload_json: JSON.stringify(bumped),
    updated_at: NOW,
  });
  await assert.rejects(
    () => store.heartbeatAssignmentForAgent("agent-test", assignment.id, 1, NOW),
    /stale|fence/i,
  );
  await store.reloadFromSql();
  const reloadedAssignment = (await store.listAssignments()).find((row) => row.id === assignment.id);
  assert.equal(reloadedAssignment?.state, "active");
  assert.equal(reloadedAssignment?.lease.fenceToken, 2);
});

test("quarantine audit is idempotent across reloads", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await sql.upsertJob({
    id: "job-quarantine-repeat",
    payload_json: JSON.stringify({ contractVersion: "wrong", id: "job-quarantine-repeat" }),
    updated_at: NOW,
  });
  const first = await createDurableOrchestrationQueueStore(sql);
  assert.equal(first.quarantinedCount(), 1);
  assert.equal(sql.tables.quarantine.size, 1);
  await first.reloadFromSql();
  assert.equal(first.quarantinedCount(), 1);
  assert.equal(sql.tables.quarantine.size, 1);
});

test("malformed persisted job is quarantined on durable reload", async () => {
  const sql = createInMemoryOrchestrationSqlPort();
  await sql.upsertJob({
    id: "job-bad-mem",
    payload_json: JSON.stringify({ contractVersion: "wrong", id: "job-bad-mem" }),
    updated_at: NOW,
  });
  const store = await createDurableOrchestrationQueueStore(sql);
  assert.equal(store.quarantinedCount(), 1);
  assert.equal(sql.tables.quarantine.size, 1);
  assert.equal(sql.tables.jobs.has("job-bad-mem"), true);
});
