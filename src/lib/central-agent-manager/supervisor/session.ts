import { evaluateExecution, type EvaluationInput } from "./evaluate";
import { getSpecialistProfile } from "./registry";
import {
  assertIdentifier,
  assertTimestamp,
  SupervisorContractError,
  type SessionRecord,
  type SessionState,
} from "./types";

const transitions: Record<SessionState, readonly SessionState[]> = {
  not_started: ["starting", "cancelled"],
  starting: ["waiting_for_approval", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled", "terminated", "waiting_for_approval"],
  waiting_for_approval: ["cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
  terminated: [],
};

export function transitionSession(
  session: SessionRecord,
  to: SessionState,
  now: string,
): SessionRecord {
  assertTimestamp(now, "Session update time");
  if (to === "running") {
    throw new SupervisorContractError("Running requires confirmSessionRunning after a fresh eligibility decision.");
  }
  if (!transitions[session.state]?.includes(to)) {
    throw new SupervisorContractError(`Cannot transition a session from ${session.state} to ${to}.`);
  }
  const finished = to === "completed" || to === "failed" || to === "cancelled" || to === "terminated";
  return {
    ...session,
    state: to,
    cancellation: to === "cancelled" ? "cancelled" : session.cancellation,
    endedAt: finished ? now : session.endedAt,
  };
}

export function openSession(input: EvaluationInput & { sessionId: string }): SessionRecord {
  return openCheckedSession(input, evaluateExecution(input));
}

function openCheckedSession(
  input: EvaluationInput & { sessionId: string },
  decision: ReturnType<typeof evaluateExecution>,
): SessionRecord {
  assertIdentifier(input.sessionId, "Session id");
  if (input.task.state !== "approved" || decision.outcome !== "allowed") {
    throw new SupervisorContractError("Session cannot start without task eligibility.");
  }
  const profile = getSpecialistProfile(input.task.specialistId);
  return {
    id: input.sessionId,
    taskId: input.task.id,
    specialistId: input.task.specialistId,
    adapterId: profile.adapterId,
    externalSessionRef: null,
    state: "starting",
    startedAt: input.now,
    endedAt: null,
    cancellation: "none",
    failure: "none",
    usage: { ...input.task.usage },
    evidenceIds: [],
  };
}

export function confirmSessionRunning(session: SessionRecord, input: EvaluationInput): SessionRecord {
  return confirmCheckedSession(session, input, evaluateExecution(input));
}

function confirmCheckedSession(
  session: SessionRecord,
  input: EvaluationInput,
  decision: ReturnType<typeof evaluateExecution>,
): SessionRecord {
  if (session.taskId !== input.task.id || session.specialistId !== input.task.specialistId) {
    throw new SupervisorContractError("Session does not belong to this task.");
  }
  if (session.state !== "starting" && session.state !== "waiting_for_approval") {
    throw new SupervisorContractError("Session cannot enter running from this state.");
  }
  const profile = getSpecialistProfile(input.task.specialistId);
  if (session.adapterId !== profile.adapterId) {
    throw new SupervisorContractError("Session adapter does not match the specialist profile.");
  }
  if (decision.outcome !== "allowed") {
    throw new SupervisorContractError("Session cannot run without a fresh eligibility decision.");
  }
  return { ...session, state: "running" };
}
