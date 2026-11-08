import { getPinterestCredentials } from "../../pinterest";
import type { CredentialValidationAttempt } from "../types";

/**
 * Pinterest live auth uses OAuth refresh in production. Monitoring must not
 * rotate/refresh tokens solely to probe — report unknown when refresh-only.
 */
export async function runPinterestCredentialProbe(input: {
  attemptedAt: string;
  env?: Record<string, string | undefined>;
}): Promise<CredentialValidationAttempt> {
  const env = input.env ?? process.env;
  const creds = getPinterestCredentials(env);
  const base = {
    platform: "pinterest" as const,
    method: "pinterest_no_safe_probe" as const,
    attemptedAt: input.attemptedAt,
    permissionCheck: "not_checked" as const,
  };

  if (!creds) {
    return {
      ...base,
      monitoringAvailability: "not_configured",
      credentialsConfigured: false,
      errorClass: "pinterest_credentials_missing",
    };
  }

  return {
    ...base,
    monitoringAvailability: "available",
    credentialsConfigured: true,
    unsupportedMethod: true,
    errorClass: "pinterest_no_safe_probe",
  };
}
