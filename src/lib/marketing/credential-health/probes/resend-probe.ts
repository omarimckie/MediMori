import type { CredentialProbeFetch } from "../probes";
import { CREDENTIAL_PROBE_TIMEOUT_MS } from "../probes";
import type { CredentialValidationAttempt } from "../types";

export const RESEND_API_KEYS_URL = "https://api.resend.com/api-keys";

export function readResendApiKey(env: Record<string, string | undefined>): string | null {
  const raw = env.RESEND_API_KEY?.trim();
  return raw || null;
}

export function parseResendAuthFromResponse(
  httpStatus: number,
): { tokenReportedValid: boolean; errorClass: string; transientFailure?: boolean } {
  if (httpStatus >= 500 || httpStatus === 429) {
    return { tokenReportedValid: false, errorClass: "resend_validation_transient", transientFailure: true };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { tokenReportedValid: false, errorClass: "resend_auth_invalid" };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    return { tokenReportedValid: true, errorClass: "" };
  }
  return { tokenReportedValid: false, errorClass: "resend_validation_inconclusive" };
}

async function fetchWithTimeout(
  fetchImpl: CredentialProbeFetch,
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<{ status: number; transientFailure?: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { status: response.status };
  } catch {
    return { status: 0, transientFailure: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function runResendCredentialProbe(input: {
  attemptedAt: string;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
  timeoutMs?: number;
}): Promise<CredentialValidationAttempt> {
  const env = input.env ?? process.env;
  const apiKey = readResendApiKey(env);
  const base = {
    platform: "resend" as const,
    method: "resend_api_keys_list" as const,
    attemptedAt: input.attemptedAt,
    permissionCheck: "not_checked" as const,
  };

  if (!apiKey) {
    return {
      ...base,
      monitoringAvailability: "not_configured",
      credentialsConfigured: false,
      errorClass: "resend_credentials_missing",
    };
  }

  const fetchImpl = input.fetch;
  if (!fetchImpl) {
    return {
      ...base,
      monitoringAvailability: "unavailable",
      credentialsConfigured: true,
      errorClass: "resend_probe_fetch_not_configured",
    };
  }

  const { status, transientFailure } = await fetchWithTimeout(
    fetchImpl,
    RESEND_API_KEYS_URL,
    apiKey,
    input.timeoutMs ?? CREDENTIAL_PROBE_TIMEOUT_MS,
  );

  if (transientFailure) {
    return {
      ...base,
      monitoringAvailability: "available",
      credentialsConfigured: true,
      transientFailure: true,
      errorClass: "resend_validation_transient",
    };
  }

  const parsed = parseResendAuthFromResponse(status);
  if (parsed.tokenReportedValid) {
    return {
      ...base,
      monitoringAvailability: "available",
      credentialsConfigured: true,
      httpStatus: status,
      tokenReportedValid: true,
    };
  }

  return {
    ...base,
    monitoringAvailability: "available",
    credentialsConfigured: true,
    httpStatus: status,
    tokenReportedValid: false,
    errorClass: parsed.errorClass,
    transientFailure: parsed.transientFailure,
  };
}
