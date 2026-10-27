import type { MetaCredentialPlatform } from "./types";

/** Owner-approved expiring-soon horizon (days). */
export const CREDENTIAL_EXPIRING_SOON_DAYS = 7;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Scopes that indicate publishing may be possible — not exhaustive of every
 * Meta product surface. Absence from a probe response yields `unknown`, not
 * `insufficient`.
 */
export const FACEBOOK_PUBLISHING_SCOPE_HINTS = [
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_show_list",
] as const;

export const INSTAGRAM_PUBLISHING_SCOPE_HINTS = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_business_basic",
  "instagram_business_content_publish",
] as const;

export function publishingScopeHintsForPlatform(
  platform: MetaCredentialPlatform,
): readonly string[] {
  return platform === "facebook"
    ? FACEBOOK_PUBLISHING_SCOPE_HINTS
    : INSTAGRAM_PUBLISHING_SCOPE_HINTS;
}

/** Meta Graph rate-limit / transient error codes (publish + debug). */
export const META_TRANSIENT_ERROR_CODES = new Set([
  1, 2, 4, 17, 32, 80001, 80002,
]);
