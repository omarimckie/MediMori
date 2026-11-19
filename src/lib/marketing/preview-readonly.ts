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

export const MARKETING_PREVIEW_READONLY_FALSE_VALUES = ["false", "0", "no"] as const;
export const MARKETING_PREVIEW_READONLY_TRUE_VALUES = ["true", "1", "yes"] as const;

export function normalizeMarketingPreviewReadonlyFlag(
  value: string | undefined,
): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.toLowerCase();
}

export function isMarketingPreviewReadonlyExplicitlyDisabled(env: EnvLike = process.env): boolean {
  const normalized = normalizeMarketingPreviewReadonlyFlag(env.MARKETING_PREVIEW_READONLY);
  if (normalized === null) return false;
  return (MARKETING_PREVIEW_READONLY_FALSE_VALUES as readonly string[]).includes(normalized);
}

export function isMarketingPreviewReadonlyExplicitlyEnabled(env: EnvLike = process.env): boolean {
  const normalized = normalizeMarketingPreviewReadonlyFlag(env.MARKETING_PREVIEW_READONLY);
  if (normalized === null) return false;
  return (MARKETING_PREVIEW_READONLY_TRUE_VALUES as readonly string[]).includes(normalized);
}

export function isMarketingPreviewReadonlyConfigured(env: EnvLike = process.env): boolean {
  return normalizeMarketingPreviewReadonlyFlag(env.MARKETING_PREVIEW_READONLY) !== null;
}

/**
 * True on Vercel Preview unless MARKETING_PREVIEW_READONLY is an explicit supported disable value.
 * Missing, empty, typo, or other unrecognized values fail closed (read-only enabled).
 */
export function isMarketingPreviewReadonly(env: EnvLike = process.env): boolean {
  if (env.VERCEL_ENV !== "preview") return false;
  if (isMarketingPreviewReadonlyExplicitlyDisabled(env)) return false;
  if (isMarketingPreviewReadonlyExplicitlyEnabled(env)) return true;
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
