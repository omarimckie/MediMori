import {
  getMetaFacebookCredentials,
  getMetaGraphVersion,
  getMetaInstagramCredentials,
} from "../config";
import {
  credentialAttemptFromInstagramGraphMe,
  credentialAttemptFromMetaDebugToken,
  credentialAttemptFromUnsupportedMethod,
} from "./meta-debug-token";
import {
  getMetaAppCredentialsForDebugToken,
} from "./monitoring-config";
import { supportedProbeMethodForPlatform } from "./provider-methods";
import type { CredentialValidationAttempt, MetaCredentialPlatform } from "./types";

export const CREDENTIAL_PROBE_TIMEOUT_MS = 10_000;

export type CredentialProbeFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** Production cron path: Node/edge `fetch` with injectable probe shape. */
export async function runtimeCredentialProbeFetch(
  url: string,
  init: { signal: AbortSignal },
): Promise<{ status: number; json: () => Promise<unknown> }> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    json: () => response.json(),
  };
}

function credentialsConfiguredForPlatform(
  platform: MetaCredentialPlatform,
  env: Record<string, string | undefined>,
): boolean {
  if (platform === "facebook") {
    const pageToken = facebookAccessToken(env);
    const app = getMetaAppCredentialsForDebugToken(env);
    return Boolean(pageToken && app);
  }
  return Boolean(instagramAccessToken(env));
}

function attemptProbeFetchNotConfigured(
  platform: MetaCredentialPlatform,
  method: CredentialValidationAttempt["method"],
  attemptedAt: string,
  env: Record<string, string | undefined>,
): CredentialValidationAttempt {
  return {
    platform,
    method,
    attemptedAt,
    monitoringAvailability: "unavailable",
    credentialsConfigured: credentialsConfiguredForPlatform(platform, env),
    permissionCheck: "not_checked",
    errorClass: "meta_probe_fetch_not_configured",
  };
}

export type RunCredentialProbeInput = {
  platform: MetaCredentialPlatform;
  attemptedAt: string;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
  timeoutMs?: number;
};

async function fetchWithTimeout(
  fetchImpl: CredentialProbeFetch,
  url: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown; transientFailure?: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null, transientFailure: true };
  } finally {
    clearTimeout(timer);
  }
}

function facebookAccessToken(env: Record<string, string | undefined>): string | null {
  const creds = getMetaFacebookCredentials(env);
  return creds?.pageAccessToken ?? null;
}

function instagramAccessToken(env: Record<string, string | undefined>): string | null {
  const creds = getMetaInstagramCredentials(env);
  return creds?.accessToken ?? null;
}

export function buildFacebookDebugTokenProbeUrl(
  input: {
    graphVersion: string;
    pageAccessToken: string;
    appId: string;
    appSecret: string;
  },
): string {
  const appToken = `${input.appId}|${input.appSecret}`;
  const params = new URLSearchParams({
    input_token: input.pageAccessToken,
    access_token: appToken,
  });
  return `https://graph.facebook.com/${input.graphVersion}/debug_token?${params}`;
}

export function buildInstagramGraphMeProbeUrl(
  input: { accessToken: string },
): string {
  const params = new URLSearchParams({
    fields: "user_id",
    access_token: input.accessToken,
  });
  return `https://graph.instagram.com/me?${params}`;
}

/**
 * Read-only provider probe (injectable fetch for tests). No live calls during B3-B verification.
 */
export async function runCredentialProbe(
  input: RunCredentialProbeInput,
): Promise<CredentialValidationAttempt> {
  const env = input.env ?? process.env;
  const method = supportedProbeMethodForPlatform(input.platform);
  const fetchImpl = input.fetch;
  const timeoutMs = input.timeoutMs ?? CREDENTIAL_PROBE_TIMEOUT_MS;

  if (method === "unsupported") {
    return credentialAttemptFromUnsupportedMethod(input.platform, input.attemptedAt);
  }

  if (!fetchImpl) {
    return attemptProbeFetchNotConfigured(
      input.platform,
      method,
      input.attemptedAt,
      env,
    );
  }

  if (input.platform === "facebook") {
    const pageToken = facebookAccessToken(env);
    const app = getMetaAppCredentialsForDebugToken(env);
    const credentialsConfigured = Boolean(pageToken && app);
    if (!credentialsConfigured) {
      return credentialAttemptFromMetaDebugToken({
        platform: "facebook",
        attemptedAt: input.attemptedAt,
        credentialsConfigured: false,
        httpStatus: 0,
        body: null,
      });
    }
    const url = buildFacebookDebugTokenProbeUrl({
      graphVersion: getMetaGraphVersion(env),
      pageAccessToken: pageToken!,
      appId: app!.appId,
      appSecret: app!.appSecret,
    });
    const { status, body, transientFailure } = await fetchWithTimeout(
      fetchImpl,
      url,
      timeoutMs,
    );
    const metaError = (body as { error?: { code?: number; error_subcode?: number } })?.error;
    return credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: input.attemptedAt,
      credentialsConfigured: true,
      httpStatus: status,
      body,
      metaErrorCode: metaError?.code,
      metaErrorSubcode: metaError?.error_subcode,
      transientFailure,
    });
  }

  const igToken = instagramAccessToken(env);
  const credentialsConfigured = Boolean(igToken);
  if (!credentialsConfigured) {
    return credentialAttemptFromInstagramGraphMe({
      attemptedAt: input.attemptedAt,
      credentialsConfigured: false,
      httpStatus: 0,
      body: null,
    });
  }
  const url = buildInstagramGraphMeProbeUrl({ accessToken: igToken! });
  const { status, body, transientFailure } = await fetchWithTimeout(
    fetchImpl,
    url,
    timeoutMs,
  );
  const metaError = (body as { error?: { code?: number } })?.error;
  return credentialAttemptFromInstagramGraphMe({
    attemptedAt: input.attemptedAt,
    credentialsConfigured: true,
    httpStatus: status,
    body,
    metaErrorCode: metaError?.code,
    transientFailure,
  });
}

export function readAccessTokenForFingerprint(
  platform: MetaCredentialPlatform,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (platform === "facebook") {
    return facebookAccessToken(env);
  }
  return instagramAccessToken(env);
}
