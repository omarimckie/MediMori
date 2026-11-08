import { classifyCredentialHealth } from "./classify";
import { classifyOpenAiCredentialHealth } from "./classify-openai";
import { buildCredentialHealthEvidence } from "./evidence";
import type {
  CredentialHealthClassification,
  CredentialHealthSnapshot,
  CredentialValidationAttempt,
} from "./types";

export type BuildCredentialHealthSnapshotInput = {
  attempt: CredentialValidationAttempt;
  credentialFingerprint: string | null;
  lastSuccessfulValidationAt: string | null;
  referenceNowIso?: string;
};

export function classifyCredentialAttempt(
  attempt: CredentialValidationAttempt,
  referenceNowIso?: string,
): CredentialHealthClassification {
  if (attempt.platform === "openai") {
    return classifyOpenAiCredentialHealth(attempt);
  }
  return classifyCredentialHealth(attempt, { referenceNowIso });
}

export function buildCredentialHealthSnapshotForAttempt(
  input: BuildCredentialHealthSnapshotInput,
): CredentialHealthSnapshot {
  const classification = classifyCredentialAttempt(
    input.attempt,
    input.referenceNowIso,
  );
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
