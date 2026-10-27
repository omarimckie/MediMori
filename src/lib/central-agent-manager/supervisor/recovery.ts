import { assessApproval } from "./approval";
import { budgetBlockReason } from "./budget";
import { evaluateExecution } from "./evaluate";
import { requiresOwnerApproval } from "./protected-operations";
import { getSpecialistProfile } from "./registry";
import {
  SupervisorContractError,
  type ApprovalEvidence,
  type BudgetAllocation,
  type BudgetUsage,
  type SessionRecord,
  type SpecialistProfile,
  type SupervisorTask,
} from "./types";

export type RecoveryDecision =
  | {
      eligible: true;
      taskId: string;
      idempotencyKey: string;
      budget: BudgetAllocation;
      usage: BudgetUsage;
    }
  | { eligible: false; reason: string };

export type RecoveryInput = {
  task: SupervisorTask;
  session: SessionRecord;
  operation: string;
  approval: ApprovalEvidence | null;
  now: string;
  isolationSatisfied: boolean;
};

export function recoveryIdentityBlock(input: RecoveryInput): string | null {
  let profile: SpecialistProfile;
  try {
    profile = getSpecialistProfile(input.task.specialistId);
  } catch (error) {
    if (error instanceof SupervisorContractError) return "Unknown specialist.";
    throw error;
  }
  if (input.session.taskId !== input.task.id || input.session.specialistId !== input.task.specialistId) {
    return "Session does not belong to this task.";
  }
  if (input.session.adapterId !== profile.adapterId) {
    return "Session adapter does not match the specialist profile.";
  }
  if (input.task.state === "cancelled" || input.session.state === "cancelled" || input.session.cancellation === "cancelled") {
    return "Cancelled work cannot resume.";
  }
  if (input.session.state === "completed" || input.session.state === "terminated" || input.session.state === "failed") {
    return "Finished session cannot resume.";
  }
  if (input.session.state !== "running" && input.session.state !== "starting") {
    return "Session is not in a recoverable state.";
  }
  if (input.task.state !== "running") return "Task is not in a recoverable state.";
  if (!input.session.externalSessionRef || !/^[\w.-]{1,80}$/.test(input.session.externalSessionRef)) {
    return "External session identity is missing.";
  }
  if (!/^[\w.-]{1,80}$/.test(input.task.idempotencyKey)) return "Idempotency key is missing.";
  if (!input.task.lease || input.task.lease.holderSessionId !== input.session.id) {
    return "Recovery requires a current lease held by this session.";
  }
  const expires = Date.parse(input.task.lease.expiresAt);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(expires) || !Number.isFinite(nowMs) || expires <= nowMs) {
    return "Session lease is missing or expired.";
  }
  return null;
}

export function evaluateRecovery(input: RecoveryInput): RecoveryDecision {
  const identity = recoveryIdentityBlock(input);
  if (identity) return { eligible: false, reason: identity };
  const profile = getSpecialistProfile(input.task.specialistId);
  if (requiresOwnerApproval(input.operation)) {
    const approval = assessApproval(input.task, input.operation, input.approval, input.now);
    if (!approval.ok) return { eligible: false, reason: `Approval evidence was rejected (${approval.reason}).` };
  }
  const budget = budgetBlockReason(input.task.budget, input.task.usage, profile.defaultBudget);
  if (budget) return { eligible: false, reason: budget };
  const execution = evaluateExecution({
    task: { ...input.task, state: "approved" },
    operation: input.operation,
    approval: input.approval,
    isolationSatisfied: input.isolationSatisfied,
    now: input.now,
  });
  if (execution.outcome !== "allowed") {
    return { eligible: false, reason: execution.reason };
  }
  return {
    eligible: true,
    taskId: input.task.id,
    idempotencyKey: input.task.idempotencyKey,
    budget: { ...input.task.budget },
    usage: { ...input.task.usage },
  };
}
