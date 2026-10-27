export type MarketingDispatcherSource = "admin" | "authenticated_cron" | "unknown";

export type CronAuthReason = "cron_secret" | "admin_session" | string;

/**
 * Conservative dispatcher source for heartbeat rows.
 *
 * Authorization is established by admin session or CRON_SECRET only.
 * Provider identity (QStash, Vercel Cron, GitHub Actions) is NOT inferred from
 * caller-supplied headers in Phase 1 — those are not cryptographically verified.
 */
export function resolveMarketingDispatcherSource(
  _request: Request,
  auth: { ok: boolean; reason: CronAuthReason },
): MarketingDispatcherSource {
  if (!auth.ok) {
    return "unknown";
  }
  if (auth.reason === "admin_session") {
    return "admin";
  }
  if (auth.reason === "cron_secret") {
    return "authenticated_cron";
  }
  return "unknown";
}
