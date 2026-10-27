import { sanitizeEvidence } from "../incidents/sanitize";
import type {
  CredentialHealthClassification,
  CredentialHealthState,
  CredentialValidationAttempt,
  CredentialValidationMethod,
  CredentialValidity,
  EvidenceConfidence,
  ExpirationKnowledge,
  MetaCredentialPlatform,
  PermissionCheckResult,
} from "./types";

export type CredentialHealthEvidence = {
  platform: MetaCredentialPlatform;
  health_state: CredentialHealthState;
  validity: string;
  expiration_knowledge: string;
  validation_timestamp: string;
  known_expires_at: string | null;
  error_class: string | null;
  validation_method: CredentialValidationMethod;
  permission_check: PermissionCheckResult;
  evidence_confidence: EvidenceConfidence;
  monitoring_availability: string;
  non_expiring_token_reported: boolean;
};

/**
 * Sanitized evidence for future `credential_warning` incidents. Never includes
 * tokens, fingerprints, or raw provider payloads.
 */
export function buildCredentialHealthEvidence(
  attempt: CredentialValidationAttempt,
  classification: CredentialHealthClassification,
): CredentialHealthEvidence {
  return sanitizeEvidence({
    platform: attempt.platform,
    health_state: classification.healthState,
    validity: classification.validity,
    expiration_knowledge: classification.expirationKnowledge,
    validation_timestamp: attempt.attemptedAt,
    known_expires_at: classification.knownExpiresAtIso,
    error_class: classification.errorClass,
    validation_method: attempt.method,
    permission_check: classification.permissionCheck,
    evidence_confidence: classification.confidence,
    monitoring_availability: attempt.monitoringAvailability,
    non_expiring_token_reported: classification.nonExpiringTokenReported,
  }) as CredentialHealthEvidence;
}

/** In-memory view when no incident row exists (healthy / unknown monitoring). */
export type CredentialHealthStatusView = {
  platform: MetaCredentialPlatform;
  healthState: CredentialHealthState;
  validity: CredentialValidity | null;
  expirationKnowledge: ExpirationKnowledge | null;
  permissionCheck: PermissionCheckResult | null;
  lastAttemptedAt: string | null;
  lastSuccessfulValidationAt: string | null;
  evidence: CredentialHealthEvidence | null;
};

export function buildCredentialHealthStatusView(
  attempt: CredentialValidationAttempt | null,
  classification: CredentialHealthClassification | null,
  lastSuccessfulValidationAt: string | null,
): CredentialHealthStatusView {
  if (!attempt || !classification) {
    return {
      platform: attempt?.platform ?? "facebook",
      healthState: "validation_unavailable",
      validity: null,
      expirationKnowledge: null,
      permissionCheck: null,
      lastAttemptedAt: attempt?.attemptedAt ?? null,
      lastSuccessfulValidationAt,
      evidence: null,
    };
  }
  const evidence = buildCredentialHealthEvidence(attempt, classification);
  const successAt =
    classification.validity === "valid" &&
    classification.healthState !== "validation_unavailable"
      ? attempt.attemptedAt
      : lastSuccessfulValidationAt;
  return {
    platform: attempt.platform,
    healthState: classification.healthState,
    validity: classification.validity,
    expirationKnowledge: classification.expirationKnowledge,
    permissionCheck: classification.permissionCheck,
    lastAttemptedAt: attempt.attemptedAt,
    lastSuccessfulValidationAt: successAt,
    evidence,
  };
}
