import { getSql } from "@/lib/db";
import type { EngineeringStatus, StatusExecutionAttempt, StatusPlan, StatusTask } from "./types";

export class StatusReadModelError extends Error {}

export function requireStatusReadModelEnabled(): void {
  if (process.env.ENGINEERING_CONTROL_PLANE_ENABLED !== "true") {
    throw new StatusReadModelError("Engineering control plane is disabled.");
  }
}

function parsePlan(value: unknown): StatusPlan | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string" || !record.summary.trim()) return null;
  return { summary: record.summary.trim() };
}

function mapAttempt(row: Record<string, unknown>): StatusExecutionAttempt {
  return {
    id: String(row.id),
    attemptNumber: Number(row.attemptNumber),
    planVersion: Number(row.planVersion),
    startedAt: String(row.startedAt),
    finishedAt: row.finishedAt ? String(row.finishedAt) : null,
    disposition: String(row.disposition),
    modelCalls: Number(row.modelCalls ?? 0),
    tokens: Number(row.tokens ?? 0),
    costUsd: String(row.costUsd ?? "0"),
    workerEnabled: row.workerEnabled === true,
    workerLeaseActive: row.workerLeaseActive === true,
  };
}

function isEngineeringStatus(value: string): value is EngineeringStatus {
  return (
    value === "intake" ||
    value === "analyzing" ||
    value === "planned" ||
    value === "awaiting_approval" ||
    value === "implementing" ||
    value === "validating" ||
    value === "repairing" ||
    value === "reviewing" ||
    value === "awaiting_merge" ||
    value === "merging" ||
    value === "completed" ||
    value === "blocked" ||
    value === "cancelled" ||
    value === "escalated"
  );
}

/** Read-only task list for central-agent-status/v1 (no worker, merge executor, or admin mutations). */
export async function listTasksForStatus(database = getSql()): Promise<StatusTask[]> {
  requireStatusReadModelEnabled();

  const rows = await database`
    SELECT t.id, t.status, t.plan, t.updated_at,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', a.id,
          'attemptNumber', a.attempt_number_display,
          'planVersion', a.plan_version,
          'startedAt', a.started_at,
          'finishedAt', a.finished_at,
          'disposition', CASE
            WHEN a.finished_at IS NULL
              AND a.started_at <= now() - interval '30 minutes'
              AND COALESCE(a.disposition, 'active') = 'active'
            THEN 'expired'
            WHEN a.disposition IS NOT NULL THEN a.disposition
            WHEN a.finished_at IS NULL THEN 'active'
            WHEN t.status IN ('blocked', 'cancelled') THEN t.status
            ELSE 'closed_legacy'
          END,
          'modelCalls', a.model_calls,
          'tokens', a.tokens,
          'costUsd', a.cost_usd,
          'workerEnabled', a.worker_enabled,
          'workerLeaseActive', (a.worker_enabled AND a.lease_until IS NOT NULL AND a.lease_until > now())
        ) ORDER BY a.attempt_number_display DESC)
        FROM (
          SELECT r.*,
            COALESCE(
              r.attempt_number,
              row_number() OVER (PARTITION BY r.task_id ORDER BY r.started_at, r.id)::integer
            ) AS attempt_number_display
          FROM engineering_runs r
          WHERE r.task_id = t.id
        ) a
      ), '[]'::json) AS attempts
    FROM engineering_tasks t
    ORDER BY t.created_at DESC
    LIMIT 100
  ` as Array<Record<string, unknown>>;

  const tasks: StatusTask[] = rows.map((row) => {
    const statusRaw = String(row.status ?? "");
    const status = isEngineeringStatus(statusRaw) ? statusRaw : "blocked";
    const attemptsRaw = row.attempts;
    const attempts = Array.isArray(attemptsRaw)
      ? attemptsRaw.map((item) => mapAttempt(item as Record<string, unknown>))
      : [];
    return {
      id: String(row.id),
      status,
      plan: parsePlan(row.plan),
      updated_at: row.updated_at ? String(row.updated_at) : undefined,
      attempts,
    };
  });

  const mergeCandidates = tasks.filter((task) => task.status === "awaiting_merge");
  if (!mergeCandidates.length) return tasks;

  const ids = mergeCandidates.map((task) => task.id);
  const approvals = await database`
    SELECT DISTINCT ON (task_id) task_id, status
    FROM engineering_merge_approvals
    WHERE task_id = ANY(${ids}::uuid[])
    ORDER BY task_id, created_at DESC
  ` as Array<{ task_id: string; status: string }>;

  const byTask = new Map(approvals.map((row) => [String(row.task_id), String(row.status)]));
  return tasks.map((task) => {
    if (task.status !== "awaiting_merge") return task;
    const status = byTask.get(task.id);
    return {
      ...task,
      mergeReview: {
        approvalStatus: status ?? "not_requested",
      },
    };
  });
}
