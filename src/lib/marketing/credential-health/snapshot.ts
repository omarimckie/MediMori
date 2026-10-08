import { classifyCredentialHealth } from "./classify";
import { buildCredentialHealthEvidence } from "./evidence";
import type {
  CredentialHealthSnapshot,
  CredentialValidationAttempt,
} from "./types";

export type BuildCredentialHealthSnapshotInput = {
  attempt: CredentialValidationAttempt;
  credentialFingerprint: string | null;
  lastSuccessfulValidationAt: string | null;
  referenceNowIso?: string;
};

export function buildCredentialHealthSnapshot(
  input: BuildCredentialHealthSnapshotInput,
): CredentialHealthSnapshot {
  const classification = classifyCredentialHealth(input.attempt, {
    referenceNowIso: input.referenceNowIso,
  });
  const successAt =
    classification.validity === "valid" &&
    classification.healthState !== "validation_unavailable"
      ? input.attempt.attemptedAt
      : input.lastSuccessfulValidationAt;

  return {
    platform: input.attempt.platform,
    classification,
    attemptedAt: input.attempt.attemptedAt,
    lastSuccessfulValidationAt: successAt,
    validationMethod: input.attempt.method,
    monitoringAvailability: input.attempt.monitoringAvailability,
    credentialFingerprint: input.credentialFingerprint,
  };
}

/** Evidence safe for incidents — excludes fingerprint. */
export function snapshotIncidentEvidence(
  input: BuildCredentialHealthSnapshotInput,
): Record<string, unknown> {
  const snapshot = buildCredentialHealthSnapshot(input);
  const attempt = input.attempt;
  return buildCredentialHealthEvidence(attempt, snapshot.classification);
}
