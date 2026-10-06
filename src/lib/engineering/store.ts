import { executablePlan } from "./worker-policy";
import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { EngineeringInputError, assertTransition, classifyRisk, limits, parsePlan, validationCommands, type Plan, type Status } from "./policy";
import { configuredMergeTarget, mergeTargetPolicy } from "./merge-policy";
import { readApprovedTargetBaseSha, readTargetPreimagesAtSha, readWorkerTargetBaseSha } from "./merge-target";

export type MergeReview = { runId: string; attemptNumber: number; planVersion: number; resultingRevision: string; files: Array<{ path: string; beforeSha256: string; afterSha256: string }>; validations: string[]; passedValidations: string[]; passedValidationCount: number; selfReviewPassed: boolean; targetRepository: string; targetBranch: string; targetBaseSha: string | null; approvalId: string | null; approvalStatus: string };
export type Task = { id: string; request: string; status: Status; plan: Plan | null; risk: string | null; version: number; created_by: string; attempts?: ExecutionAttempt[]; latestPreparation?: { previousAttemptNumber: number; toVersion: number } | null; mergeReview?: MergeReview | null };
export type ExecutionAttempt = { id: string; attemptNumber: number; planVersion: number; startedAt: string; finishedAt: string | null; disposition: string; modelCalls: number; tokens: number; costUsd: string };
export type AttemptPreparation = { idempotency_key: string; previous_run_id: string; previous_attempt_number: number; previous_disposition: string; from_version: number; to_version: number; created_at: string };
export class EngineeringConflict extends Error {}
export const taskSubmissionKeyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function requireEngineeringEnabled() {
  if (process.env.ENGINEERING_CONTROL_PLANE_ENABLED !== "true") throw new EngineeringInputError("Engineering control plane is disabled.");
}
export async function listTasks(database = getSql()) {
  requireEngineeringEnabled();
  const tasks = await database`SELECT t.*,
    COALESCE((SELECT json_agg(json_build_object('id',a.id,'attemptNumber',a.attempt_number_display,'planVersion',a.plan_version,'startedAt',a.started_at,'finishedAt',a.finished_at,'disposition',CASE WHEN a.finished_at IS NULL AND a.started_at<=now()-interval '30 minutes' AND COALESCE(a.disposition,'active')='active' THEN 'expired' WHEN a.disposition IS NOT NULL THEN a.disposition WHEN a.finished_at IS NULL THEN 'active' WHEN t.status IN ('blocked','cancelled') THEN t.status ELSE 'closed_legacy' END,'modelCalls',a.model_calls,'tokens',a.tokens,'costUsd',a.cost_usd) ORDER BY a.attempt_number_display DESC)
      FROM (SELECT r.*,COALESCE(r.attempt_number,row_number() OVER (PARTITION BY r.task_id ORDER BY r.started_at,r.id)::integer) AS attempt_number_display FROM engineering_runs r WHERE r.task_id=t.id) a),'[]'::json) AS attempts,
    (SELECT json_build_object('previousAttemptNumber',p.previous_attempt_number,'toVersion',p.to_version) FROM engineering_attempt_preparations p WHERE p.task_id=t.id ORDER BY p.created_at DESC LIMIT 1) AS "latestPreparation"
    FROM engineering_tasks t ORDER BY t.created_at DESC LIMIT 100` as Task[];
  const mergeCandidates = tasks.filter(task => ["awaiting_merge", "merging", "completed"].includes(task.status));
  if (!mergeCandidates.length) return tasks;
  const ids = mergeCandidates.map(task => task.id);
  const reviews = process.env.ENGINEERING_MERGE_ENABLED === "true" ? await database`
    SELECT t.id AS task_id,r.id AS run_id,COALESCE(r.attempt_number,1) AS attempt_number,r.plan_version,l.target_base_sha,
      ev.details#>>'{proposalEvidence,workspaceRevision}' AS resulting_revision,
      ev.details#>'{proposalEvidence,files}' AS files,
      t.plan->'validations' AS validations,
      (SELECT count(DISTINCT v.command)::integer FROM engineering_validations v WHERE v.run_id=r.id AND v.cycle=r.repairs AND v.outcome='passed' AND v.revision=ev.details#>>'{proposalEvidence,workspaceRevision}') AS passed_validation_count,
      (SELECT coalesce(json_agg(g.command ORDER BY g.command),'[]'::json) FROM (SELECT DISTINCT v.command FROM engineering_validations v WHERE v.run_id=r.id AND v.cycle=r.repairs AND v.outcome='passed' AND v.revision=ev.details#>>'{proposalEvidence,workspaceRevision}') g) AS passed_validations,
      EXISTS(SELECT 1 FROM engineering_worker_calls c WHERE c.run_id=r.id AND c.call_key LIKE 'review:%' AND c.processing_state='review_validated') AS self_review_passed,
      true AS merge_configured,
      (SELECT json_build_object('id',ma.id,'status',ma.status,'targetBaseSha',ma.target_base_sha) FROM engineering_merge_approvals ma WHERE ma.task_id=t.id ORDER BY ma.created_at DESC LIMIT 1) AS approval
    FROM engineering_tasks t
    JOIN LATERAL (SELECT * FROM engineering_runs x WHERE x.task_id=t.id AND x.finished_at IS NOT NULL AND x.disposition='succeeded' ORDER BY x.attempt_number DESC NULLS LAST,x.started_at DESC LIMIT 1) r ON true
    LEFT JOIN engineering_run_lineage l ON l.run_id=r.id
    LEFT JOIN LATERAL (SELECT details FROM engineering_events x WHERE x.task_id=t.id AND x.action='proposal_evidence' AND x.details->>'runId'=r.id::text ORDER BY x.created_at DESC LIMIT 1) ev ON true
    WHERE t.id=ANY(${ids}::uuid[])
  ` as Array<Record<string, unknown>> : await database`
    SELECT t.id AS task_id,r.id AS run_id,COALESCE(r.attempt_number,1) AS attempt_number,r.plan_version,l.target_base_sha,
      ev.details#>>'{proposalEvidence,workspaceRevision}' AS resulting_revision,
      ev.details#>'{proposalEvidence,files}' AS files,t.plan->'validations' AS validations,
      (SELECT count(DISTINCT v.command)::integer FROM engineering_validations v WHERE v.run_id=r.id AND v.cycle=r.repairs AND v.outcome='passed' AND v.revision=ev.details#>>'{proposalEvidence,workspaceRevision}') AS passed_validation_count,
      (SELECT coalesce(json_agg(g.command ORDER BY g.command),'[]'::json) FROM (SELECT DISTINCT v.command FROM engineering_validations v WHERE v.run_id=r.id AND v.cycle=r.repairs AND v.outcome='passed' AND v.revision=ev.details#>>'{proposalEvidence,workspaceRevision}') g) AS passed_validations,
      EXISTS(SELECT 1 FROM engineering_worker_calls c WHERE c.run_id=r.id AND c.call_key LIKE 'review:%' AND c.processing_state='review_validated') AS self_review_passed,
      false AS merge_configured,NULL::json AS approval
    FROM engineering_tasks t
    JOIN LATERAL (SELECT * FROM engineering_runs x WHERE x.task_id=t.id AND x.finished_at IS NOT NULL AND x.disposition='succeeded' ORDER BY x.attempt_number DESC NULLS LAST,x.started_at DESC LIMIT 1) r ON true
    LEFT JOIN engineering_run_lineage l ON l.run_id=r.id
    LEFT JOIN LATERAL (SELECT details FROM engineering_events x WHERE x.task_id=t.id AND x.action='proposal_evidence' AND x.details->>'runId'=r.id::text ORDER BY x.created_at DESC LIMIT 1) ev ON true
    WHERE t.id=ANY(${ids}::uuid[])
  ` as Array<Record<string, unknown>>;
  const target = process.env.ENGINEERING_MERGE_ENABLED === "true" ? configuredMergeTarget() : { repository: "omarimckie/MediMori", branch: "main" };
  return tasks.map(task => {
    const row = reviews.find(review => review.task_id === task.id);
    if (!row) return task;
    const approval = row.approval as { id?: string; status?: string; targetBaseSha?: string } | null;
    const files = Array.isArray(row.files) ? row.files.map((item) => {
      const file = item as Record<string, unknown>;
      return { path: String(file.path ?? ""), beforeSha256: String(file.beforeSha256 ?? ""), afterSha256: String(file.afterSha256 ?? "") };
    }) : [];
    return { ...task, mergeReview: {
      runId: String(row.run_id), attemptNumber: Number(row.attempt_number), planVersion: Number(row.plan_version),
      resultingRevision: String(row.resulting_revision ?? ""), files, validations: task.plan?.validations ?? [],
      passedValidations: Array.isArray(row.passed_validations) ? row.passed_validations.map(String) : [],
      passedValidationCount: Number(row.passed_validation_count), selfReviewPassed: row.self_review_passed === true,
      targetRepository: target.repository, targetBranch: target.branch,
      targetBaseSha: approval?.targetBaseSha ?? (typeof row.target_base_sha === "string" ? row.target_base_sha : null), approvalId: approval?.id ?? null,
      approvalStatus: approval?.status ?? (row.merge_configured ? "not_requested" : "disabled"),
    } satisfies MergeReview };
  });
}

/** Records only the explicit authenticated human merge decision; it never runs Git. */
export async function recordMergeDecision(id: string, version: number, decision: "approved" | "rejected", targetBaseSha: string | null, idempotencyKey: string, actor: string, database = getSql(), targetReader = readApprovedTargetBaseSha, preimageReader = readTargetPreimagesAtSha) {
  requireEngineeringEnabled();
  configuredMergeTarget();
  if (!uuidPattern.test(id) || !Number.isSafeInteger(version) || version < 0 || (decision === "approved" && (!targetBaseSha || !/^[a-f0-9]{40}$/.test(targetBaseSha))) || (decision === "rejected" && targetBaseSha !== null) || !taskSubmissionKeyPattern.test(idempotencyKey) || !actor.trim() || actor.length > 120) throw new EngineeringInputError("Merge approval request is invalid.");
  const replay = await findMergeDecisionReplay(id, version, decision, idempotencyKey, actor, database);
  if (replay) return replay;
  const history = await taskHistory(id, database);
  if (!history.task || history.task.version !== version) throw new EngineeringConflict("Task changed; reload before recording a merge decision.");
  if (history.task.status !== "awaiting_merge") throw new EngineeringInputError("Only a successful awaiting-merge task can receive a merge decision.");
  const runs = history.runs as Array<Record<string, unknown>>;
  const run = runs.find(item => item.finished_at && item.disposition === "succeeded");
  if (!run) throw new EngineeringInputError("A successful execution attempt is required.");
  const runId = String(run.id);
  const planVersion = Number(run.plan_version);
  const attemptNumber = Number(run.display_attempt_number ?? run.attempt_number);
  const event = (history.events as Array<Record<string, unknown>>).find(item => item.action === "proposal_evidence" && (item.details as Record<string, unknown>)?.runId === runId);
  const details = event?.details as Record<string, unknown> | undefined;
  const evidence = details?.proposalEvidence as Record<string, unknown> | undefined;
  if (!evidence || evidence.workspaceRevision !== String(run.worker_revision ?? evidence.workspaceRevision) || !Array.isArray(evidence.files)) throw new EngineeringInputError("Bounded reviewed change evidence is unavailable.");
  const files = evidence.files.map(value => {
    const file = value as Record<string, unknown>;
    return { path: file.path, beforeSha256: file.beforeSha256, afterSha256: file.afterSha256 };
  });
  if (decision === "approved") {
    const currentBaseSha = await targetReader();
    if (targetBaseSha !== currentBaseSha) throw new EngineeringInputError("Merge target changed before approval; reload the merge review.");
    const targetHashes = await preimageReader(currentBaseSha, files.map(file => String(file.path)));
    if (files.some(file => typeof file.beforeSha256 !== "string" || targetHashes[String(file.path)] !== file.beforeSha256)) {
      throw new EngineeringInputError("A reviewed target file is missing or changed; no merge approval was recorded.");
    }
  }
  const rows = await database`SELECT engineering_create_merge_decision(
    ${id}::uuid,${version},${runId}::uuid,${attemptNumber},${planVersion},${String(evidence.workspaceRevision)},${JSON.stringify(files)}::jsonb,
    'omarimckie/MediMori','main',${targetBaseSha},${actor},${idempotencyKey}::uuid,${decision}) AS result`;
  const result = rows[0]?.result as Record<string, unknown> | undefined;
  if (!result?.ok || typeof result.approvalId !== "string") throw new EngineeringInputError("Merge decision could not be recorded safely.");
  return { approvalId: result.approvalId, status: String(result.status), replayed: result.replayed === true, runId, planVersion, attemptNumber };
}

export async function findMergeDecisionReplay(id: string, version: number, decision: "approved" | "rejected", idempotencyKey: string, actor: string, database = getSql()) {
  requireEngineeringEnabled();
  if (!uuidPattern.test(id) || !Number.isSafeInteger(version) || !taskSubmissionKeyPattern.test(idempotencyKey)) throw new EngineeringInputError("Merge approval request is invalid.");
  const rows = await database`SELECT id,task_id,task_version,run_id,attempt_number,plan_version,status,actor FROM engineering_merge_approvals WHERE idempotency_key=${idempotencyKey}::uuid`;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const acceptedStatus = decision === "approved" ? ["approved", "consumed", "blocked", "revoked"].includes(String(row.status)) : row.status === "rejected";
  if (row.task_id !== id || Number(row.task_version) !== version || row.actor !== actor || !acceptedStatus) throw new EngineeringConflict("This merge decision key is already bound to a different request.");
  return { approvalId: String(row.id), status: String(row.status), replayed: true, runId: String(row.run_id), planVersion: Number(row.plan_version), attemptNumber: Number(row.attempt_number) };
}
export async function createTask(request: string, actor: string, submissionKey: string, database = getSql()) {
  requireEngineeringEnabled();
  if (!request.trim() || request.length > 8000) throw new EngineeringInputError("Request must contain 1–8000 characters.");
  if (typeof submissionKey !== "string" || submissionKey.length > 36 || !taskSubmissionKeyPattern.test(submissionKey)) throw new EngineeringInputError("A valid task submission key is required.");
  const sql = database;
  const rows = await sql`
    WITH task AS (
      INSERT INTO engineering_tasks(id,request,created_by,creation_key) VALUES (${randomUUID()}::uuid,${request.trim()},${actor},${submissionKey}::uuid)
      ON CONFLICT (creation_key) DO NOTHING RETURNING *
    ), event AS (
      INSERT INTO engineering_events(id,task_id,actor,action,details)
      SELECT ${randomUUID()}::uuid,id,${actor},'intake','{}'::jsonb FROM task
    ) SELECT id,request,status,plan,risk,version,created_by FROM task`;
  if (rows[0]) return rows[0] as Task;
  // A separate statement gets a fresh READ COMMITTED snapshot after a concurrent
  // same-key insert has committed. Replays never emit another intake event.
  const existing = await sql`SELECT id,request,status,plan,risk,version,created_by FROM engineering_tasks WHERE creation_key=${submissionKey}::uuid`;
  const task = existing[0] as Task | undefined;
  if (!task || task.created_by !== actor || task.request !== request.trim()) throw new EngineeringConflict("This submission key is already bound to a different request or actor.");
  return task;
}
export async function taskHistory(id: string, database = getSql()) {
  requireEngineeringEnabled();
  const sql = database;
  const [tasks, runs, approvals, validations, costs, events, preparations] = await Promise.all([
    sql`SELECT * FROM engineering_tasks WHERE id=${id}::uuid`,
    sql`SELECT r.*,COALESCE(r.attempt_number,row_number() OVER (PARTITION BY r.task_id ORDER BY r.started_at,r.id)::integer) AS display_attempt_number,CASE WHEN r.finished_at IS NULL AND r.started_at<=now()-interval '30 minutes' AND COALESCE(r.disposition,'active')='active' THEN 'expired' WHEN r.disposition IS NOT NULL THEN r.disposition WHEN r.finished_at IS NULL THEN 'active' ELSE 'closed_legacy' END AS effective_disposition FROM engineering_runs r WHERE r.task_id=${id}::uuid ORDER BY r.started_at DESC LIMIT 100`,
    sql`SELECT * FROM engineering_approvals WHERE task_id=${id}::uuid ORDER BY created_at DESC LIMIT 100`,
    sql`SELECT v.* FROM engineering_validations v JOIN engineering_runs r ON r.id=v.run_id WHERE r.task_id=${id}::uuid ORDER BY v.created_at DESC LIMIT 100`,
    sql`SELECT c.* FROM engineering_costs c JOIN engineering_runs r ON r.id=c.run_id WHERE r.task_id=${id}::uuid ORDER BY c.created_at DESC LIMIT 100`,
    sql`SELECT * FROM engineering_events WHERE task_id=${id}::uuid ORDER BY created_at DESC LIMIT 100`,
    sql`SELECT * FROM engineering_attempt_preparations WHERE task_id=${id}::uuid ORDER BY created_at DESC LIMIT 100`,
  ]);
  return { task: tasks[0] as Task | undefined, runs, approvals, validations, costs, events, preparations };
}

/** Explicit human action; closes only an already non-executable attempt and returns its request to planning. */
export async function prepareFreshAttempt(id: string, version: number, idempotencyKey: string, actor: string, database = getSql(), targetReader = readWorkerTargetBaseSha) {
  requireEngineeringEnabled();
  if (!uuidPattern.test(id) || !Number.isSafeInteger(version) || version < 0 || !taskSubmissionKeyPattern.test(idempotencyKey)) {
    throw new EngineeringInputError("A valid task version and fresh-attempt key are required.");
  }
  const targetBaseSha = await targetReader();
  const rows = await database`SELECT engineering_prepare_attempt_bound(${id}::uuid,${version},${idempotencyKey}::uuid,${actor},${mergeTargetPolicy.repository},${mergeTargetPolicy.branch},${targetBaseSha}) AS result`;
  const result = rows[0]?.result as Record<string, unknown> | undefined;
  if (!result) throw new EngineeringInputError("Fresh attempt preparation failed safely.");
  if (result.ok !== true) {
    const codes = new Set(["stale_version","attempt_still_executable","attempt_already_prepared","task_not_retryable","attempt_not_closed","task_attempt_state_mismatch","unresolved_provider_activity","prior_approval_missing","execution_attempt_missing","idempotency_conflict"]);
    const code = typeof result.code === "string" && codes.has(result.code) ? result.code : "invalid_prepare_request";
    if (["stale_version","attempt_still_executable","attempt_already_prepared","unresolved_provider_activity","idempotency_conflict"].includes(code)) throw new EngineeringConflict("Fresh attempt could not be prepared because the request or prior attempt changed or is not safely closed.");
    throw new EngineeringInputError("Fresh attempt preparation is not available for this request state.");
  }
  return result;
}

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Optimistic version claim and evidence inserts occur in one SQL statement. */
export async function actOnTask(id: string, version: number, action: string, value: unknown, actor: string, database = getSql(), targetReader = readWorkerTargetBaseSha) {
  requireEngineeringEnabled();
  const sql = database;
  const rows = await sql`SELECT * FROM engineering_tasks WHERE id=${id}::uuid`;
  const task = rows[0] as Task | undefined;
  if (!task || task.version !== version) throw new EngineeringConflict("Task changed; reload before acting.");
  let next = task.status;
  let plan = task.plan;
  let risk = task.risk;
  let decision: string | null = null;
  if (action === "plan") {
    if (task.status !== "analyzing") throw new EngineeringInputError("Analyze the task before submitting a plan.");
    plan = parsePlan(value); risk = classifyRisk(plan); next = "planned";
  } else if (action === "approve" || action === "reject") {
    if (task.status !== "awaiting_approval" || !plan) throw new EngineeringInputError("No plan awaiting approval.");
    if (action === "approve" && process.env.ENGINEERING_WORKER_ENABLED === "true") executablePlan(plan);
    decision = action === "approve" ? "approved" : "rejected";
    next = action === "approve" ? "implementing" : "cancelled";
  } else if (action === "transition") {
    if (typeof value !== "string") throw new EngineeringInputError("Status is required.");
    if (!["analyzing", "awaiting_approval", "validating", "repairing", "reviewing", "awaiting_merge", "blocked", "cancelled", "escalated"].includes(value)) throw new EngineeringInputError("Unsupported transition.");
    next = value as Status;
  } else throw new EngineeringInputError("Unsupported action.");
  assertTransition(task.status, next);
  const starting = decision === "approved";
  let targetBaseSha: string | null = null;
  if (starting) {
    const liveTargetSha = await targetReader();
    const preparations = await sql`SELECT target_repository,target_branch,target_base_sha FROM engineering_attempt_preparations WHERE task_id=${id}::uuid ORDER BY created_at DESC LIMIT 1`;
    const preparation = preparations[0] as { target_repository: string | null; target_branch: string | null; target_base_sha: string | null } | undefined;
    if (preparation) {
      if (preparation.target_repository !== mergeTargetPolicy.repository || preparation.target_branch !== mergeTargetPolicy.branch || !preparation.target_base_sha || preparation.target_base_sha !== liveTargetSha) {
        throw new EngineeringInputError("The prepared attempt target changed or is not lineage-bound; prepare a fresh attempt again.");
      }
      targetBaseSha = preparation.target_base_sha;
    } else targetBaseSha = liveTargetSha;
  }
  const finishing = ["blocked", "cancelled", "escalated", "awaiting_merge"].includes(next);
  // Reviewing/repairing require evidence recorded for the current validation cycle.
  const checking = next === "reviewing" || next === "repairing";
  const result = await sql`
    WITH changed AS (
      UPDATE engineering_tasks t SET status=${next},plan=${JSON.stringify(plan)}::jsonb,risk=${risk},version=version+1,updated_at=now()
      WHERE id=${id}::uuid AND version=${version}
      AND (${(finishing && next !== 'awaiting_merge') || starting || next === 'analyzing' || next === 'planned' || next === 'awaiting_approval'} OR NOT EXISTS (SELECT 1 FROM engineering_runs wr WHERE wr.task_id=t.id AND wr.worker_enabled))
      AND (${!checking} OR EXISTS (
        SELECT 1 FROM engineering_runs r WHERE r.task_id=t.id AND r.finished_at IS NULL
        AND NOT r.worker_enabled AND r.started_at > now() - interval '30 minutes'
        AND (${next !== "repairing"} OR r.repairs < 3)
        AND EXISTS (SELECT 1 FROM engineering_validations v WHERE v.run_id=r.id AND v.cycle=r.repairs)
        AND (${next !== "reviewing"} OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(t.plan->'validations') command
          WHERE NOT EXISTS (SELECT 1 FROM engineering_validations v WHERE v.run_id=r.id AND v.cycle=r.repairs AND v.command=command AND v.outcome='passed')
        ))
        AND (${next !== "repairing"} OR EXISTS (SELECT 1 FROM engineering_validations v WHERE v.run_id=r.id AND v.cycle=r.repairs AND v.outcome='failed'))
      ))
      RETURNING *
    ), approval AS (
      INSERT INTO engineering_approvals(id,task_id,plan_version,gate,decision,actor)
      SELECT ${randomUUID()}::uuid,id,${version},'plan',${decision},${actor} FROM changed WHERE ${decision !== null}
    ), plan_lineage AS (
      INSERT INTO engineering_plan_lineage(task_id,plan_version,target_repository,target_branch,target_base_sha)
      SELECT id,${version},${mergeTargetPolicy.repository},${mergeTargetPolicy.branch},${targetBaseSha} FROM changed WHERE ${starting}
    ), run AS (
      INSERT INTO engineering_runs(id,task_id,plan_version,worker_enabled,attempt_number,plan_snapshot,disposition)
      SELECT ${randomUUID()}::uuid,id,${version},${process.env.ENGINEERING_WORKER_ENABLED === "true"},
        (SELECT count(*)::integer+1 FROM engineering_runs prior WHERE prior.task_id=changed.id),${JSON.stringify(plan)}::jsonb,'active'
      FROM changed WHERE ${starting} RETURNING id,task_id,plan_version,attempt_number
    ), lineage AS (
      INSERT INTO engineering_run_lineage(run_id,task_id,attempt_number,plan_version,target_repository,target_branch,target_base_sha,previous_run_id,preparation_key)
      SELECT run.id,run.task_id,run.attempt_number,run.plan_version,${mergeTargetPolicy.repository},${mergeTargetPolicy.branch},${targetBaseSha},prep.previous_run_id,prep.idempotency_key
      FROM run LEFT JOIN LATERAL (
        SELECT idempotency_key,previous_run_id FROM engineering_attempt_preparations WHERE task_id=run.task_id ORDER BY created_at DESC LIMIT 1
      ) prep ON true
    ), run_update AS (
      UPDATE engineering_runs SET repairs=repairs+${next === "repairing" ? 1 : 0},finished_at=CASE WHEN ${finishing} THEN now() ELSE finished_at END,
        disposition=CASE WHEN NOT ${finishing} THEN disposition WHEN ${next === "awaiting_merge"} THEN 'succeeded' WHEN ${next === "cancelled"} THEN 'cancelled' ELSE 'blocked' END
      WHERE task_id IN (SELECT id FROM changed) AND finished_at IS NULL AND ${!starting}
    ), event AS (
      INSERT INTO engineering_events(id,task_id,actor,action,details)
      SELECT ${randomUUID()}::uuid,id,${actor},${action},${JSON.stringify({ from: task.status, to: next, version })}::jsonb FROM changed
    ) SELECT * FROM changed`;
  if (!result[0]) throw new EngineeringConflict("Task changed, required validation is missing, or execution limits were reached.");
  return result[0] as Task;
}

export async function recordRunEvidence(id: string, version: number, input: Record<string, unknown>, actor: string, database = getSql()) {
  requireEngineeringEnabled();
  const kind = input.kind;
  if (kind !== "validation" && kind !== "cost") throw new EngineeringInputError("Invalid evidence kind.");
  const command = typeof input.command === "string" ? input.command : "";
  const outcome = input.outcome;
  const revision = typeof input.revision === "string" ? input.revision : "";
  const summary = typeof input.summary === "string" ? input.summary : "";
  if (kind === "validation" && (!(validationCommands as readonly string[]).includes(command) || !["passed", "failed"].includes(String(outcome)) || !/^[a-f0-9]{40}$/.test(revision) || !summary || summary.length > 4000)) throw new EngineeringInputError("Invalid validation evidence.");
  const tokens = kind === "cost" ? input.tokens : 0;
  const cost = kind === "cost" ? input.estimatedCostUsd : 0;
  if (typeof tokens !== "number" || !Number.isSafeInteger(tokens) || tokens < 0 || typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) throw new EngineeringInputError("Invalid usage.");
  const provider = typeof input.provider === "string" ? input.provider : "";
  const model = typeof input.model === "string" ? input.model : "";
  const operation = typeof input.operation === "string" ? input.operation : "";
  if (kind === "cost" && [provider, model, operation].some(s => !s || s.length > 120)) throw new EngineeringInputError("Cost metadata is required.");
  // Detailed evidence belongs only in validations/costs. Never serialize caller input
  // (including free text and provider/model metadata) into the audit log.
  const eventSummary = kind === "validation"
    ? { kind, version, command, outcome: String(outcome), revision }
    : { kind, version, tokens, estimatedCostUsd: cost };
  const sql = database;
  const result = await sql`
    WITH claimed AS (
      UPDATE engineering_tasks t SET version=version+1,updated_at=now()
      WHERE id=${id}::uuid AND version=${version} AND status IN ('implementing','validating','repairing')
      AND (${kind !== "validation"} OR status='validating')
      AND EXISTS (SELECT 1 FROM engineering_runs r WHERE r.task_id=t.id AND r.finished_at IS NULL
        AND NOT r.worker_enabled AND r.started_at > now() - interval '30 minutes'
        AND r.model_calls+${kind === "cost" ? 1 : 0} <= ${limits.modelCalls}
        AND r.tokens+${tokens} <= ${limits.tokens} AND r.cost_usd+${cost} <= ${limits.costUsd})
      AND (${kind !== "validation"} OR NOT EXISTS (
        SELECT 1 FROM engineering_validations v JOIN engineering_runs r ON r.id=v.run_id
        WHERE r.task_id=t.id AND r.finished_at IS NULL AND v.cycle=r.repairs AND v.revision<>${revision}
      ))
      RETURNING id
    ), run AS (
      UPDATE engineering_runs SET model_calls=model_calls+${kind === "cost" ? 1 : 0},tokens=tokens+${tokens},cost_usd=cost_usd+${cost}
      WHERE task_id IN (SELECT id FROM claimed) AND finished_at IS NULL RETURNING *
    ), validation AS (
      INSERT INTO engineering_validations(id,run_id,command,outcome,revision,summary,cycle)
      SELECT ${randomUUID()}::uuid,id,${command},${String(outcome)},${revision},${summary},repairs FROM run WHERE ${kind === "validation"}
    ), cost AS (
      INSERT INTO engineering_costs(id,run_id,provider,model,operation,tokens,estimated_cost_usd)
      SELECT ${randomUUID()}::uuid,id,${provider},${model},${operation},${tokens},${cost} FROM run WHERE ${kind === "cost"}
    ), event AS (
      INSERT INTO engineering_events(id,task_id,actor,action,details)
      SELECT ${randomUUID()}::uuid,task_id,${actor},${kind},
        ${JSON.stringify(eventSummary)}::jsonb || jsonb_build_object('runId',id,'cycle',repairs) FROM run
    ) SELECT * FROM claimed`;
  if (!result[0]) throw new EngineeringConflict("Evidence rejected: stale version, inactive run, or execution limit.");
}
