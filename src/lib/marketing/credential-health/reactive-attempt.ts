import type { CredentialValidationAttempt, MetaCredentialPlatform } from "./types";

const REACTIVE_ERROR_CLASSES = new Set([
  "meta_credentials_missing",
  "meta_auth_expired",
  "meta_permissions",
]);

export function isReactiveCredentialErrorClass(errorClass: string): boolean {
  return REACTIVE_ERROR_CLASSES.has(errorClass);
}

/**
 * Synthetic validation attempt from an authoritative publishing failure (reactive path).
 * Does not perform HTTP.
 */
export function credentialAttemptFromReactivePublishFailure(input: {
  platform: MetaCredentialPlatform;
  attemptedAt: string;
  errorClass: string;
  credentialsConfigured?: boolean;
}): CredentialValidationAttempt {
  const credentialsConfigured = input.credentialsConfigured ?? true;
  const base = {
    platform: input.platform,
    method: "not_attempted" as const,
    attemptedAt: input.attemptedAt,
    monitoringAvailability: "available" as const,
    credentialsConfigured,
    permissionCheck:
      input.errorClass === "meta_permissions"
        ? ("insufficient" as const)
        : ("not_checked" as const),
    errorClass: input.errorClass,
  };

  if (!credentialsConfigured || input.errorClass === "meta_credentials_missing") {
    return {
      ...base,
      credentialsConfigured: false,
      tokenReportedValid: false,
      errorClass: "meta_credentials_missing",
    };
  }

  if (input.errorClass === "meta_auth_expired") {
    return {
      ...base,
      tokenReportedValid: false,
    };
  }

  if (input.errorClass === "meta_permissions") {
    return {
      ...base,
      tokenReportedValid: false,
      permissionCheck: "insufficient",
    };
  }

  return {
    ...base,
    tokenReportedValid: false,
    errorClass: input.errorClass,
  };
}
