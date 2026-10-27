/**
 * Real-PostgreSQL pool concurrency tests (skip unless CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL is set).
 * Assertions are scoped per job id so prior rows on the disposable branch do not affect outcomes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createNeonOrchestrationTransactionalClient } from "./neon-orchestration-client";
import { createPostgresqlOrchestrationSqlPort } from "./postgresql-orchestration-sql-port";
import type { OrchestrationSqlPort } from "./orchestration-sql-port";
import { baseJobFixture, NOW } from "./test-fixtures";
import { serializeManagerJob } from "./contracts-v1";

async function assignmentsForJob(sql: OrchestrationSqlPort, jobId: string) {
  const rows = await sql.loadAssignments();
  return rows.filter((entry) => {
    const key = entry.job_id ?? (JSON.parse(entry.payload_json) as { jobId?: string }).jobId;
    return key === jobId;
  });
}

async function activeAssignmentsForJob(sql: OrchestrationSqlPort, jobId: string) {
  const rows = await assignmentsForJob(sql, jobId);
  return rows.filter((entry) => {
    const state = (JSON.parse(entry.payload_json) as { state?: string }).state;
    return state === "active";
  });
}

const disposableUrl = process.env.CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL?.trim();
const schemaSql = readFileSync(
  join(process.cwd(), "sql", "central-agent-manager-orchestration.sql"),
  "utf8",
);

const poolConcurrencyTest = disposableUrl
  ? test
  : test.skip.bind(test);

poolConcurrencyTest(
  "real pool concurrent claims require CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL",
  async () => {
    const clientA = createNeonOrchestrationTransactionalClient(disposableUrl!);
    const clientB = createNeonOrchestrationTransactionalClient(disposableUrl!);
    const sqlA = createPostgresqlOrchestrationSqlPort(clientA);
    const sqlB = createPostgresqlOrchestrationSqlPort(clientB);
    for (const statement of schemaSql.split(";").map((part) => part.trim()).filter(Boolean)) {
      await clientA.query(statement);
    }
    const suffix = `${Date.now()}`;
    const jobId = `job-pool-${suffix}`;
    const assignmentIdA = `asgn-pool-a-${suffix}`;
    const assignmentIdB = `asgn-pool-b-${suffix}`;
    const readyJob = baseJobFixture({ id: jobId, state: "ready" });
    await sqlA.upsertJob({ id: readyJob.id, payload_json: serializeManagerJob(readyJob), updated_at: NOW });
    const runningA = baseJobFixture({
      id: readyJob.id,
      state: "running",
      assignmentId: assignmentIdA,
      activeLeaseFence: 1,
    });
    const runningB = baseJobFixture({
      id: readyJob.id,
      state: "running",
      assignmentId: assignmentIdB,
      activeLeaseFence: 2,
    });
    const [wonA, wonB] = await Promise.all([
      sqlA.tryClaimReadyJob({
        jobId: readyJob.id,
        jobJson: serializeManagerJob(runningA),
        assignmentId: assignmentIdA,
        assignmentJson: JSON.stringify({ id: assignmentIdA, jobId: readyJob.id, state: "active" }),
        assignmentJobId: readyJob.id,
        now: NOW,
      }),
      sqlB.tryClaimReadyJob({
        jobId: readyJob.id,
        jobJson: serializeManagerJob(runningB),
        assignmentId: assignmentIdB,
        assignmentJson: JSON.stringify({ id: assignmentIdB, jobId: readyJob.id, state: "active" }),
        assignmentJobId: readyJob.id,
        now: NOW,
      }),
    ]);
    assert.equal(wonA !== wonB, true);
    assert.equal((await activeAssignmentsForJob(sqlA, jobId)).length, 1);
    assert.equal((await assignmentsForJob(sqlA, jobId)).length, 1);
  },
);

poolConcurrencyTest("real pool renewAssignmentLease rejects stale fence", async () => {
  const client = createNeonOrchestrationTransactionalClient(disposableUrl!);
  const sql = createPostgresqlOrchestrationSqlPort(client);
  for (const statement of schemaSql.split(";").map((part) => part.trim()).filter(Boolean)) {
    await client.query(statement);
  }
  const assignmentId = `asgn-pool-hb-${Date.now()}`;
  const jobId = `job-pool-hb-${Date.now()}`;
  const readyJob = baseJobFixture({ id: jobId, state: "ready" });
  await sql.upsertJob({ id: jobId, payload_json: serializeManagerJob(readyJob), updated_at: NOW });
  const runningJob = baseJobFixture({
    id: jobId,
    state: "running",
    assignmentId,
    activeLeaseFence: 1,
  });
  const assignment = {
    id: assignmentId,
    jobId,
    projectId: "medimori",
    agentId: "agent-pool-hb",
    state: "active",
    contractVersion: "central-agent-orchestration-assignment/v1",
    lease: {
      holderAgentId: "agent-pool-hb",
      leasedAt: NOW,
      expiresAt: "2026-10-24T19:00:00.000Z",
      dispatchAttempt: 1,
      fenceToken: 1,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
  const claimed = await sql.tryClaimReadyJob({
    jobId,
    jobJson: serializeManagerJob(runningJob),
    assignmentId,
    assignmentJson: JSON.stringify(assignment),
    assignmentJobId: jobId,
    now: NOW,
  });
  assert.equal(claimed, true);
  const renewed = await sql.renewAssignmentLease({
    assignmentId,
    assignmentJson: JSON.stringify({
      ...assignment,
      lease: { ...assignment.lease, expiresAt: "2026-10-24T19:30:00.000Z" },
    }),
    fenceToken: 1,
    now: NOW,
  });
  assert.equal(renewed, true);
  const stale = await sql.renewAssignmentLease({
    assignmentId,
    assignmentJson: JSON.stringify(assignment),
    fenceToken: 0,
    now: NOW,
  });
  assert.equal(stale, false);
});

poolConcurrencyTest("real pool updateAssignmentWithJobIfFence rejects stale correlation write", async () => {
  const client = createNeonOrchestrationTransactionalClient(disposableUrl!);
  const sql = createPostgresqlOrchestrationSqlPort(client);
  for (const statement of schemaSql.split(";").map((part) => part.trim()).filter(Boolean)) {
    await client.query(statement);
  }
  const assignmentId = `asgn-pool-fence-${Date.now()}`;
  const jobId = `job-pool-fence-${Date.now()}`;
  const readyJob = baseJobFixture({ id: jobId, state: "ready" });
  await sql.upsertJob({ id: jobId, payload_json: serializeManagerJob(readyJob), updated_at: NOW });
  const runningJob = baseJobFixture({
    id: jobId,
    state: "running",
    assignmentId,
    activeLeaseFence: 2,
  });
  const assignment = {
    id: assignmentId,
    jobId,
    projectId: "medimori",
    agentId: "agent-pool-fence",
    state: "active",
    contractVersion: "central-agent-orchestration-assignment/v1",
    lease: {
      holderAgentId: "agent-pool-fence",
      leasedAt: NOW,
      expiresAt: "2026-10-24T19:00:00.000Z",
      dispatchAttempt: 1,
      fenceToken: 2,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
  await sql.tryClaimReadyJob({
    jobId,
    jobJson: serializeManagerJob(runningJob),
    assignmentId,
    assignmentJson: JSON.stringify(assignment),
    assignmentJobId: jobId,
    now: NOW,
  });
  const confirmedAssignment = {
    ...assignment,
    externalRefs: { cursorAgentId: "bc-pool-00000001", cursorRunId: "run-pool-00000001" },
  };
  const confirmedJob = { ...runningJob, externalRefs: confirmedAssignment.externalRefs };
  const ok = await sql.updateAssignmentWithJobIfFence({
    assignmentId,
    assignmentJson: JSON.stringify(confirmedAssignment),
    fenceToken: 2,
    jobId,
    jobJson: serializeManagerJob(confirmedJob),
    now: NOW,
    allowedAssignmentStates: ["active"],
  });
  assert.equal(ok, true);
  const stale = await sql.updateAssignmentWithJobIfFence({
    assignmentId,
    assignmentJson: JSON.stringify(assignment),
    fenceToken: 1,
    jobId,
    jobJson: serializeManagerJob(runningJob),
    now: NOW,
    allowedAssignmentStates: ["active"],
  });
  assert.equal(stale, false);
});
