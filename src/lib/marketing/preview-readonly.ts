/**
 * Server-only Preview read-only mode for temporary Content Queue review.
 *
 * Enabled only when BOTH are true:
 * - VERCEL_ENV === "preview" (set by Vercel; not client-controllable)
 * - MARKETING_PREVIEW_READONLY is "1" or "true" (project env; not client-controllable)
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

/** True only for explicitly configured Vercel Preview deployments. */
export function isMarketingPreviewReadonly(env: EnvLike = process.env): boolean {
  if (env.VERCEL_ENV !== "preview") return false;
  return truthyFlag(env.MARKETING_PREVIEW_READONLY);
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
