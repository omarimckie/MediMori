import type {
  CredentialHealthClassification,
  CredentialHealthState,
  CredentialValidationAttempt,
  CredentialValidity,
} from "./types";

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
      attempt.transientFailure || attempt.errorClass === "openai_validation_transient"
        ? "low"
        : "high",
    errorClass,
    knownExpiresAtIso: null,
    nonExpiringTokenReported: false,
  };
}

export function classifyOpenAiCredentialHealth(
  attempt: CredentialValidationAttempt,
): CredentialHealthClassification {
  if (!attempt.credentialsConfigured) {
    return build("revoked_or_invalid", "invalid", attempt, "openai_credentials_missing");
  }

  if (attempt.unsupportedMethod || attempt.method === "unsupported") {
    return build(
      "validation_unavailable",
      "unknown",
      attempt,
      attempt.errorClass ?? "openai_validation_unsupported",
    );
  }

  if (attempt.transientFailure) {
    return build(
      "validation_unavailable",
      "unknown",
      attempt,
      attempt.errorClass ?? "openai_validation_transient",
    );
  }

  if (attempt.tokenReportedValid === false) {
    const errorClass = attempt.errorClass ?? "openai_auth_invalid";
    const state: CredentialHealthState =
      errorClass === "openai_auth_expired" ? "expired" : "revoked_or_invalid";
    return build(state, "invalid", attempt, errorClass);
  }

  if (attempt.tokenReportedValid === true) {
    return build("unknown_expiration", "valid", attempt, null);
  }

  return build(
    "validation_unavailable",
    "unknown",
    attempt,
    attempt.errorClass ?? "openai_validation_inconclusive",
  );
}
