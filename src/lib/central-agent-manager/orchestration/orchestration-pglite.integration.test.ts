import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { ORCHESTRATION_ASSIGNMENT_CONTRACT_V1, serializeManagerJob } from "./contracts-v1";
import { createDurableOrchestrationQueueStore } from "./durable-orchestration-queue-store";
import { createPostgresqlOrchestrationSqlPort } from "./postgresql-orchestration-sql-port";
import { applyOrchestrationSchemaToPglite, createPgliteTransactionalClient } from "./pglite-orchestration-client";
import { baseJobFixture, NOW } from "./test-fixtures";

const schemaSql = readFileSync(
  join(process.cwd(), "sql", "central-agent-manager-orchestration.sql"),
  "utf8",
);

async function createIsolatedPgOrchestration() {
  const db = new PGlite();
  await applyOrchestrationSchemaToPglite(db, schemaSql);
  const client = createPgliteTransactionalClient(db);
  const sql = createPostgresqlOrchestrationSqlPort(client);
  return { db, sql };
}

function activeAssignmentFixture(jobId: string, assignmentId: string, fenceToken: number) {
  return {
    id: assignmentId,
    jobId,
    projectId: "medimori" as const,
    agentId: "agent-a",
    state: "active" as const,
    contractVersion: ORCHESTRATION_ASSIGNMENT_CONTRACT_V1,
    lease: {
      holderAgentId: "agent-a",
      leasedAt: NOW,
      expiresAt: "2026-10-24T19:00:00.000Z",
      dispatchAttempt: 1,
      fenceToken,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test("pglite durable store survives simulated process restart", async () => {
  const { sql } = await createIsolatedPgOrchestration();
  const first = await createDurableOrchestrationQueueStore(sql);
  await first.enqueueJob({
    id: "job-restart-pg",
    projectId: "medimori",
    goalId: "g1",
    description: "restart",
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    now: NOW,
  });
  const second = await createDurableOrchestrationQueueStore(sql);
  const jobs = await second.listJobs();
  assert.equal(jobs.some((job) => job.id === "job-restart-pg"), true);
});

test("pglite concurrent claims cannot assign the same ready job twice", async () => {
  const { sql } = await createIsolatedPgOrchestration();
  const readyJob = baseJobFixture({ id: "job-claim-pg", state: "ready" });
  await sql.upsertJob({ id: readyJob.id, payload_json: serializeManagerJob(readyJob), updated_at: NOW });
  const runningA = baseJobFixture({
    id: readyJob.id,
    state: "running",
    assignmentId: "asgn-a",
    activeLeaseFence: 1,
  });
  const runningB = baseJobFixture({
    id: readyJob.id,
    state: "running",
    assignmentId: "asgn-b",
    activeLeaseFence: 2,
  });
  const assignmentA = activeAssignmentFixture(readyJob.id, "asgn-a", 1);
  const assignmentB = activeAssignmentFixture(readyJob.id, "asgn-b", 2);
  const wonA = await sql.tryClaimReadyJob({
    jobId: readyJob.id,
    jobJson: serializeManagerJob(runningA),
    assignmentId: assignmentA.id,
    assignmentJson: JSON.stringify(assignmentA),
    assignmentJobId: readyJob.id,
    now: NOW,
  });
  const wonB = await sql.tryClaimReadyJob({
    jobId: readyJob.id,
    jobJson: serializeManagerJob(runningB),
    assignmentId: assignmentB.id,
    assignmentJson: JSON.stringify(assignmentB),
    assignmentJobId: readyJob.id,
    now: NOW,
  });
  assert.equal(wonA, true);
  assert.equal(wonB, false);
  const assignments = await sql.loadAssignments();
  assert.equal(assignments.length, 1);
});

test("pglite stale fence cannot complete active assignment", async () => {
  const { sql } = await createIsolatedPgOrchestration();
  const job = baseJobFixture({ id: "job-fence-pg", state: "running", assignmentId: "asgn-fence", activeLeaseFence: 1 });
  const assignment = activeAssignmentFixture(job.id, "asgn-fence", 1);
  await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: NOW });
  await sql.upsertAssignment({
    id: assignment.id,
    job_id: job.id,
    payload_json: JSON.stringify(assignment),
    updated_at: NOW,
  });
  const completedAssignment = { ...assignment, state: "completed" as const, updatedAt: NOW };
  const completedJob = { ...job, state: "completed" as const, updatedAt: NOW };
  const outcome = await sql.completeAssignmentIdempotent({
    assignmentId: assignment.id,
    assignmentJson: JSON.stringify(completedAssignment),
    jobId: job.id,
    jobJson: serializeManagerJob(completedJob),
    fenceToken: 99,
    now: NOW,
  });
  assert.equal(outcome, "rejected");
});

test("pglite reload quarantines malformed job payloads without deleting rows", async () => {
  const { sql } = await createIsolatedPgOrchestration();
  await sql.upsertJob({
    id: "job-bad-pg",
    payload_json: JSON.stringify({ contractVersion: "wrong", id: "job-bad-pg" }),
    updated_at: NOW,
  });
  const durable = await createDurableOrchestrationQueueStore(sql);
  assert.equal(durable.quarantinedCount(), 1);
  const jobs = await durable.listJobs();
  assert.equal(jobs.some((job) => job.id === "job-bad-pg"), false);
  const quarantined = await sql.loadQuarantined();
  assert.equal(quarantined.length, 1);
  const persisted = await sql.loadJobs();
  assert.equal(persisted.some((row) => row.id === "job-bad-pg"), true);
});
