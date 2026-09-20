export type MetaErrorCode =
  | "meta_credentials_missing"
  | "meta_auth_expired"
  | "meta_permissions"
  | "meta_http_error"
  | "meta_malformed_response"
  | "meta_image_missing"
  | "meta_image_inaccessible"
  | "meta_invalid_image_aspect_ratio"
  | "meta_media_not_ready"
  | "meta_container_error"
  | "meta_container_expired"
  | "meta_container_status_timeout"
  | "meta_container_status_unknown"
  | "meta_already_published";

export type InstagramContainerStatusCode =
  | "FINISHED"
  | "IN_PROGRESS"
  | "ERROR"
  | "EXPIRED";

/** Hard cap on total time spent waiting for container readiness (serverless-safe). */
export const INSTAGRAM_CONTAINER_POLL_MAX_WAIT_MS = 40_000;
/** Maximum GET /{container-id}?fields=status_code requests per publish attempt. */
export const INSTAGRAM_CONTAINER_POLL_MAX_REQUESTS = 8;
const INSTAGRAM_CONTAINER_POLL_INITIAL_DELAY_MS = 400;
const INSTAGRAM_CONTAINER_POLL_MAX_DELAY_MS = 8_000;
const INSTAGRAM_CONTAINER_POLL_BACKOFF_FACTOR = 2;

export type MetaGraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; errorCode: MetaErrorCode; retryable: boolean };

const PRIVATE_HOSTS = /^(localhost|127\.0\.0\.1|::1)$/i;
const PRIVATE_IPV4 =
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/;

export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out.replace(/access_token=[^&\s]+/gi, "access_token=[redacted]");
}

export function composePublishCaption(body: string, cta?: string | null): string {
  const parts = [body.trim()];
  if (cta?.trim()) parts.push(cta.trim());
  return parts.join("\n\n").slice(0, 2200);
}

export function isPublicHttpsImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (PRIVATE_HOSTS.test(parsed.hostname)) return false;
  if (PRIVATE_IPV4.test(parsed.hostname)) return false;
  return true;
}

export function publicImageUrlError(url: string | null | undefined): string | null {
  if (!url?.trim()) return "No publishable image URL is attached to this content.";
  if (!isPublicHttpsImageUrl(url)) {
    return "Image URL must be a publicly reachable https URL. Localhost and private hosts cannot be fetched by Meta.";
  }
  return null;
}

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
  };
};

export function classifyMetaHttpError(
  status: number,
  body: unknown,
  secrets: Array<string | null | undefined>,
): { error: string; errorCode: MetaErrorCode; retryable: boolean } {
  const parsed = (body ?? {}) as MetaErrorBody;
  const code = parsed.error?.code;
  const rawMessage =
    parsed.error?.error_user_msg ||
    parsed.error?.message ||
    (typeof body === "string" ? body : `Meta API HTTP ${status}`);
  const message = redactSecrets(rawMessage, secrets);

  if (code === 190 || code === 102 || code === 463 || code === 467) {
    return {
      error: `meta_auth_expired: Meta needs a new access token. ${message}`,
      errorCode: "meta_auth_expired",
      retryable: false,
    };
  }
  if (code === 10 || code === 200 || code === 294 || code === 3) {
    return {
      error: `meta_permissions: Meta app is missing a required permission. ${message}`,
      errorCode: "meta_permissions",
      retryable: false,
    };
  }
  if (status >= 500 || code === 1 || code === 2 || code === 4 || code === 17 || code === 32) {
    return {
      error: `meta_http_error: transient Meta API failure. ${message}`,
      errorCode: "meta_http_error",
      retryable: true,
    };
  }
  if (
    /aspect ratio/i.test(message) &&
    (/cannot be published/i.test(message) ||
      /valid aspect ratio/i.test(message) ||
      /submit an image/i.test(message))
  ) {
    return {
      error: `meta_invalid_image_aspect_ratio: ${message}`,
      errorCode: "meta_invalid_image_aspect_ratio",
      retryable: false,
    };
  }
  if (code === 100 && /image|url|photo/i.test(message)) {
    return {
      error: `meta_image_inaccessible: ${message}`,
      errorCode: "meta_image_inaccessible",
      retryable: false,
    };
  }
  if (/media is not ready/i.test(message) || /not ready for publishing/i.test(message)) {
    return {
      error: `meta_media_not_ready: ${message}`,
      errorCode: "meta_media_not_ready",
      retryable: false,
    };
  }
  return {
    error: `meta_http_error: ${message}`,
    errorCode: "meta_http_error",
    retryable: false,
  };
}

export function defaultMetaSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseInstagramContainerStatusCode(
  data: Record<string, unknown>,
): InstagramContainerStatusCode | null {
  const raw = data.status_code;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const code = raw.trim().toUpperCase();
  if (
    code === "FINISHED" ||
    code === "IN_PROGRESS" ||
    code === "ERROR" ||
    code === "EXPIRED"
  ) {
    return code;
  }
  return null;
}

export type WaitForInstagramContainerInput = {
  containerId: string;
  graphVersion: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  secrets?: Array<string | null | undefined>;
};

export async function waitForInstagramContainerReady(
  input: WaitForInstagramContainerInput,
): Promise<MetaGraphResult<{ status: InstagramContainerStatusCode }>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? defaultMetaSleep;
  const secrets = input.secrets ?? [input.accessToken];
  const statusUrl = buildMetaGraphUrl(
    "https://graph.instagram.com",
    input.graphVersion,
    `/${input.containerId}`,
  );

  let waitedMs = 0;
  for (let requestIndex = 0; requestIndex < INSTAGRAM_CONTAINER_POLL_MAX_REQUESTS; requestIndex += 1) {
    const url = `${statusUrl}?${new URLSearchParams({
      fields: "status_code",
      access_token: input.accessToken,
    }).toString()}`;
    const statusResult = await getMetaGraph<{ status_code?: string }>(url, secrets, fetchImpl);
    if (!statusResult.ok) {
      return statusResult;
    }

    const status = parseInstagramContainerStatusCode(statusResult.data);
    if (status === "FINISHED") {
      return { ok: true, data: { status } };
    }
    if (status === "ERROR") {
      return {
        ok: false,
        error:
          "meta_container_error: Instagram media container finished processing with an error.",
        errorCode: "meta_container_error",
        retryable: false,
      };
    }
    if (status === "EXPIRED") {
      return {
        ok: false,
        error: "meta_container_expired: Instagram media container expired before publish.",
        errorCode: "meta_container_expired",
        retryable: false,
      };
    }
    if (status === "IN_PROGRESS") {
      const isLastRequest = requestIndex >= INSTAGRAM_CONTAINER_POLL_MAX_REQUESTS - 1;
      if (isLastRequest) {
        return {
          ok: false,
          error:
            "meta_container_status_timeout: Instagram media container did not reach FINISHED before the polling limit.",
          errorCode: "meta_container_status_timeout",
          retryable: false,
        };
      }
      const delay = Math.min(
        INSTAGRAM_CONTAINER_POLL_INITIAL_DELAY_MS *
          INSTAGRAM_CONTAINER_POLL_BACKOFF_FACTOR ** requestIndex,
        INSTAGRAM_CONTAINER_POLL_MAX_DELAY_MS,
      );
      if (waitedMs + delay > INSTAGRAM_CONTAINER_POLL_MAX_WAIT_MS) {
        return {
          ok: false,
          error:
            "meta_container_status_timeout: Instagram media container did not reach FINISHED within the maximum wait time.",
          errorCode: "meta_container_status_timeout",
          retryable: false,
        };
      }
      await sleep(delay);
      waitedMs += delay;
      continue;
    }

    return {
      ok: false,
      error: `meta_container_status_unknown: Unexpected Instagram container status "${String(statusResult.data.status_code ?? "")}".`,
      errorCode: "meta_container_status_unknown",
      retryable: false,
    };
  }

  return {
    ok: false,
    error:
      "meta_container_status_timeout: Instagram media container did not reach FINISHED before the polling limit.",
    errorCode: "meta_container_status_timeout",
    retryable: false,
  };
}

export function buildMetaGraphUrl(host: string, version: string, path: string): string {
  const normalizedHost = host.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedHost}/${version}${normalizedPath}`;
}

export async function postMetaForm<T extends Record<string, unknown>>(
  url: string,
  fields: Record<string, string>,
  secrets: Array<string | null | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaGraphResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : "Network error", secrets);
    return {
      ok: false,
      error: `meta_http_error: ${message}`,
      errorCode: "meta_http_error",
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
        error: "meta_malformed_response: Meta returned a non-JSON body.",
        errorCode: "meta_malformed_response",
        retryable: false,
      };
    }
  }

  if (!response.ok) {
    const classified = classifyMetaHttpError(response.status, json, secrets);
    return { ok: false, ...classified };
  }

  if (!json || typeof json !== "object") {
    return {
      ok: false,
      error: "meta_malformed_response: Meta returned an empty or invalid JSON object.",
      errorCode: "meta_malformed_response",
      retryable: false,
    };
  }

  return { ok: true, data: json as T };
}

export async function getMetaGraph<T extends Record<string, unknown>>(
  url: string,
  secrets: Array<string | null | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaGraphResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET" });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : "Network error", secrets);
    return {
      ok: false,
      error: `meta_http_error: ${message}`,
      errorCode: "meta_http_error",
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
        error: "meta_malformed_response: Meta returned a non-JSON body.",
        errorCode: "meta_malformed_response",
        retryable: false,
      };
    }
  }

  if (!response.ok) {
    const classified = classifyMetaHttpError(response.status, json, secrets);
    return { ok: false, ...classified };
  }

  if (!json || typeof json !== "object") {
    return {
      ok: false,
      error: "meta_malformed_response: Meta returned an empty or invalid JSON object.",
      errorCode: "meta_malformed_response",
      retryable: false,
    };
  }

  return { ok: true, data: json as T };
}
