import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { getSql } from "@/lib/db";
import { actOnTask, createTask, listTasks, taskHistory } from "./store";

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
