import { CREDENTIAL_PROBE_TIMEOUT_MS, type CredentialProbeFetch } from "./probes";
import type { CredentialValidationAttempt } from "./types";

export const OPENAI_MODELS_LIST_URL = "https://api.openai.com/v1/models";

const SECRET_IN_MESSAGE = /sk-[A-Za-z0-9]{8,}/;

export type OpenAiProbeErrorBody = {
  error?: { message?: string; code?: string; type?: string };
};

export function parseOpenAiAuthErrorFromBody(
  httpStatus: number,
  body: unknown,
): { tokenReportedValid: boolean; errorClass: string } {
  if (httpStatus >= 500 || httpStatus === 429) {
    return {
      tokenReportedValid: false,
      errorClass: "openai_validation_transient",
    };
  }

  if (httpStatus === 401 || httpStatus === 403) {
    const err = (body as OpenAiProbeErrorBody)?.error;
    const code = err?.code?.trim() ?? "";
    if (code === "expired_secret_key") {
      return { tokenReportedValid: false, errorClass: "openai_auth_expired" };
    }
    if (code === "invalid_api_key" || code === "account_deactivated") {
      return { tokenReportedValid: false, errorClass: "openai_auth_invalid" };
    }
    return { tokenReportedValid: false, errorClass: "openai_auth_invalid" };
  }

  if (httpStatus >= 200 && httpStatus < 300) {
    return { tokenReportedValid: true, errorClass: "" };
  }

  return { tokenReportedValid: false, errorClass: "openai_validation_inconclusive" };
}

export function readOpenAiApiKey(env: Record<string, string | undefined>): string | null {
  const raw = env.OPENAI_API_KEY?.trim();
  return raw || null;
}

async function fetchWithTimeout(
  fetchImpl: CredentialProbeFetch,
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown; transientFailure?: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (body && typeof body === "object") {
      const message = (body as OpenAiProbeErrorBody).error?.message;
      if (typeof message === "string" && SECRET_IN_MESSAGE.test(message)) {
        (body as OpenAiProbeErrorBody).error = {
          ...(body as OpenAiProbeErrorBody).error,
          message: "[redacted]",
        };
      }
    }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null, transientFailure: true };
  } finally {
    clearTimeout(timer);
  }
}

export type RunOpenAiCredentialProbeInput = {
  attemptedAt: string;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
  timeoutMs?: number;
};

export async function runOpenAiCredentialProbe(
  input: RunOpenAiCredentialProbeInput,
): Promise<CredentialValidationAttempt> {
  const env = input.env ?? process.env;
  const apiKey = readOpenAiApiKey(env);
  const credentialsConfigured = Boolean(apiKey);

  const base: Omit<CredentialValidationAttempt, "credentialsConfigured"> = {
    platform: "openai",
    method: "openai_models_list",
    attemptedAt: input.attemptedAt,
    monitoringAvailability: credentialsConfigured ? "available" : "not_configured",
    permissionCheck: "not_checked",
  };

  if (!credentialsConfigured) {
    return {
      ...base,
      credentialsConfigured: false,
      errorClass: "openai_credentials_missing",
    };
  }

  const fetchImpl = input.fetch;
  if (!fetchImpl) {
    return {
      ...base,
      credentialsConfigured: true,
      monitoringAvailability: "unavailable",
      errorClass: "openai_probe_fetch_not_configured",
    };
  }

  const { status, body, transientFailure } = await fetchWithTimeout(
    fetchImpl,
    OPENAI_MODELS_LIST_URL,
    apiKey!,
    input.timeoutMs ?? CREDENTIAL_PROBE_TIMEOUT_MS,
  );

  if (transientFailure) {
    return {
      ...base,
      credentialsConfigured: true,
      httpStatus: status || undefined,
      transientFailure: true,
      errorClass: "openai_validation_transient",
    };
  }

  const parsed = parseOpenAiAuthErrorFromBody(status, body);
  if (parsed.tokenReportedValid) {
    return {
      ...base,
      credentialsConfigured: true,
      httpStatus: status,
      tokenReportedValid: true,
    };
  }

  return {
    ...base,
    credentialsConfigured: true,
    httpStatus: status,
    tokenReportedValid: false,
    errorClass: parsed.errorClass || "openai_validation_inconclusive",
    transientFailure: parsed.errorClass === "openai_validation_transient",
  };
}
