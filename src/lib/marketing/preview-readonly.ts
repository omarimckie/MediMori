/**
 * Server-only Preview read-only mode for temporary Content Queue review.
 *
 * On Vercel Preview (VERCEL_ENV === "preview"):
 * - Default: marketing mutations are read-only when MARKETING_PREVIEW_READONLY is unset.
 * - Explicit false/0/no disables read-only for authorized write windows only.
 *
 * Never active in Production, even if the flag is mis-set.
 */

export type EnvLike = Record<string, string | undefined>;

export const MARKETING_PREVIEW_READONLY_MESSAGE =
  "Preview is in read-only mode. Marketing mutations are disabled.";

export class MarketingPreviewReadonlyError extends Error {
  readonly status = 403;

  constructor(message = MARKETING_PREVIEW_READONLY_MESSAGE) {
    super(message);
    this.name = "MarketingPreviewReadonlyError";
  }
}

function truthyFlag(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase();
  return trimmed === "1" || trimmed === "true" || trimmed === "yes";
}

export function isMarketingPreviewReadonlyExplicitlyDisabled(env: EnvLike = process.env): boolean {
  const trimmed = env.MARKETING_PREVIEW_READONLY?.trim().toLowerCase();
  return trimmed === "false" || trimmed === "0" || trimmed === "no";
}

export function isMarketingPreviewReadonlyConfigured(env: EnvLike = process.env): boolean {
  const trimmed = env.MARKETING_PREVIEW_READONLY?.trim();
  return Boolean(trimmed);
}

/** True on Vercel Preview unless MARKETING_PREVIEW_READONLY is explicitly disabled. */
export function isMarketingPreviewReadonly(env: EnvLike = process.env): boolean {
  if (env.VERCEL_ENV !== "preview") return false;
  if (isMarketingPreviewReadonlyExplicitlyDisabled(env)) return false;
  if (isMarketingPreviewReadonlyConfigured(env)) {
    return truthyFlag(env.MARKETING_PREVIEW_READONLY);
  }
  return true;
}

/**
 * Paths/methods blocked when Preview read-only is active.
 * GET/HEAD on Content Queue, settings, and admin images remain allowed.
 * Login/logout live outside /api/admin/marketing and are not blocked here.
 */
export function isMarketingPreviewReadonlyMutationRequest(
  pathname: string,
  method: string,
): boolean {
  const normalizedMethod = method.toUpperCase();
  const path = pathname.split("?")[0] ?? pathname;

  if (path === "/api/cron/marketing-publish" || path === "/api/cron/marketing-reliability") {
    // These handlers treat GET as a publish/sweep trigger.
    return (
      normalizedMethod === "GET" ||
      normalizedMethod === "POST" ||
      normalizedMethod === "PUT" ||
      normalizedMethod === "PATCH" ||
      normalizedMethod === "DELETE"
    );
  }

  if (normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS") {
    return false;
  }

  if (path.startsWith("/api/admin/marketing/")) {
    return true;
  }

  return false;
}

export function assertMarketingPreviewAllowsMutations(env: EnvLike = process.env): void {
  if (isMarketingPreviewReadonly(env)) {
    throw new MarketingPreviewReadonlyError();
  }
}
