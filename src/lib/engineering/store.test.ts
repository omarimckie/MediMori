import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { getSql } from "@/lib/db";
import { actOnTask, createTask, listTasks, recordRunEvidence, taskHistory } from "./store";

async function createTestSql() {
  const db = new PGlite();
  await db.exec(await readFile(new URL("../../../sql/engineering-schema.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url), "utf8"));
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => (await db.query(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as unknown as ReturnType<typeof getSql>;
  return { db, sql };
}

test("task creation is idempotent per key, including concurrent replay, with one intake event", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const key = "a2222222-2222-4222-8222-222222222222";
    const [first, replay] = await Promise.all([
      createTask("Same request", "owner", key, sql),
      createTask("Same request", "owner", key, sql),
    ]);
    assert.equal(first.id, replay.id);
    assert.equal((await sql`SELECT * FROM engineering_tasks WHERE creation_key=${key}::uuid`).length, 1);
    const events = await sql`SELECT * FROM engineering_events WHERE task_id=${first.id}::uuid AND action='intake'`;
    assert.equal(events.length, 1);
    assert.equal(events[0].actor, "owner");
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("different keys allow intentional identical requests; a key cannot be reused for changed content", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    const one = await createTask("Same request", "owner", "a3333333-3333-4333-8333-333333333333", sql);
    const two = await createTask("Same request", "owner", "a4444444-4444-4444-8444-444444444444", sql);
    assert.notEqual(one.id, two.id);
    await assert.rejects(createTask("Different request", "owner", "a3333333-3333-4333-8333-333333333333", sql), /already bound/);
    assert.equal((await sql`SELECT * FROM engineering_events WHERE action='intake'`).length, 2);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("task submission keys are required and bounded", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    for (const key of [undefined, "not-a-uuid", "a".repeat(37)]) {
      await assert.rejects(createTask("Request", "owner", key as string, sql), /submission key/);
    }
    assert.equal((await sql`SELECT * FROM engineering_tasks`).length, 0);
  } finally { await db.close(); delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED; }
});

test("human plan approval is version-checked, audited, and creates one execution record", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  process.env.ENGINEERING_WORKER_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    let task = await createTask("Fix isolated feature", "owner", "a5555555-5555-4555-8555-555555555555", sql);
    await assert.rejects(actOnTask(task.id, task.version, "approve", null, "owner", sql));
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "owner", sql);
    task = await actOnTask(task.id, task.version, "plan", { summary: "Bounded fix", files: ["src/lib/demo.ts"], validations: ["typecheck", "lint"], operations: [] }, "owner", sql);
    task = await actOnTask(task.id, task.version, "transition", "awaiting_approval", "owner", sql);
    const approvedVersion = task.version;
    const approvals = await Promise.allSettled([
      actOnTask(task.id, task.version, "approve", null, "owner", sql),
      actOnTask(task.id, task.version, "approve", null, "owner", sql),
    ]);
    assert.equal(approvals.filter(result => result.status === "fulfilled").length, 1);
    task = (await taskHistory(task.id, sql)).task!;
    assert.equal(task.status, "implementing");
    assert.equal(task.version, approvedVersion + 1);
    const history = await taskHistory(task.id, sql);
    assert.equal(history.approvals.length, 1);
    assert.equal(history.approvals[0].plan_version, approvedVersion);
    assert.equal(history.approvals[0].decision, "approved");
    assert.equal(history.runs.length, 1);
    assert.equal(history.runs[0].plan_version, approvedVersion);
    assert.equal(history.runs[0].worker_enabled, true);
    assert.equal(history.events.length, 5);
    assert.equal((await listTasks(sql)).length, 1);
    await assert.rejects(actOnTask(task.id, approvedVersion, "approve", null, "owner", sql));
  } finally {
    await db.close();
    delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
    delete process.env.ENGINEERING_WORKER_ENABLED;
  }
});

test("run evidence is version-bound, bounded, persisted by kind, and audited without free-text metadata", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  delete process.env.ENGINEERING_WORKER_ENABLED;
  const { db, sql } = await createTestSql();
  try {
    let task = await createTask("Record bounded evidence", "owner", "a8888888-8888-4888-8888-888888888888", sql);
    task = await actOnTask(task.id, task.version, "transition", "analyzing", "owner", sql);
    task = await actOnTask(task.id, task.version, "plan", { summary: "Test evidence", files: ["src/a.ts"], validations: ["lint"], operations: [] }, "owner", sql);
    task = await actOnTask(task.id, task.version, "transition", "awaiting_approval", "owner", sql);
    task = await actOnTask(task.id, task.version, "approve", null, "owner", sql);
    await db.query("UPDATE engineering_tasks SET status='validating' WHERE id=$1::uuid", [task.id]);

    const validation = { kind: "validation", command: "lint", outcome: "failed", revision: "a".repeat(40), summary: "Bounded diagnostic summary" };
    await recordRunEvidence(task.id, task.version, validation, "owner", sql);
    const afterValidation = await taskHistory(task.id, sql);
    const validationVersion = task.version;
    task = afterValidation.task!;
    assert.equal(task.version, validationVersion + 1);
    const persistedValidation = (await sql`SELECT command,outcome,revision,summary,cycle FROM engineering_validations WHERE run_id=${afterValidation.runs[0].id}::uuid`)[0];
    assert.deepEqual(persistedValidation, { command: "lint", outcome: "failed", revision: "a".repeat(40), summary: "Bounded diagnostic summary", cycle: 0 });

    const cost = { kind: "cost", provider: "provider-test", model: "model-test", operation: "implementation", tokens: 42, estimatedCostUsd: 0.01, summary: "must not enter event log" };
    await recordRunEvidence(task.id, task.version, cost, "owner", sql);
    const history = await taskHistory(task.id, sql);
    assert.equal(Number(history.runs[0].model_calls), 1);
    assert.equal(Number(history.runs[0].tokens), 42);
    assert.equal(Number(history.runs[0].cost_usd), 0.01);
    const persistedCost = (await sql`SELECT provider,model,operation,tokens,estimated_cost_usd FROM engineering_costs WHERE run_id=${history.runs[0].id}::uuid`)[0];
    assert.deepEqual(persistedCost, { provider: "provider-test", model: "model-test", operation: "implementation", tokens: 42, estimated_cost_usd: "0.010000" });
    const validationEvent = history.events.find(event => event.action === "validation")!;
    assert.deepEqual(validationEvent.details, { kind: "validation", version: validationVersion, command: "lint", outcome: "failed", revision: "a".repeat(40), runId: history.runs[0].id, cycle: 0 });
    const costEvent = history.events.find(event => event.action === "cost")!;
    assert.deepEqual(costEvent.details, { kind: "cost", version: task.version, tokens: 42, estimatedCostUsd: 0.01, runId: history.runs[0].id, cycle: 0 });
    assert.doesNotMatch(JSON.stringify(history.events), /provider-test|model-test|must not enter event log|Bounded diagnostic summary/);

    await assert.rejects(recordRunEvidence(task.id, task.version, cost, "owner", sql), /stale version/);
    await assert.rejects(recordRunEvidence(task.id, history.task!.version, { ...validation, command: "not-allowlisted" }, "owner", sql), /Invalid validation evidence/);
    await assert.rejects(recordRunEvidence(task.id, history.task!.version, { ...cost, tokens: 60001 }, "owner", sql), /execution limit/);
    await assert.rejects(recordRunEvidence(task.id, history.task!.version, { ...cost, estimatedCostUsd: 5 }, "owner", sql), /execution limit/);
    assert.equal((await sql`SELECT * FROM engineering_costs WHERE run_id=${history.runs[0].id}::uuid`).length, 1);
  } finally {
    await db.close();
    delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
    delete process.env.ENGINEERING_WORKER_ENABLED;
  }
});

test("run evidence rejects worker-owned runs and expired executions", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  const { db, sql } = await createTestSql();
  try {
    process.env.ENGINEERING_WORKER_ENABLED = "true";
    let workerTask = await createTask("Worker-owned evidence", "owner", "a9999999-9999-4999-8999-999999999999", sql);
    workerTask = await actOnTask(workerTask.id, workerTask.version, "transition", "analyzing", "owner", sql);
    workerTask = await actOnTask(workerTask.id, workerTask.version, "plan", { summary: "Worker", files: ["src/a.ts"], validations: ["lint"], operations: [] }, "owner", sql);
    workerTask = await actOnTask(workerTask.id, workerTask.version, "transition", "awaiting_approval", "owner", sql);
    workerTask = await actOnTask(workerTask.id, workerTask.version, "approve", null, "owner", sql);
    await assert.rejects(recordRunEvidence(workerTask.id, workerTask.version, { kind: "cost", provider: "test", model: "test", operation: "test", tokens: 0, estimatedCostUsd: 0 }, "owner", sql), /inactive run/);

    delete process.env.ENGINEERING_WORKER_ENABLED;
    let humanTask = await createTask("Expired evidence", "owner", "abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sql);
    humanTask = await actOnTask(humanTask.id, humanTask.version, "transition", "analyzing", "owner", sql);
    humanTask = await actOnTask(humanTask.id, humanTask.version, "plan", { summary: "Human", files: ["src/a.ts"], validations: ["lint"], operations: [] }, "owner", sql);
    humanTask = await actOnTask(humanTask.id, humanTask.version, "transition", "awaiting_approval", "owner", sql);
    humanTask = await actOnTask(humanTask.id, humanTask.version, "approve", null, "owner", sql);
    await db.query("UPDATE engineering_runs SET started_at=now()-interval '31 minutes' WHERE task_id=$1::uuid", [humanTask.id]);
    await assert.rejects(recordRunEvidence(humanTask.id, humanTask.version, { kind: "cost", provider: "test", model: "test", operation: "test", tokens: 0, estimatedCostUsd: 0 }, "owner", sql), /inactive run/);
  } finally {
    await db.close();
    delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
    delete process.env.ENGINEERING_WORKER_ENABLED;
  }
});
