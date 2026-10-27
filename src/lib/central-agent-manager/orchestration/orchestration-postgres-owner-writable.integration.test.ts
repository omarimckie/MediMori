import assert from "node:assert/strict";
import test from "node:test";
import { parseManagerJob, serializeManagerJob } from "./contracts-v1";
import { createNeonOrchestrationTransactionalClient } from "./neon-orchestration-client";
import { createPostgresqlOrchestrationSqlPort } from "./postgresql-orchestration-sql-port";
import type { OrchestrationSqlPort } from "./orchestration-sql-port";
import { baseJobFixture, NOW } from "./test-fixtures";

const disposableUrl = process.env.CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL?.trim();
const runSuffix = `${Date.now()}`;

const pgOwnerWritableTest = disposableUrl ? test : test.skip.bind(test);

function uniqueId(label: string): string {
  return `job-ow-pg-${label}-${runSuffix}`;
}

async function loadJobPayload(sql: OrchestrationSqlPort, jobId: string) {
  const row = (await sql.loadJobs()).find((entry) => entry.id === jobId);
  if (!row) return null;
  return parseManagerJob(row.payload_json);
}

async function activeAssignmentsForJob(sql: OrchestrationSqlPort, jobId: string) {
  const rows = await sql.loadAssignments();
  return rows.filter((entry) => {
    const jobKey = entry.job_id ?? (JSON.parse(entry.payload_json) as { jobId?: string }).jobId;
    if (jobKey !== jobId) return false;
    const state = (JSON.parse(entry.payload_json) as { state?: string }).state;
    return state === "active";
  });
}

function activeAssignmentFixture(jobId: string, assignmentId: string, fenceToken: number) {
  return {
    id: assignmentId,
    jobId,
    projectId: "medimori",
    agentId: `agent-ow-pg-${runSuffix}`,
    state: "active",
    contractVersion: "central-agent-orchestration-assignment/v1",
    lease: {
      holderAgentId: `agent-ow-pg-${runSuffix}`,
      leasedAt: NOW,
      expiresAt: "2026-10-24T19:00:00.000Z",
      dispatchAttempt: 1,
      fenceToken,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

pgOwnerWritableTest("real postgres owner writable updates ready job without active assignment", async () => {
  const client = createNeonOrchestrationTransactionalClient(disposableUrl!);
  const sql = createPostgresqlOrchestrationSqlPort(client);
  const jobId = uniqueId("ready-update");
  const ready = baseJobFixture({ id: jobId, state: "ready", blockReason: null });
  await sql.upsertJob({ id: jobId, payload_json: serializeManagerJob(ready), updated_at: NOW });
  const blocked = baseJobFixture({
    id: jobId,
    state: "blocked",
    blockReason: "dependency",
    updatedAt: "2026-10-24T18:05:00.000Z",
  });
  const written = await sql.upsertJobIfOwnerWritable({
    id: jobId,
    payload_json: serializeManagerJob(blocked),
    updated_at: blocked.updatedAt,
  });
  assert.equal(written, true);
  const payload = await loadJobPayload(sql, jobId);
  assert.equal(payload?.state, "blocked");
  assert.equal(payload?.blockReason, "dependency");
});

pgOwnerWritableTest("real postgres owner writable rejects running job overwrite", async () => {
  const client = createNeonOrchestrationTransactionalClient(disposableUrl!);
  const sql = createPostgresqlOrchestrationSqlPort(client);
  const jobId = uniqueId("running-guard");
  const assignmentId = `asgn-ow-pg-running-${runSuffix}`;
  const ready = baseJobFixture({ id: jobId, state: "ready" });
  await sql.upsertJob({ id: jobId, payload_json: serializeManagerJob(ready), updated_at: NOW });
  const running = baseJobFixture({
    id: jobId,
    state: "running",
    assignmentId,
    activeLeaseFence: 1,
    updatedAt: "2026-10-24T18:01:00.000Z",
  });
  const assignment = activeAssignmentFixture(jobId, assignmentId, 1);
  const claimed = await sql.tryClaimReadyJob({
    jobId,
    jobJson: serializeManagerJob(running),
    assignmentId,
    assignmentJson: JSON.stringify(assignment),
    assignmentJobId: jobId,
    now: running.updatedAt,
  });
  assert.equal(claimed, true);
  const staleReady = baseJobFixture({ id: jobId, state: "ready", updatedAt: "2026-10-24T18:02:00.000Z" });
  const written = await sql.upsertJobIfOwnerWritable({
    id: jobId,
    payload_json: serializeManagerJob(staleReady),
    updated_at: staleReady.updatedAt,
  });
  assert.equal(written, false);
  const payload = await loadJobPayload(sql, jobId);
  assert.equal(payload?.state, "running");
  assert.equal(payload?.assignmentId, assignmentId);
});

pgOwnerWritableTest("real postgres owner writable rejects when active assignment exists", async () => {
  const client = createNeonOrchestrationTransactionalClient(disposableUrl!);
  const sql = createPostgresqlOrchestrationSqlPort(client);
  const jobId = uniqueId("active-asgn");
  const assignmentId = `asgn-ow-pg-active-${runSuffix}`;
  const ready = baseJobFixture({ id: jobId, state: "ready" });
  await sql.upsertJob({ id: jobId, payload_json: serializeManagerJob(ready), updated_at: NOW });
  const assignment = activeAssignmentFixture(jobId, assignmentId, 1);
  await sql.upsertAssignment({
    id: assignmentId,
    job_id: jobId,
    payload_json: JSON.stringify(assignment),
    updated_at: NOW,
  });
  const staleBlocked = baseJobFixture({
    id: jobId,
    state: "blocked",
    blockReason: "dependency",
    updatedAt: "2026-10-24T18:03:00.000Z",
  });
  const written = await sql.upsertJobIfOwnerWritable({
    id: jobId,
    payload_json: serializeManagerJob(staleBlocked),
    updated_at: staleBlocked.updatedAt,
  });
  assert.equal(written, false);
  const payload = await loadJobPayload(sql, jobId);
  assert.equal(payload?.state, "ready");
});

pgOwnerWritableTest("real postgres owner writable preserves consumer externalRefs on running job", async () => {
  const client = createNeonOrchestrationTransactionalClient(disposableUrl!);
  const sql = createPostgresqlOrchestrationSqlPort(client);
  const jobId = uniqueId("external-refs");
  const assignmentId = `asgn-ow-pg-ext-${runSuffix}`;
  const ready = baseJobFixture({ id: jobId, state: "ready" });
  await sql.upsertJob({ id: jobId, payload_json: serializeManagerJob(ready), updated_at: NOW });
  const running = baseJobFixture({
    id: jobId,
    state: "running",
    assignmentId,
    activeLeaseFence: 2,
    updatedAt: "2026-10-24T18:04:00.000Z",
  });
  const assignment = activeAssignmentFixture(jobId, assignmentId, 2);
  assert.equal(
    await sql.tryClaimReadyJob({
      jobId,
      jobJson: serializeManagerJob(running),
      assignmentId,
      assignmentJson: JSON.stringify(assignment),
      assignmentJobId: jobId,
      now: running.updatedAt,
    }),
    true,
  );
  const externalRefs = { cursorAgentId: `bc-ow-pg-${runSuffix}`, cursorRunId: `run-ow-pg-${runSuffix}` };
  const confirmedAssignment = { ...assignment, externalRefs };
  const confirmedJob = { ...running, externalRefs, updatedAt: "2026-10-24T18:05:00.000Z" };
  assert.equal(
    await sql.updateAssignmentWithJobIfFence({
      assignmentId,
      assignmentJson: JSON.stringify(confirmedAssignment),
      fenceToken: 2,
      jobId,
      jobJson: serializeManagerJob(confirmedJob),
      now: confirmedJob.updatedAt,
      allowedAssignmentStates: ["active"],
    }),
    true,
  );
  const staleReady = baseJobFixture({ id: jobId, state: "ready", updatedAt: "2026-10-24T18:06:00.000Z" });
  assert.equal(
    await sql.upsertJobIfOwnerWritable({
      id: jobId,
      payload_json: serializeManagerJob(staleReady),
      updated_at: staleReady.updatedAt,
    }),
    false,
  );
  const payload = await loadJobPayload(sql, jobId);
  assert.equal(payload?.state, "running");
  assert.deepEqual(payload?.externalRefs, externalRefs);
});

pgOwnerWritableTest("real postgres concurrent claim blocks stale owner writable write", async () => {
  const clientA = createNeonOrchestrationTransactionalClient(disposableUrl!);
  const clientB = createNeonOrchestrationTransactionalClient(disposableUrl!);
  const sqlA = createPostgresqlOrchestrationSqlPort(clientA);
  const sqlB = createPostgresqlOrchestrationSqlPort(clientB);
  const jobId = uniqueId("concurrent");
  const assignmentId = `asgn-ow-pg-conc-${runSuffix}`;
  const ready = baseJobFixture({ id: jobId, state: "ready" });
  await sqlA.upsertJob({ id: jobId, payload_json: serializeManagerJob(ready), updated_at: NOW });
  const running = baseJobFixture({
    id: jobId,
    state: "running",
    assignmentId,
    activeLeaseFence: 1,
    updatedAt: "2026-10-24T18:07:00.000Z",
  });
  const assignment = activeAssignmentFixture(jobId, assignmentId, 1);
  const staleReady = baseJobFixture({ id: jobId, state: "ready", updatedAt: "2026-10-24T18:08:00.000Z" });
  const [claimed, ownerWritten] = await Promise.all([
    sqlA.tryClaimReadyJob({
      jobId,
      jobJson: serializeManagerJob(running),
      assignmentId,
      assignmentJson: JSON.stringify(assignment),
      assignmentJobId: jobId,
      now: running.updatedAt,
    }),
    sqlB.upsertJobIfOwnerWritable({
      id: jobId,
      payload_json: serializeManagerJob(staleReady),
      updated_at: staleReady.updatedAt,
    }),
  ]);
  assert.equal(claimed, true);
  assert.equal(ownerWritten, false);
  const payload = await loadJobPayload(sqlA, jobId);
  assert.equal(payload?.state, "running");
  assert.equal((await activeAssignmentsForJob(sqlA, jobId)).length, 1);
});
