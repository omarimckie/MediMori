import type {
  CredentialHealthClassification,
  CredentialHealthState,
  CredentialValidationAttempt,
  CredentialValidity,
} from "./types";
import { isIntegrationCredentialPlatform } from "./integration-platforms";

function build(
  healthState: CredentialHealthState,
  validity: CredentialValidity,
  attempt: CredentialValidationAttempt,
  errorClass: string | null,
): CredentialHealthClassification {
  return {
    healthState,
    validity,
    expirationKnowledge: "unknown",
    permissionCheck: "not_checked",
    confidence:
      attempt.transientFailure ||
      (errorClass != null && errorClass.endsWith("_validation_transient"))
        ? "low"
        : attempt.unsupportedMethod
          ? "medium"
          : "high",
    errorClass,
    knownExpiresAtIso: null,
    nonExpiringTokenReported: false,
  };
}

/** Classify HTTP/integration probes (OpenAI-style: auth validity, unknown expiry). */
export function classifyIntegrationCredentialHealth(
  attempt: CredentialValidationAttempt,
): CredentialHealthClassification {
  if (!attempt.credentialsConfigured) {
    return build(
      "revoked_or_invalid",
      "invalid",
      attempt,
      attempt.errorClass ?? `${attempt.platform}_credentials_missing`,
    );
  }

  if (attempt.unsupportedMethod || attempt.method === "pinterest_no_safe_probe") {
    return build(
      "unknown_expiration",
      "unknown",
      attempt,
      attempt.errorClass ?? "integration_probe_unsupported",
    );
  }

  if (attempt.unsupportedMethod || attempt.method === "unsupported") {
    return build(
      "validation_unavailable",
      "unknown",
      attempt,
      attempt.errorClass ?? "integration_validation_unsupported",
    );
  }

  if (attempt.transientFailure) {
    return build(
      "validation_unavailable",
      "unknown",
      attempt,
      attempt.errorClass ?? `${attempt.platform}_validation_transient`,
    );
  }

  if (attempt.tokenReportedValid === false) {
    const errorClass = attempt.errorClass ?? `${attempt.platform}_auth_invalid`;
    const state: CredentialHealthState =
      errorClass.endsWith("_auth_expired") || errorClass === "openai_auth_expired"
        ? "expired"
        : "revoked_or_invalid";
    return build(state, "invalid", attempt, errorClass);
  }

  if (attempt.tokenReportedValid === true) {
    return build("unknown_expiration", "valid", attempt, null);
  }

  return build(
    "validation_unavailable",
    "unknown",
    attempt,
    attempt.errorClass ?? "integration_validation_inconclusive",
  );
}

export function usesIntegrationClassifier(platform: string): boolean {
  return platform === "openai" || isIntegrationCredentialPlatform(platform);
}
