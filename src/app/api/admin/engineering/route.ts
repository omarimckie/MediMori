import { open } from "node:fs/promises";
import { join } from "node:path";
import { getAuthenticatedAdminUsername } from "@/lib/admin-auth";
import { safeTask } from "@/lib/engineering/admin-execution-authorization";
import { projectEngineeringAdminEventDetails } from "@/lib/engineering/admin-engineering-event-details";
import { EngineeringInputError, limits, modelPolicy, protectedOperations } from "@/lib/engineering/policy";
import { workerLimits } from "@/lib/engineering/worker-policy";
import { actOnTask, approvePreparedAttempt, authorizePreparedExecution, createTask, EngineeringConflict, findMergeDecisionReplay, listTasks, prepareFreshAttempt, prepareInitialAttempt, prepareRetryAttemptSubject, supersedeStalePreparedAttempt, recordMergeDecision, recordRunEvidence, taskHistory, taskSubmissionKeyPattern } from "@/lib/engineering/store";
import { getSql } from "@/lib/db";
import { readApprovedTargetBaseSha, readWorkerTargetBaseSha } from "@/lib/engineering/merge-target";

export const runtime = "nodejs";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

async function boundedTaskHistory(id: string) {
  const database = getSql();
  const history = await taskHistory(id, database);
  const runIds = history.runs.map((run) => String(run.id)).filter(value => uuid.test(value));
  const [lineages, workerCalls] = runIds.length ? await Promise.all([database`
    SELECT run_id,target_repository,target_branch,target_base_sha,previous_run_id
    FROM engineering_run_lineage WHERE run_id=ANY(${runIds}::uuid[])
  ` as Promise<Array<Record<string, unknown>>>, database`
    SELECT run_id,call_key,model,reserved_tokens,reserved_micros,state,actual_input,actual_output,actual_micros,processing_state,created_at
    FROM engineering_worker_calls WHERE run_id=ANY(${runIds}::uuid[]) ORDER BY created_at DESC LIMIT 100
  ` as Promise<Array<Record<string, unknown>>>]) : [[], []] as [Array<Record<string, unknown>>, Array<Record<string, unknown>>];
  const lineageByRun = new Map(lineages.map(row => [String(row.run_id), row]));
  const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(key => key in row).map(key => [key, row[key]]));
  return {
    task: history.task ? safeTask(history.task as unknown as Record<string, unknown>) : null,
    runs: history.runs.map((run) => ({
      ...pick(run, ["id", "task_id", "plan_version", "worker_enabled", "repairs", "model_calls", "tokens", "cost_usd", "started_at", "finished_at", "disposition", "attempt_number", "display_attempt_number", "preflight_revision", "worker_revision"]),
      target: pick(lineageByRun.get(String(run.id)) ?? {}, ["target_repository", "target_branch", "target_base_sha", "previous_run_id"]),
    })),
    approvals: history.approvals.map(row => pick(row, ["id", "plan_version", "gate", "decision", "actor", "created_at"])),
    validations: history.validations.map(row => pick(row, ["id", "run_id", "command", "outcome", "revision", "cycle", "created_at"])),
    costs: history.costs.map(row => ({
      ...pick(row, ["id", "run_id", "tokens", "estimated_cost_usd", "created_at"]),
      provider: row.provider === "openai" ? "openai" : "other",
      model: row.model === "gpt-6-luna" || row.model === "gpt-6.1-sol" ? row.model : "other",
      operation: ["implementation", "repair", "self_review"].includes(String(row.operation)) ? row.operation : "other",
    })),
    workerCalls: workerCalls.map(row => ({
      run_id: row.run_id,
      stage: typeof row.call_key === "string" && /^(implementation|review):\d+:[a-f0-9]{40}$/.test(row.call_key) ? row.call_key.split(":")[0] : "other",
      model: row.model === "gpt-6-luna" || row.model === "gpt-6.1-sol" ? row.model : "other",
      reserved_tokens: Number.isSafeInteger(row.reserved_tokens) && Number(row.reserved_tokens) >= 0 ? row.reserved_tokens : 0,
      reserved_micros: Number.isSafeInteger(row.reserved_micros) && Number(row.reserved_micros) >= 0 ? row.reserved_micros : 0,
      state: ["reserved", "sent", "settled", "uncertain"].includes(String(row.state)) ? row.state : "unknown",
      actual_input: Number.isSafeInteger(row.actual_input) && Number(row.actual_input) >= 0 ? row.actual_input : null,
      actual_output: Number.isSafeInteger(row.actual_output) && Number(row.actual_output) >= 0 ? row.actual_output : null,
      actual_micros: Number.isSafeInteger(row.actual_micros) && Number(row.actual_micros) >= 0 ? row.actual_micros : null,
      processing_state: ["reserved", "response_processed", "proposal_validated", "proposal_applied", "review_validated", "failed"].includes(String(row.processing_state)) ? row.processing_state : "unknown",
      created_at: row.created_at,
    })),
    events: history.events.map(row => ({
      ...pick(row, ["id", "actor", "action", "created_at"]),
      details: projectEngineeringAdminEventDetails(row.action, row.details),
    })),
    preparations: history.preparations.map(row => pick(row, ["previous_run_id", "previous_attempt_number", "previous_disposition", "from_version", "to_version", "created_at"])),
  };
}

export async function GET(request: Request) {
  if (!await getAuthenticatedAdminUsername()) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (process.env.ENGINEERING_CONTROL_PLANE_ENABLED !== "true") return Response.json({ error: "Engineering is disabled." }, { status: 503 });
  const id = new URL(request.url).searchParams.get("id");
  const mergeBase = new URL(request.url).searchParams.get("mergeBase");
  const targetBase = new URL(request.url).searchParams.get("targetBase");
  if (targetBase === "1") {
    try {
      return Response.json({ target: { repository: "omarimckie/MediMori", branch: "main", baseSha: await readWorkerTargetBaseSha() } }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error instanceof EngineeringInputError ? error.message : "Engineering target unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
  if (mergeBase === "1") {
    if (process.env.ENGINEERING_MERGE_ENABLED !== "true") return Response.json({ error: "Merge approval is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try { return Response.json({ targetBaseSha: await readApprovedTargetBaseSha() }, { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { return Response.json({ error: error instanceof EngineeringInputError ? error.message : "Merge target unavailable." }, { status: 503 }); }
  }
  if (id && !uuid.test(id)) return Response.json({ error: "Invalid task ID." }, { status: 400 });
  try {
    const database = getSql();
    let result;
    if (id) result = await boundedTaskHistory(id);
    else {
      const tasks = await listTasks(database);
      const runIds = tasks.flatMap(task => (task.attempts ?? []).map(attempt => attempt.id)).filter(value => typeof value === "string" && uuid.test(value));
      const lineages = runIds.length ? await database`SELECT run_id,target_repository,target_branch,target_base_sha,previous_run_id FROM engineering_run_lineage WHERE run_id=ANY(${runIds}::uuid[])` as Array<Record<string, unknown>> : [];
      const lineageByRun = new Map(lineages.map(row => [String(row.run_id), row]));
      result = { tasks: tasks.map(task => safeTask({ ...task, attempts: (task.attempts ?? []).map(attempt => ({ ...attempt, target: lineageByRun.get(attempt.id) ?? null })) }) ), policy: { limits, modelPolicy, workerLimits: { softUsd: workerLimits.softUsd, stopUsd: workerLimits.stopUsd, emergencyUsd: limits.costUsd }, protectedOperations, automaticDispatch: false, workerEnabled: process.env.ENGINEERING_WORKER_ENABLED === "true", mergeApprovalEnabled: process.env.ENGINEERING_MERGE_ENABLED === "true" } };
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Engineering storage unavailable. Check schema and database configuration." }, { status: 503 });
  }
}

function persistApprovalFailureDiagnostic(
  stage:
    | "request_validation"
    | "target_verification"
    | "database_client"
    | "prepared_subject_verification_and_persistence",
): void {
  const filePath = join(
    process.cwd(),
    ".next",
    "dev",
    "logs",
    "engineering-approval-failure.json",
  );

  const line = `${JSON.stringify({
    event: "engineering.approval.failure",
    stage,
    category: "unexpected_error",
  })}\n`;

  if (Buffer.byteLength(line, "utf8") > 256) return;

  void (async () => {
    const file = await open(filePath, "wx");
    try {
      await file.writeFile(line, "utf8");
    } finally {
      await file.close();
    }
  })().catch(() => {
    // Diagnostic failure must not alter the HTTP response.
  });
}
export async function POST(request: Request) {
  const actor = await getAuthenticatedAdminUsername();
  if (!actor) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (process.env.ENGINEERING_CONTROL_PLANE_ENABLED !== "true") return Response.json({ error: "Engineering is disabled." }, { status: 503 });
  // Next's internal URL can use localhost even when the browser uses 127.0.0.1.
  // The browser-controlled Origin must match the request Host and scheme.
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    sameOrigin = origin.host === request.headers.get("host") && origin.protocol === new URL(request.url).protocol;
  } catch {}
  if (!sameOrigin) return Response.json({ error: "Same-origin request required." }, { status: 403 });
  const text = await request.text();
  if (text.length > 16000) return Response.json({ error: "Request too large." }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  let approvalFailureStage: "request_validation" | "target_verification" | "database_client" | "prepared_subject_verification_and_persistence" | undefined;
  try {
    if (body.action === "create") {
      if (typeof body.request !== "string") throw new EngineeringInputError("Request is required.");
      if (typeof body.submissionKey !== "string" || body.submissionKey.length > 36 || !taskSubmissionKeyPattern.test(body.submissionKey)) throw new EngineeringInputError("A valid task submission key is required.");
      const task = await createTask(body.request, actor, body.submissionKey);
      return Response.json({ task }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "supersede_prepared_subject") {
      if (typeof body.id !== "string" || !uuid.test(body.id) || !Number.isSafeInteger(body.version) || Number(body.version) < 0 ||
          typeof body.stalePreparedSubjectId !== "string" || !uuid.test(body.stalePreparedSubjectId) ||
          typeof body.idempotencyKey !== "string" || body.idempotencyKey.length > 36 || !taskSubmissionKeyPattern.test(body.idempotencyKey)) {
        throw new EngineeringInputError("Task version, stale prepared-subject ID, and valid idempotency key are required.");
      }
      return Response.json({ supersession: await supersedeStalePreparedAttempt(body.id, Number(body.version), body.stalePreparedSubjectId, body.idempotencyKey, actor) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "prepare_attempt") {
      if (typeof body.id !== "string" || !uuid.test(body.id) || !Number.isSafeInteger(body.version) || Number(body.version) < 0 || typeof body.attemptKey !== "string" || !taskSubmissionKeyPattern.test(body.attemptKey)) {
        throw new EngineeringInputError("Task ID, current version and a valid fresh-attempt key are required.");
      }
      return Response.json(await prepareFreshAttempt(body.id, Number(body.version), body.attemptKey, actor), { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "prepare_initial_attempt") {
      if (typeof body.id !== "string" || !uuid.test(body.id) || !Number.isSafeInteger(body.version) || Number(body.version) < 0 || typeof body.attemptKey !== "string" || body.attemptKey.length > 36 || !taskSubmissionKeyPattern.test(body.attemptKey)) {
        throw new EngineeringInputError("Task ID, current version and a valid initial-attempt key are required.");
      }
      return Response.json(await prepareInitialAttempt(body.id, Number(body.version), body.attemptKey, actor), { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "prepare_retry_subject") {
      if (typeof body.id !== "string" || !uuid.test(body.id) || !Number.isSafeInteger(body.version) || Number(body.version) < 0 || typeof body.attemptKey !== "string" || body.attemptKey.length > 36 || !taskSubmissionKeyPattern.test(body.attemptKey)) {
        throw new EngineeringInputError("Task ID, current version and a valid retry-subject key are required.");
      }
      return Response.json(await prepareRetryAttemptSubject(body.id, Number(body.version), body.attemptKey, actor), { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "merge_decision") {
      if (process.env.ENGINEERING_MERGE_ENABLED !== "true") return Response.json({ error: "Merge approval is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
      if (typeof body.id !== "string" || !uuid.test(body.id) || !Number.isSafeInteger(body.version) || Number(body.version) < 0 ||
        (body.decision !== "approved" && body.decision !== "rejected") ||
        typeof body.idempotencyKey !== "string" || body.idempotencyKey.length > 36 || !taskSubmissionKeyPattern.test(body.idempotencyKey)) {
        throw new EngineeringInputError("Task version, merge decision and valid idempotency key are required.");
      }
      const replay = await findMergeDecisionReplay(body.id, Number(body.version), body.decision, body.idempotencyKey, actor);
      if (replay) return Response.json({ mergeDecision: replay }, { headers: { "Cache-Control": "no-store" } });
      const targetBaseSha = body.decision === "approved" ? await readApprovedTargetBaseSha() : null;
      if (body.decision === "approved" && body.targetBaseSha !== targetBaseSha) throw new EngineeringConflict("The target branch changed. Refresh the review before approving.");
      const result = await recordMergeDecision(body.id, Number(body.version), body.decision, targetBaseSha, body.idempotencyKey, actor);
      return Response.json({ mergeDecision: result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (typeof body.id !== "string" || !uuid.test(body.id) || !Number.isSafeInteger(body.version) || Number(body.version) < 0 || typeof body.action !== "string") throw new EngineeringInputError("Task ID, version and action are required.");
    if (body.action === "approve") {
      approvalFailureStage = "request_validation";
      if (typeof body.preparedAttemptId !== "string" || !uuid.test(body.preparedAttemptId) || typeof body.targetBaseSha !== "string" || !/^[a-f0-9]{40}$/.test(body.targetBaseSha)) throw new EngineeringInputError("The exact prepared subject and reviewed target base SHA are required for plan approval.");
      approvalFailureStage = "target_verification";
      const currentTargetSha = await readWorkerTargetBaseSha();
      if (body.targetBaseSha !== currentTargetSha) throw new EngineeringConflict("The target branch changed. Refresh the plan review before approving.");
      approvalFailureStage = "database_client";
      const database = getSql();
      approvalFailureStage = "prepared_subject_verification_and_persistence";
      const task = await approvePreparedAttempt(body.id, Number(body.version), body.preparedAttemptId, actor, database, async () => currentTargetSha);
      return Response.json({ task }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "authorize_execution") {
      if (typeof body.preparedAttemptId !== "string" || !uuid.test(body.preparedAttemptId) || typeof body.targetBaseSha !== "string" || !/^[a-f0-9]{40}$/.test(body.targetBaseSha)) throw new EngineeringInputError("The exact approved subject and current target base SHA are required to authorize execution.");
      const currentTargetSha = await readWorkerTargetBaseSha();
      if (body.targetBaseSha !== currentTargetSha) throw new EngineeringConflict("The target branch changed. Refresh the approved subject before authorizing execution.");
      const task = await authorizePreparedExecution(body.id, Number(body.version), body.preparedAttemptId, actor, getSql(), async () => currentTargetSha);
      return Response.json({ task }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "evidence") {
      if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) throw new EngineeringInputError("Evidence is required.");
      await recordRunEvidence(body.id, Number(body.version), body.value as Record<string, unknown>, actor);
      return Response.json({ ok: true });
    }
    return Response.json({ task: await actOnTask(body.id, Number(body.version), body.action, body.value, actor) });
  } catch (error) {
    if (error instanceof EngineeringConflict) return Response.json({ error: error.message }, { status: 409 });
    // Database errors must not expose connection details, SQL or credentials.
    if (error instanceof EngineeringInputError) return Response.json({ error: error.message }, { status: 400 });
    if (approvalFailureStage) {
      try {
        console.error("engineering.approval.failure", { stage: approvalFailureStage, category: "unexpected_error" });
        persistApprovalFailureDiagnostic(approvalFailureStage);
      } catch { /* Diagnostics must not alter the existing response. */ }
    }
    return Response.json({ error: "Engineering storage unavailable." }, { status: 503 });
  }
}
