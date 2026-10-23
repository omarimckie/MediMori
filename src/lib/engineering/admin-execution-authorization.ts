import { protectedOperations, validationCommands } from "./policy";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function sourceSelectionPolicyField(value: unknown): { sourceSelectionPolicyVersion: number } | Record<string, never> {
  const sourceSelectionPolicyVersion = safeSourceSelectionPolicyVersion(value);
  return sourceSelectionPolicyVersion === undefined ? {} : { sourceSelectionPolicyVersion };
}

/** Admin task projection. Policy version is included only as a non-negative safe integer. */
export function safeTask(task: Record<string, unknown>) {
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
      && Number.isSafeInteger(preparedAttempt.subjectGeneration) && Number(preparedAttempt.subjectGeneration) > 0
      && Number.isSafeInteger(preparedAttempt.planVersion) && Number(preparedAttempt.planVersion) >= 0
      && preparedAttempt.targetRepository === "omarimckie/MediMori" && preparedAttempt.targetBranch === "main"
      && typeof preparedAttempt.targetBaseSha === "string" && /^[a-f0-9]{40}$/.test(preparedAttempt.targetBaseSha)
      && typeof preparedAttempt.implementationSourceRevision === "string" && /^[a-f0-9]{40}$/.test(preparedAttempt.implementationSourceRevision) ? {
        attemptId: preparedAttempt.attemptId, attemptNumber: preparedAttempt.attemptNumber, subjectGeneration: preparedAttempt.subjectGeneration, planVersion: preparedAttempt.planVersion,
        risk: typeof preparedAttempt.risk === "string" ? preparedAttempt.risk : "unknown",
        targetRepository: preparedAttempt.targetRepository, targetBranch: preparedAttempt.targetBranch,
        targetBaseSha: preparedAttempt.targetBaseSha, implementationSourceRevision: preparedAttempt.implementationSourceRevision,
        ...sourceSelectionPolicyField(preparedAttempt.sourceSelectionPolicyVersion),
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

/** Non-negative safe integers are projectable. Missing and invalid values stay omitted. */
export function safeSourceSelectionPolicyVersion(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

export type ExecutionAuthorizationSubject = {
  targetBaseSha?: string;
  planVersion?: number;
  sourceSelectionPolicyVersion?: number;
} | null | undefined;

/** Mirrors the admin "Authorize execution" control. Only policy version 2 can pass. */
export function executionAuthorizationDisabled(input: {
  busy?: boolean;
  workerEnabled?: boolean;
  taskVersion: number;
  preparedAttempt?: ExecutionAuthorizationSubject;
  planTarget?: { baseSha?: string } | null;
}): boolean {
  const subject = input.preparedAttempt;
  return input.busy === true
    || input.workerEnabled !== true
    || !subject
    || !input.planTarget
    || input.planTarget.baseSha !== subject.targetBaseSha
    || subject.planVersion !== input.taskVersion
    || subject.sourceSelectionPolicyVersion !== 2;
}
