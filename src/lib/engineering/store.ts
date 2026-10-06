import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { EngineeringInputError, assertTransition, classifyRisk, parsePlan, type Plan, type Status } from "./policy";

export type Task = { id: string; request: string; status: Status; plan: Plan | null; risk: string | null; version: number; created_by: string };
export type TaskHistory = { task: Task | undefined; runs: Record<string, unknown>[]; approvals: Record<string, unknown>[]; events: Record<string, unknown>[] };
export class EngineeringConflict extends Error {}

export const taskSubmissionKeyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function requireEngineeringEnabled() {
  if (process.env.ENGINEERING_CONTROL_PLANE_ENABLED !== "true") throw new EngineeringInputError("Engineering control plane is disabled.");
}

export async function createTask(request: string, actor: string, submissionKey: string, database = getSql()) {
  requireEngineeringEnabled();
  if (typeof request !== "string" || !request.trim() || request.length > 8000) throw new EngineeringInputError("Request must contain 1–8000 characters.");
  if (typeof actor !== "string" || !actor.trim() || actor.length > 120) throw new EngineeringInputError("A valid actor is required.");
  if (typeof submissionKey !== "string" || submissionKey.length > 36 || !taskSubmissionKeyPattern.test(submissionKey)) throw new EngineeringInputError("A valid task submission key is required.");

  const rows = await database`
    WITH task AS (
      INSERT INTO engineering_tasks(id,request,created_by,creation_key)
      VALUES (${randomUUID()}::uuid,${request.trim()},${actor},${submissionKey}::uuid)
      ON CONFLICT (creation_key) DO NOTHING RETURNING *
    ), event AS (
      INSERT INTO engineering_events(id,task_id,actor,action,details)
      SELECT ${randomUUID()}::uuid,id,${actor},'intake','{}'::jsonb FROM task
    ) SELECT id,request,status,plan,risk,version,created_by FROM task` as Task[];
  if (rows[0]) return rows[0];

  // The second statement sees the winning transaction after a concurrent insert.
  const existing = await database`SELECT id,request,status,plan,risk,version,created_by FROM engineering_tasks WHERE creation_key=${submissionKey}::uuid` as Task[];
  const task = existing[0];
  if (!task || task.created_by !== actor || task.request !== request.trim()) throw new EngineeringConflict("This submission key is already bound to a different request or actor.");
  return task;
}

export async function listTasks(database = getSql()) {
  requireEngineeringEnabled();
  return await database`SELECT * FROM engineering_tasks ORDER BY created_at DESC LIMIT 100` as Task[];
}

export async function taskHistory(id: string, database = getSql()): Promise<TaskHistory> {
  requireEngineeringEnabled();
  const [tasks, runs, approvals, events] = await Promise.all([
    database`SELECT * FROM engineering_tasks WHERE id=${id}::uuid`,
    database`SELECT * FROM engineering_runs WHERE task_id=${id}::uuid ORDER BY started_at DESC LIMIT 100`,
    database`SELECT * FROM engineering_approvals WHERE task_id=${id}::uuid ORDER BY created_at DESC LIMIT 100`,
    database`SELECT * FROM engineering_events WHERE task_id=${id}::uuid ORDER BY created_at DESC LIMIT 100`,
  ]);
  return { task: tasks[0] as Task | undefined, runs, approvals, events };
}

/** Version-checked human control-plane transition with approval/run/audit writes in one statement. */
export async function actOnTask(id: string, version: number, action: string, value: unknown, actor: string, database = getSql()) {
  requireEngineeringEnabled();
  if (!taskSubmissionKeyPattern.test(id) || !Number.isSafeInteger(version) || version < 0 || !actor.trim() || actor.length > 120) throw new EngineeringInputError("Task action is invalid.");
  const rows = await database`SELECT id,request,status,plan,risk,version,created_by FROM engineering_tasks WHERE id=${id}::uuid` as Task[];
  const task = rows[0];
  if (!task || task.version !== version) throw new EngineeringConflict("Task changed; reload before acting.");

  let next = task.status;
  let plan = task.plan;
  let risk = task.risk;
  let decision: "approved" | "rejected" | null = null;
  if (action === "plan") {
    if (task.status !== "analyzing") throw new EngineeringInputError("Analyze the task before submitting a plan.");
    plan = parsePlan(value);
    risk = classifyRisk(plan);
    next = "planned";
  } else if (action === "approve" || action === "reject") {
    if (task.status !== "awaiting_approval" || !plan) throw new EngineeringInputError("No plan awaiting approval.");
    decision = action === "approve" ? "approved" : "rejected";
    next = action === "approve" ? "implementing" : "cancelled";
  } else if (action === "transition") {
    if (typeof value !== "string") throw new EngineeringInputError("Status is required.");
    if (!["analyzing", "awaiting_approval", "blocked", "cancelled", "escalated"].includes(value)) throw new EngineeringInputError("Unsupported transition.");
    next = value as Status;
  } else {
    throw new EngineeringInputError("Unsupported action.");
  }
  assertTransition(task.status, next);

  const approved = decision === "approved";
  const result = await database`
    WITH changed AS (
      UPDATE engineering_tasks SET status=${next},plan=${JSON.stringify(plan)}::jsonb,risk=${risk},version=version+1,updated_at=now()
      WHERE id=${id}::uuid AND version=${version}
      RETURNING *
    ), approval AS (
      INSERT INTO engineering_approvals(id,task_id,plan_version,gate,decision,actor)
      SELECT ${randomUUID()}::uuid,id,${version},'plan',${decision},${actor} FROM changed WHERE ${decision !== null}
    ), run AS (
      INSERT INTO engineering_runs(id,task_id,plan_version,worker_enabled,attempt_number,plan_snapshot,disposition)
      SELECT ${randomUUID()}::uuid,id,${version},${process.env.ENGINEERING_WORKER_ENABLED === "true"},1,${JSON.stringify(plan)}::jsonb,'active' FROM changed WHERE ${approved}
    ), event AS (
      INSERT INTO engineering_events(id,task_id,actor,action,details)
      SELECT ${randomUUID()}::uuid,id,${actor},${action},${JSON.stringify({ from: task.status, to: next, version })}::jsonb FROM changed
    ) SELECT id,request,status,plan,risk,version,created_by FROM changed` as Task[];
  if (!result[0]) throw new EngineeringConflict("Task changed; reload before acting.");
  return result[0];
}
