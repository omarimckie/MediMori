import type { CredentialProbeFetch } from "../probes";
import { CREDENTIAL_PROBE_TIMEOUT_MS } from "../probes";
import type { CredentialValidationAttempt } from "../types";

export const STRIPE_BALANCE_URL = "https://api.stripe.com/v1/balance";

export function readStripeSecretKey(env: Record<string, string | undefined>): string | null {
  const raw = env.STRIPE_SECRET_KEY?.trim();
  return raw || null;
}

export function parseStripeAuthFromResponse(
  httpStatus: number,
): { tokenReportedValid: boolean; errorClass: string; transientFailure?: boolean } {
  if (httpStatus >= 500 || httpStatus === 429) {
    return { tokenReportedValid: false, errorClass: "stripe_validation_transient", transientFailure: true };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { tokenReportedValid: false, errorClass: "stripe_auth_invalid" };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    return { tokenReportedValid: true, errorClass: "" };
  }
  return { tokenReportedValid: false, errorClass: "stripe_validation_inconclusive" };
}

async function fetchWithTimeout(
  fetchImpl: CredentialProbeFetch,
  url: string,
  secretKey: string,
  timeoutMs: number,
): Promise<{ status: number; transientFailure?: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    return { status: response.status };
  } catch {
    return { status: 0, transientFailure: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function runStripeCredentialProbe(input: {
  attemptedAt: string;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
  timeoutMs?: number;
}): Promise<CredentialValidationAttempt> {
  const env = input.env ?? process.env;
  const secret = readStripeSecretKey(env);
  const base = {
    platform: "stripe" as const,
    method: "stripe_balance_get" as const,
    attemptedAt: input.attemptedAt,
    permissionCheck: "not_checked" as const,
  };

  if (!secret) {
    return {
      ...base,
      monitoringAvailability: "not_configured",
      credentialsConfigured: false,
      errorClass: "stripe_credentials_missing",
    };
  }

  const fetchImpl = input.fetch;
  if (!fetchImpl) {
    return {
      ...base,
      monitoringAvailability: "unavailable",
      credentialsConfigured: true,
      errorClass: "stripe_probe_fetch_not_configured",
    };
  }

  const { status, transientFailure } = await fetchWithTimeout(
    fetchImpl,
    STRIPE_BALANCE_URL,
    secret,
    input.timeoutMs ?? CREDENTIAL_PROBE_TIMEOUT_MS,
  );

  if (transientFailure) {
    return {
      ...base,
      monitoringAvailability: "available",
      credentialsConfigured: true,
      httpStatus: status || undefined,
      transientFailure: true,
      errorClass: "stripe_validation_transient",
    };
  }

  const parsed = parseStripeAuthFromResponse(status);
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
