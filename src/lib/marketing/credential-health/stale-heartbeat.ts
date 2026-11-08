import { MS_PER_DAY } from "./constants";

/** After this window without a validation attempt, dashboard marks observations stale. */
export const CREDENTIAL_HEALTH_STALE_AFTER_MS = Math.round(1.5 * MS_PER_DAY);

export function isCredentialHealthObservationStale(
  lastValidationAttemptAt: string | null,
  nowIso: string,
): boolean {
  if (!lastValidationAttemptAt) {
    return true;
  }
  const attemptMs = Date.parse(lastValidationAttemptAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(attemptMs) || !Number.isFinite(nowMs)) {
    return true;
  }
  return nowMs - attemptMs > CREDENTIAL_HEALTH_STALE_AFTER_MS;
}
