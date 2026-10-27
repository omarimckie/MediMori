import { limits } from "./policy";

/** Matches the SQL authorization window (`started_at + 30 minutes`). */
export const authorizationDurationMs = limits.durationMs;

/** Upper bound per validation gate in `workspace.ts` Docker `exec` (`timeout: 240000`). */
export const validationGateMaxMs = 240_000;

/** Conservative bound for validation environment preparation before gates run. */
export const validationEnvironmentPrepMaxMs = 60_000;

/**
 * Reserved at the end of the authorization window for workspace cleanup, evidence
 * persistence, and a terminal `block`/`finish` ingress while the lease is still valid.
 */
export const terminalizationReserveMs = 120_000;

export type DeadlineExceeded = {
  code: "runtime_deadline_exceeded";
  validationStage: "validation_cycle" | "validation_gate";
  validationRevision: string;
  validationGate?: string;
};

export function remainingAuthorizedMs(startedAtMs: number, nowMs: number): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  return startedAtMs + authorizationDurationMs - nowMs;
}

export function maxValidationCycleMs(validationCount: number, gateMaxMs = validationGateMaxMs, envPrepMaxMs = validationEnvironmentPrepMaxMs): number {
  const gates = Number.isFinite(validationCount) && validationCount > 0 ? validationCount : 0;
  return envPrepMaxMs + gates * gateMaxMs;
}

export function checkValidationCycleBudget(input: {
  startedAtMs: number;
  nowMs: number;
  validationCount: number;
  reserveMs?: number;
  validationRevision: string;
}): DeadlineExceeded | null {
  const reserveMs = input.reserveMs ?? terminalizationReserveMs;
  const remaining = remainingAuthorizedMs(input.startedAtMs, input.nowMs);
  const required = reserveMs + maxValidationCycleMs(input.validationCount);
  if (remaining <= reserveMs || remaining < required) {
    return {
      code: "runtime_deadline_exceeded",
      validationStage: "validation_cycle",
      validationRevision: input.validationRevision,
    };
  }
  return null;
}

export function checkValidationGateBudget(input: {
  startedAtMs: number;
  nowMs: number;
  gateMaxMs?: number;
  reserveMs?: number;
  validationRevision: string;
  validationGate: string;
}): DeadlineExceeded | null {
  const reserveMs = input.reserveMs ?? terminalizationReserveMs;
  const gateMaxMs = input.gateMaxMs ?? validationGateMaxMs;
  const remaining = remainingAuthorizedMs(input.startedAtMs, input.nowMs);
  if (remaining <= reserveMs) {
    return {
      code: "runtime_deadline_exceeded",
      validationStage: "validation_gate",
      validationRevision: input.validationRevision,
      validationGate: input.validationGate,
    };
  }
  if (remaining - reserveMs < gateMaxMs) {
    return {
      code: "runtime_deadline_exceeded",
      validationStage: "validation_gate",
      validationRevision: input.validationRevision,
      validationGate: input.validationGate,
    };
  }
  return null;
}

export function checkRepairCycleBudget(input: {
  startedAtMs: number;
  nowMs: number;
  validationCount: number;
  reserveMs?: number;
  validationRevision: string;
}): DeadlineExceeded | null {
  return checkValidationCycleBudget(input);
}
