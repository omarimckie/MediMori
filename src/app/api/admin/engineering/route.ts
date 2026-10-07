import { getAuthenticatedAdminUsername } from "@/lib/admin-auth";
import { EngineeringInputError, limits, modelPolicy, protectedOperations, validationCommands } from "@/lib/engineering/policy";
import { workerLimits } from "@/lib/engineering/worker-policy";
import { actOnTask, createTask, EngineeringConflict, findMergeDecisionReplay, listTasks, prepareFreshAttempt, prepareInitialAttempt, prepareRetryAttemptSubject, recordMergeDecision, recordRunEvidence, taskHistory, taskSubmissionKeyPattern } from "@/lib/engineering/store";
import { getSql } from "@/lib/db";
import { readApprovedTargetBaseSha, readWorkerTargetBaseSha } from "@/lib/engineering/merge-target";

export const runtime = "nodejs";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function safeEventDetails(action: unknown, details: unknown) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const value = details as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  const stringFields = ["kind", "from", "to", "runId", "attemptId", "command", "outcome", "revision", "implementationSourceRevision", "expectedSourceRevision", "actualSourceRevision", "phase", "failureCode", "code", "previousRunId", "previousDisposition", "approvalId", "executionId", "baseSha", "commitSha", "targetBranch", "targetRepository", "targetBaseSha"];
  for (const key of stringFields) {
    const item = value[key];
    if (typeof item === "string" && item.length <= 240 && /^[\w./:-]*$/.test(item)) safe[key] = item;
  }
  for (const key of ["version", "planVersion", "cycle", "tokens", "previousAttemptNumber", "preimageCount"]) {
    const item = value[key];
    if (typeof item === "number" && Number.isSafeInteger(item) && item >= 0) safe[key] = item;
  }
  if (typeof value.beforeClaim === "boolean") safe.beforeClaim = value.beforeClaim;
  if (typeof value.estimatedCostUsd === "number" && Number.isFinite(value.estimatedCostUsd) && value.estimatedCostUsd >= 0) safe.estimatedCostUsd = value.estimatedCostUsd;
  if (typeof value.previousDisposition === "string" && value.previousDisposition.length <= 32) safe.previousDisposition = value.previousDisposition;
  const evidence = value.proposalEvidence;
  if (action === "proposal_evidence" && evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
    const proposal = evidence as Record<string, unknown>;
    const boundedFiles = Array.isArray(proposal.files) ? proposal.files.slice(0, 20).map((item) => {
      const file = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return {
        path: typeof file.path === "string" && file.path.length <= 240 && /^[\w./-]+$/.test(file.path) && !file.path.split("/").includes("..") ? file.path : "[invalid path]",
        beforeSha256: typeof file.beforeSha256 === "string" && /^[a-f0-9]{64}$/.test(file.beforeSha256) ? file.beforeSha256 : "",
        afterSha256: typeof file.afterSha256 === "string" && /^[a-f0-9]{64}$/.test(file.afterSha256) ? file.afterSha256 : "",
        beforeBytes: typeof file.beforeBytes === "number" && Number.isSafeInteger(file.beforeBytes) && file.beforeBytes >= 0 ? file.beforeBytes : 0,
        afterBytes: typeof file.afterBytes === "number" && Number.isSafeInteger(file.afterBytes) && file.afterBytes >= 0 ? file.afterBytes : 0,
        removedLines: typeof file.removedLines === "number" && Number.isSafeInteger(file.removedLines) && file.removedLines >= 0 ? file.removedLines : 0,
        addedLines: typeof file.addedLines === "number" && Number.isSafeInteger(file.addedLines) && file.addedLines >= 0 ? file.addedLines : 0,
      };
    }) : [];
    safe.proposalEvidence = {
      approvedPaths: Array.isArray(proposal.approvedPaths) ? proposal.approvedPaths.slice(0, 20).filter((path): path is string => typeof path === "string" && path.length <= 240 && /^[\w./-]+$/.test(path) && !path.split("/").includes("..")) : [],
      replacementCount: typeof proposal.replacementCount === "number" && Number.isSafeInteger(proposal.replacementCount) && proposal.replacementCount >= 0 && proposal.replacementCount <= 100 ? proposal.replacementCount : 0,
      files: boundedFiles,
      workspaceRevision: typeof proposal.workspaceRevision === "string" && /^[a-f0-9]{40}$/.test(proposal.workspaceRevision) ? proposal.workspaceRevision : "",
    };
  }
  return safe;
}

function safeTask(task: Record<string, unknown>) {
  const rawPlan = task.plan && typeof task.plan === "object" && !Array.isArray(task.plan) ? task.plan as Record<string, unknown> : null;
  const plan = rawPlan ? {
    summary: typeof rawPlan.summary === "string" ? rawPlan.summary.slice(0, 4000) : "",
    files: Array.isArray(rawPlan.files) ? rawPlan.files.slice(0, 20).filter((item): item is string => typeof item === "string" && item.length <= 240 && /^[\w./-]+$/.test(item) && !item.split("/").includes("..")) : [],
    validations: Array.isArray(rawPlan.validations) ? rawPlan.validations.slice(0, 6).filter((item): item is string => typeof item === "string" && (validationCommands as readonly string[]).includes(item)) : [],
    operations: Array.isArray(rawPlan.operations) ? rawPlan.operations.slice(0, 10).filter((item): item is string => typeof item === "string" && (protectedOperations as readonly string[]).includes(item)) : [],
  } : null;
  const attempts = Array.isArray(task.attempts) ? task.attempts.slice(0, 100).map((raw) => {
    const attempt = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const target = attempt.target && typeof attempt.target === "object" && !Array.isArray(attempt.target) ? attempt.target as Record<string, unknown> : {};
    return {
      id: attempt.id, attemptNumber: attempt.attemptNumber, planVersion: attempt.planVersion, startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt, disposition: attempt.disposition, modelCalls: attempt.modelCalls, tokens: attempt.tokens, costUsd: attempt.costUsd,
      target: {
        repository: target.target_repository === "omarimckie/MediMori" ? target.target_repository : "",
        branch: target.target_branch === "main" ? target.target_branch : "",
        baseSha: typeof target.target_base_sha === "string" && /^[a-f0-9]{40}$/.test(target.target_base_sha) ? target.target_base_sha : "",
        previousRunId: typeof target.previous_run_id === "string" && uuid.test(target.previous_run_id) ? target.previous_run_id : null,
      },
    };
  }) : [];
  const latestPreparation = task.latestPreparation && typeof task.latestPreparation === "object" ? task.latestPreparation as Record<string, unknown> : null;
  const preparedAttempt = task.preparedAttempt && typeof task.preparedAttempt === "object" ? task.preparedAttempt as Record<string, unknown> : null;
  const review = task.mergeReview && typeof task.mergeReview === "object" ? task.mergeReview as Record<string, unknown> : null;
  return {
    id: task.id, request: task.request, status: task.status, plan, risk: task.risk, version: task.version, created_by: task.created_by,
    created_at: task.created_at, updated_at: task.updated_at, attempts,
    latestPreparation: latestPreparation ? { previousAttemptNumber: latestPreparation.previousAttemptNumber, toVersion: latestPreparation.toVersion } : null,
    preparedAttempt: preparedAttempt
      && typeof preparedAttempt.attemptId === "string" && uuid.test(preparedAttempt.attemptId)
      && Number.isSafeInteger(preparedAttempt.attemptNumber) && Number(preparedAttempt.attemptNumber) > 0
      && Number.isSafeInteger(preparedAttempt.planVersion) && Number(preparedAttempt.planVersion) >= 0
      && preparedAttempt.targetRepository === "omarimckie/MediMori" && preparedAttempt.targetBranch === "main"
      && typeof preparedAttempt.targetBaseSha === "string" && /^[a-f0-9]{40}$/.test(preparedAttempt.targetBaseSha)
      && typeof preparedAttempt.implementationSourceRevision === "string" && /^[a-f0-9]{40}$/.test(preparedAttempt.implementationSourceRevision) ? {
        attemptId: preparedAttempt.attemptId, attemptNumber: preparedAttempt.attemptNumber, planVersion: preparedAttempt.planVersion,
        risk: typeof preparedAttempt.risk === "string" ? preparedAttempt.risk : "unknown",
        targetRepository: preparedAttempt.targetRepository, targetBranch: preparedAttempt.targetBranch,
        targetBaseSha: preparedAttempt.targetBaseSha, implementationSourceRevision: preparedAttempt.implementationSourceRevision,
        createdAt: typeof preparedAttempt.createdAt === "string" ? preparedAttempt.createdAt.slice(0, 40) : undefined,
      } : null,
    mergeReview: review ? {
      runId: review.runId, attemptNumber: review.attemptNumber, planVersion: review.planVersion, resultingRevision: review.resultingRevision,
      files: Array.isArray(review.files) ? review.files.slice(0, 20).map(raw => {
        const file = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        return { path: typeof file.path === "string" && file.path.length <= 240 ? file.path : "[invalid path]", beforeSha256: typeof file.beforeSha256 === "string" && /^[a-f0-9]{64}$/.test(file.beforeSha256) ? file.beforeSha256 : "", afterSha256: typeof file.afterSha256 === "string" && /^[a-f0-9]{64}$/.test(file.afterSha256) ? file.afterSha256 : "" };
      }) : [], validations: Array.isArray(review.validations) ? review.validations.slice(0, 6).filter((item): item is string => typeof item === "string" && (validationCommands as readonly string[]).includes(item)) : [],
      passedValidations: Array.isArray(review.passedValidations) ? review.passedValidations.slice(0, 6) : [], passedValidationCount: review.passedValidationCount,
      selfReviewPassed: review.selfReviewPassed, targetRepository: review.targetRepository, targetBranch: review.targetBranch,
      targetBaseSha: review.targetBaseSha, approvalId: review.approvalId, approvalStatus: review.approvalStatus,
    } : null,
  };
}

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
      details: safeEventDetails(row.action, row.details),
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
  try {
    if (body.action === "create") {
      if (typeof body.request !== "string") throw new EngineeringInputError("Request is required.");
      if (typeof body.submissionKey !== "string" || body.submissionKey.length > 36 || !taskSubmissionKeyPattern.test(body.submissionKey)) throw new EngineeringInputError("A valid task submission key is required.");
      const task = await createTask(body.request, actor, body.submissionKey);
      return Response.json({ task }, { status: 200, headers: { "Cache-Control": "no-store" } });
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
      if (typeof body.targetBaseSha !== "string" || !/^[a-f0-9]{40}$/.test(body.targetBaseSha)) throw new EngineeringInputError("The reviewed target base SHA is required for plan approval.");
      const currentTargetSha = await readWorkerTargetBaseSha();
      if (body.targetBaseSha !== currentTargetSha) throw new EngineeringConflict("The target branch changed. Refresh the plan review before approving.");
      const task = await actOnTask(body.id, Number(body.version), body.action, body.value, actor, undefined, async () => currentTargetSha);
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
    return Response.json({ error: "Engineering storage unavailable." }, { status: 503 });
  }
}
