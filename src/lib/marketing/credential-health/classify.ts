import {
  CREDENTIAL_EXPIRING_SOON_DAYS,
  MS_PER_DAY,
} from "./constants";
import type {
  CredentialHealthClassification,
  CredentialHealthState,
  CredentialValidationAttempt,
  CredentialValidity,
  EvidenceConfidence,
  ExpirationKnowledge,
} from "./types";

export type ClassifyCredentialHealthOptions = {
  /** Reference instant for expiring-soon (ISO). Defaults to attempt time. */
  referenceNowIso?: string;
};

function parseMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function confidenceFor(attempt: CredentialValidationAttempt): EvidenceConfidence {
  if (attempt.method === "meta_debug_token" && attempt.tokenReportedValid != null) {
    return attempt.permissionCheck === "unknown" ? "medium" : "high";
  }
  if (attempt.method === "instagram_graph_me" && attempt.tokenReportedValid === true) {
    return "low";
  }
  if (attempt.transientFailure) {
    return "low";
  }
  return "medium";
}

function buildClassification(
  healthState: CredentialHealthState,
  validity: CredentialValidity,
  expirationKnowledge: ExpirationKnowledge,
  attempt: CredentialValidationAttempt,
  errorClass: string | null,
  knownExpiresAtIso: string | null,
): CredentialHealthClassification {
  return {
    healthState,
    validity,
    expirationKnowledge,
    permissionCheck: attempt.permissionCheck,
    confidence: confidenceFor(attempt),
    errorClass,
    knownExpiresAtIso,
    nonExpiringTokenReported: Boolean(attempt.nonExpiringTokenReported),
  };
}

export function classifyCredentialHealth(
  attempt: CredentialValidationAttempt,
  options: ClassifyCredentialHealthOptions = {},
): CredentialHealthClassification {
  const referenceIso = options.referenceNowIso ?? attempt.attemptedAt;
  const nowMs = parseMs(referenceIso) ?? Date.now();
  const expiringSoonMs = CREDENTIAL_EXPIRING_SOON_DAYS * MS_PER_DAY;

  if (!attempt.credentialsConfigured) {
    return buildClassification(
      "revoked_or_invalid",
      "invalid",
      "unknown",
      attempt,
      "meta_credentials_missing",
      null,
    );
  }

  if (attempt.unsupportedMethod || attempt.method === "unsupported") {
    return buildClassification(
      "validation_unavailable",
      "unknown",
      "unknown",
      attempt,
      attempt.errorClass ?? "meta_validation_method_unsupported",
      null,
    );
  }

  if (attempt.transientFailure) {
    return buildClassification(
      "validation_unavailable",
      "unknown",
      attempt.knownExpiresAtIso ? "known" : "unknown",
      attempt,
      attempt.errorClass ?? "meta_validation_transient",
      attempt.knownExpiresAtIso ?? null,
    );
  }

  if (attempt.tokenReportedValid === false) {
    const errorClass = attempt.errorClass ?? "meta_auth_expired";
    const state: CredentialHealthState =
      errorClass === "meta_auth_expired" ? "expired" : "revoked_or_invalid";
    return buildClassification(state, "invalid", "unknown", attempt, errorClass, null);
  }

  if (attempt.permissionCheck === "insufficient") {
    return buildClassification(
      "revoked_or_invalid",
      "invalid",
      attempt.nonExpiringTokenReported ? "provider_non_expiring" : "known",
      attempt,
      "meta_permissions",
      attempt.knownExpiresAtIso ?? null,
    );
  }

  if (attempt.tokenReportedValid !== true) {
    return buildClassification(
      "validation_unavailable",
      "unknown",
      "unknown",
      attempt,
      attempt.errorClass ?? "meta_validation_inconclusive",
      null,
    );
  }

  if (attempt.nonExpiringTokenReported) {
    const healthState: CredentialHealthState =
      attempt.permissionCheck === "sufficient" ? "healthy" : "unknown_expiration";
    return buildClassification(
      healthState,
      "valid",
      "provider_non_expiring",
      attempt,
      null,
      null,
    );
  }

  if (attempt.knownExpiresAtIso == null) {
    return buildClassification(
      "unknown_expiration",
      "valid",
      "unknown",
      attempt,
      null,
      null,
    );
  }

  const expiresMs = parseMs(attempt.knownExpiresAtIso);
  if (expiresMs == null) {
    return buildClassification(
      "unknown_expiration",
      "valid",
      "unknown",
      attempt,
      null,
      null,
    );
  }

  if (expiresMs <= nowMs) {
    return buildClassification(
      "expired",
      "invalid",
      "known",
      attempt,
      "meta_auth_expired",
      attempt.knownExpiresAtIso,
    );
  }

  if (expiresMs - nowMs <= expiringSoonMs) {
    return buildClassification(
      "expiring_soon",
      "valid",
      "known",
      attempt,
      null,
      attempt.knownExpiresAtIso,
    );
  }

  return buildClassification(
    "healthy",
    "valid",
    "known",
    attempt,
    null,
    attempt.knownExpiresAtIso,
  );
}
