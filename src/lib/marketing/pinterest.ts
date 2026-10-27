import { redactSecrets } from "./meta";

export const PINTEREST_API_BASE = "https://api.pinterest.com/v5";

export type PinterestErrorCode =
  | "pinterest_credentials_missing"
  | "pinterest_auth_expired"
  | "pinterest_permissions"
  | "pinterest_http_error"
  | "pinterest_malformed_response"
  | "pinterest_rate_limit"
  | "pinterest_invalid_request"
  | "pinterest_board_missing"
  | "pinterest_already_published";

export type PinterestApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; errorCode: PinterestErrorCode; retryable: boolean };

export type PinterestCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  boardId: string;
  boardSectionId: string | null;
};

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

export function clearPinterestTokenCacheForTests() {
  tokenCache = null;
}

export function getPinterestCredentials(env: Record<string, string | undefined> = process.env): PinterestCredentials | null {
  const clientId = env.PINTEREST_CLIENT_ID?.trim();
  const clientSecret = env.PINTEREST_CLIENT_SECRET?.trim();
  const refreshToken = env.PINTEREST_REFRESH_TOKEN?.trim();
  const boardId = env.PINTEREST_BOARD_ID?.trim();
  if (!clientId || !clientSecret || !refreshToken || !boardId) return null;
  const boardSectionId = env.PINTEREST_BOARD_SECTION_ID?.trim() || null;
  return { clientId, clientSecret, refreshToken, boardId, boardSectionId };
}

export function isPinterestLiveConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getPinterestCredentials(env) !== null;
}

function classifyPinterestHttpError(
  status: number,
  json: unknown,
  secrets: Array<string | null | undefined>,
): { error: string; errorCode: PinterestErrorCode; retryable: boolean } {
  const message =
    json && typeof json === "object" && "message" in json
      ? String((json as { message?: unknown }).message ?? "Pinterest API error.")
      : "Pinterest API error.";
  const redacted = redactSecrets(message, secrets);
  if (status === 401 || status === 403) {
    return {
      error: `pinterest_auth_expired: ${redacted}`,
      errorCode: "pinterest_auth_expired",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      error: `pinterest_rate_limit: ${redacted}`,
      errorCode: "pinterest_rate_limit",
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      error: `pinterest_http_error: ${redacted}`,
      errorCode: "pinterest_http_error",
      retryable: true,
    };
  }
  return {
    error: `pinterest_invalid_request: ${redacted}`,
    errorCode: "pinterest_invalid_request",
    retryable: false,
  };
}

export async function refreshPinterestAccessToken(
  credentials: PinterestCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<PinterestApiResult<{ access_token: string; expires_in?: number }>> {
  const secrets = [credentials.clientSecret, credentials.refreshToken];
  const auth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
  let response: Response;
  try {
    response = await fetchImpl(`${PINTEREST_API_BASE}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
      }),
    });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : "Network error", secrets);
    return {
      ok: false,
      error: `pinterest_http_error: ${message}`,
      errorCode: "pinterest_http_error",
      retryable: true,
    };
  }

  let json: unknown = null;
  const rawText = await response.text();
  if (rawText) {
    try {
      json = JSON.parse(rawText) as unknown;
    } catch {
      return {
        ok: false,
        error: "pinterest_malformed_response: Pinterest token response was not JSON.",
        errorCode: "pinterest_malformed_response",
        retryable: false,
      };
    }
  }

  if (!response.ok) {
    const classified = classifyPinterestHttpError(response.status, json, secrets);
    return { ok: false, ...classified };
  }

  const data = json as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!data.access_token) {
    return {
      ok: false,
      error: "pinterest_malformed_response: Pinterest token response did not include access_token.",
      errorCode: "pinterest_malformed_response",
      retryable: false,
    };
  }
  return { ok: true, data: { access_token: data.access_token, expires_in: data.expires_in } };
}

export async function getPinterestAccessToken(
  credentials: PinterestCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<PinterestApiResult<string>> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 60_000) {
    return { ok: true, data: tokenCache.accessToken };
  }
  const refreshed = await refreshPinterestAccessToken(credentials, fetchImpl);
  if (!refreshed.ok) return refreshed;
  const expiresInSec = refreshed.data.expires_in ?? 3600;
  tokenCache = {
    accessToken: refreshed.data.access_token,
    expiresAtMs: now + expiresInSec * 1000,
  };
  return { ok: true, data: tokenCache.accessToken };
}

export type CreatePinInput = {
  boardId: string;
  boardSectionId?: string | null;
  title: string;
  description: string;
  link: string;
  altText?: string | null;
  imageUrl: string;
};

export type CreatePinResponse = {
  id?: string;
  link?: string;
};

export async function createPinterestPin(
  accessToken: string,
  input: CreatePinInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PinterestApiResult<CreatePinResponse>> {
  const secrets = [accessToken];
  const body: Record<string, unknown> = {
    board_id: input.boardId,
    title: input.title,
    description: input.description,
    link: input.link,
    alt_text: input.altText ?? undefined,
    media_source: {
      source_type: "image_url",
      url: input.imageUrl,
    },
  };
  if (input.boardSectionId) {
    body.board_section_id = input.boardSectionId;
  }

  let response: Response;
  try {
    response = await fetchImpl(`${PINTEREST_API_BASE}/pins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : "Network error", secrets);
    return {
      ok: false,
      error: `pinterest_http_error: ${message}`,
      errorCode: "pinterest_http_error",
      retryable: true,
    };
  }

  let json: unknown = null;
  const rawText = await response.text();
  if (rawText) {
    try {
      json = JSON.parse(rawText) as unknown;
    } catch {
      return {
        ok: false,
        error: "pinterest_malformed_response: Pinterest pin response was not JSON.",
        errorCode: "pinterest_malformed_response",
        retryable: false,
      };
    }
  }

  if (!response.ok) {
    const classified = classifyPinterestHttpError(response.status, json, secrets);
    return { ok: false, ...classified };
  }

  const data = json as CreatePinResponse;
  if (!data.id) {
    return {
      ok: false,
      error: "pinterest_malformed_response: Pinterest pin response did not include id.",
      errorCode: "pinterest_malformed_response",
      retryable: false,
    };
  }
  return { ok: true, data };
}

export function pinterestPinPublicUrl(pinId: string): string {
  return `https://www.pinterest.com/pin/${pinId}/`;
}

export function truncatePinterestTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= 100) return trimmed;
  return `${trimmed.slice(0, 97)}...`;
}

export function truncatePinterestDescription(description: string): string {
  const trimmed = description.trim();
  if (trimmed.length <= 800) return trimmed;
  return `${trimmed.slice(0, 797)}...`;
}
