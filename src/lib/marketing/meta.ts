export type MetaErrorCode =
  | "meta_credentials_missing"
  | "meta_auth_expired"
  | "meta_permissions"
  | "meta_http_error"
  | "meta_malformed_response"
  | "meta_image_missing"
  | "meta_image_inaccessible"
  | "meta_invalid_image_aspect_ratio"
  | "meta_already_published";

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
  return {
    error: `meta_http_error: ${message}`,
    errorCode: "meta_http_error",
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
