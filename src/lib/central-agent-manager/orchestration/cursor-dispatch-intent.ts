import { SupervisorContractError } from "../supervisor/types";
import type { ManagerAssignmentRecord, ManagerJobRecord } from "./contracts-v1";
import { markAssignmentAmbiguous } from "./assignment-lifecycle";
import type { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import { hasConfirmedCursorExternalIds } from "./external-execution-refs";

export const CURSOR_DISPATCH_INTENT_CONTRACT_V1 = "central-agent-manager-cursor-dispatch-intent/v1" as const;

export const cursorDispatchIntentStates = [
  "not_dispatched",
  "dispatch_in_progress",
  "outcome_unknown",
  "external_confirmed",
  "dispatch_failed",
  "recovery_required",
] as const;

export type CursorDispatchIntentState = (typeof cursorDispatchIntentStates)[number];

export type CursorDispatchIntent = {
  contractVersion: typeof CURSOR_DISPATCH_INTENT_CONTRACT_V1;
  state: CursorDispatchIntentState;
  updatedAt: string;
  startedAt?: string;
  dispatchOwnerId?: string;
  leaseFenceToken?: number;
  failureReason?: string;
  recoveryReason?: string;
};

const DISPATCH_OWNER_ID = /^[\w-]{8,80}$/;

export function effectiveCursorDispatchState(
  intent: CursorDispatchIntent | undefined,
): CursorDispatchIntentState {
  return intent?.state ?? "not_dispatched";
}

export function validateCursorDispatchIntent(value: unknown): CursorDispatchIntent | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid cursor dispatch intent.");
  }
  const row = value as CursorDispatchIntent;
  if (row.contractVersion !== CURSOR_DISPATCH_INTENT_CONTRACT_V1) {
    throw new Error("Invalid cursor dispatch intent contract version.");
  }
  if (!cursorDispatchIntentStates.includes(row.state)) {
    throw new Error("Invalid cursor dispatch intent state.");
  }
  if (typeof row.updatedAt !== "string" || !row.updatedAt.trim()) {
    throw new Error("Invalid cursor dispatch intent timestamp.");
  }
  if (row.dispatchOwnerId !== undefined) {
    if (typeof row.dispatchOwnerId !== "string" || !DISPATCH_OWNER_ID.test(row.dispatchOwnerId)) {
      throw new Error("Invalid cursor dispatch owner id.");
    }
  }
  if (row.leaseFenceToken !== undefined) {
    if (typeof row.leaseFenceToken !== "number" || !Number.isInteger(row.leaseFenceToken) || row.leaseFenceToken < 1) {
      throw new Error("Invalid cursor dispatch lease fence token.");
    }
  }
  if (row.failureReason !== undefined) {
    if (typeof row.failureReason !== "string" || row.failureReason.length > 240) {
      throw new Error("Invalid cursor dispatch failure reason.");
    }
  }
  if (row.recoveryReason !== undefined) {
    if (typeof row.recoveryReason !== "string" || row.recoveryReason.length > 240) {
      throw new Error("Invalid cursor dispatch recovery reason.");
    }
  }
  return row;
}

export function persistAssignmentAndJobCursorIntent(
  store: MemoryOrchestrationQueueStore,
  assignment: ManagerAssignmentRecord,
  job: ManagerJobRecord,
  intent: CursorDispatchIntent | undefined,
  now: string,
): { assignment: ManagerAssignmentRecord; job: ManagerJobRecord } {
  const validated = intent === undefined ? undefined : validateCursorDispatchIntent(intent);
  const nextAssignment: ManagerAssignmentRecord = {
    ...assignment,
    ...(validated ? { cursorDispatchIntent: validated } : {}),
    updatedAt: now,
  };
  if (!validated) {
    delete (nextAssignment as { cursorDispatchIntent?: CursorDispatchIntent }).cursorDispatchIntent;
  }
  const nextJob: ManagerJobRecord = {
    ...job,
    ...(validated ? { cursorDispatchIntent: validated } : {}),
    updatedAt: now,
  };
  if (!validated) {
    delete (nextJob as { cursorDispatchIntent?: CursorDispatchIntent }).cursorDispatchIntent;
  }
  store.restoreJob(nextJob);
  store.restoreAssignment(nextAssignment);
  return { assignment: nextAssignment, job: nextJob };
}

export function assertMayBeginExternalDispatch(
  assignment: ManagerAssignmentRecord,
  fenceToken: number,
  dispatchOwnerId: string,
): void {
  const state = effectiveCursorDispatchState(assignment.cursorDispatchIntent);
  if (state === "recovery_required" || state === "dispatch_failed") {
    throw new SupervisorContractError("External dispatch is blocked for this assignment.");
  }
  if (state === "external_confirmed") {
    throw new SupervisorContractError("External dispatch is already confirmed; resume polling instead.");
  }
  if (state === "outcome_unknown") {
    throw new SupervisorContractError("External dispatch outcome is unknown; operator recovery is required.");
  }
  if (state === "dispatch_in_progress") {
    const intent = assignment.cursorDispatchIntent!;
    if (intent.dispatchOwnerId !== dispatchOwnerId || intent.leaseFenceToken !== fenceToken) {
      throw new SupervisorContractError("Another bridge instance owns the in-progress external dispatch.");
    }
  }
}

export function assertMayCorrelateExternalDispatch(assignment: ManagerAssignmentRecord, fenceToken: number): void {
  const state = effectiveCursorDispatchState(assignment.cursorDispatchIntent);
  if (state === "recovery_required" || state === "dispatch_failed") {
    throw new SupervisorContractError("External correlation is blocked for this assignment.");
  }
  if (state === "external_confirmed") {
    const intent = assignment.cursorDispatchIntent;
    if (intent?.leaseFenceToken !== fenceToken) {
      throw new SupervisorContractError("External correlation fence token does not match.");
    }
    return;
  }
  if (state !== "dispatch_in_progress" && state !== "outcome_unknown") {
    throw new SupervisorContractError("External correlation requires a recorded dispatch intent.");
  }
  const intent = assignment.cursorDispatchIntent;
  if (!intent || intent.leaseFenceToken !== fenceToken) {
    throw new SupervisorContractError("External correlation fence token does not match.");
  }
}

export function reconcileUnresolvedDispatchIntentOnResume(
  store: MemoryOrchestrationQueueStore,
  assignmentId: string,
  now: string,
): ManagerAssignmentRecord {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment || assignment.state !== "active") return assignment!;
  const job = store.getJobSync(assignment.jobId);
  if (!job) return assignment;
  const state = effectiveCursorDispatchState(assignment.cursorDispatchIntent);
  if (state === "external_confirmed" || state === "dispatch_failed" || state === "recovery_required") {
    return assignment;
  }
  if (hasConfirmedCursorExternalIds(assignment.externalRefs)) {
    return assignment;
  }
  if (state === "dispatch_in_progress" || state === "outcome_unknown") {
    return requireDispatchRecoverySync(
      store,
      assignment.agentId,
      assignmentId,
      assignment.lease.fenceToken,
      now,
      "Restart detected unresolved external dispatch without confirmed Cursor ids.",
    );
  }
  return assignment;
}

export function requireDispatchRecoverySync(
  store: MemoryOrchestrationQueueStore,
  agentId: string,
  assignmentId: string,
  fenceToken: number,
  now: string,
  reason: string,
): ManagerAssignmentRecord {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) throw new SupervisorContractError("Unknown assignment.");
  const job = store.getJobSync(assignment.jobId);
  if (!job) throw new SupervisorContractError("Unknown job.");
  if (assignment.agentId !== agentId) {
    throw new SupervisorContractError("Assignment is not owned by this agent.");
  }
  if (assignment.lease.fenceToken !== fenceToken) {
    throw new SupervisorContractError("Assignment lease fence token is stale.");
  }
  if (assignment.state === "ambiguous") {
    return assignment;
  }
  const intent: CursorDispatchIntent = {
    contractVersion: CURSOR_DISPATCH_INTENT_CONTRACT_V1,
    state: "recovery_required",
    updatedAt: now,
    recoveryReason: reason.slice(0, 240),
    leaseFenceToken: fenceToken,
    dispatchOwnerId: assignment.cursorDispatchIntent?.dispatchOwnerId,
    startedAt: assignment.cursorDispatchIntent?.startedAt,
  };
  const withIntent = {
    ...assignment,
    cursorDispatchIntent: intent,
    updatedAt: now,
  };
  const ambiguous = markAssignmentAmbiguous(withIntent, job, now, reason);
  const jobWithIntent: ManagerJobRecord = {
    ...ambiguous.job,
    cursorDispatchIntent: intent,
    updatedAt: now,
  };
  store.restoreJob(jobWithIntent);
  store.restoreAssignment({ ...ambiguous.assignment, cursorDispatchIntent: intent });
  return { ...ambiguous.assignment, cursorDispatchIntent: intent };
}
