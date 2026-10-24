import { getMarketingTimezone } from "../config";
import type { MarketingStore } from "../store";
import { normalizeMarketingNotificationDestination } from "../notifications/destination";
import { calendarDayInTimezone, previousCalendarDayKey } from "./analytics-time";
import type { MarketingNotificationPayload } from "../notifications/types";
import { buildMarketingAnalyticsDashboard } from "./analytics-aggregation";

export type PriorDayAnalyticsSummary = {
  timezone: string;
  dayKey: string;
  headline: string;
  lines: string[];
  measuredOnly: boolean;
};

/**
 * Read-only prior-calendar-day rollup for morning brief / web push copy.
 * Does not send notifications.
 */
export async function buildPriorDayAnalyticsSummary(
  store: MarketingStore,
  now = new Date(),
): Promise<PriorDayAnalyticsSummary> {
  const timezone = getMarketingTimezone();
  const todayKey = calendarDayInTimezone(now, timezone);
  const yesterdayKey = previousCalendarDayKey(todayKey);
  const [y, m, d] = yesterdayKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dashboard = await buildMarketingAnalyticsDashboard({
    store,
    window: "day",
    anchor,
  });

  const lines: string[] = [];
  if (dashboard.measured.trackedLinkClicks > 0) {
    lines.push(`${dashboard.measured.trackedLinkClicks} tracked marketing link click(s)`);
  }
  if (dashboard.measured.postsPublished > 0) {
    lines.push(`${dashboard.measured.postsPublished} post(s) published`);
  }
  if (dashboard.measured.resourceDownloads > 0) {
    lines.push(`${dashboard.measured.resourceDownloads} resource download(s)`);
  }
  if (
    dashboard.conversions.source === "measured" &&
    dashboard.conversions.purchasesInPeriod > 0
  ) {
    lines.push(
      `${dashboard.conversions.purchasesInPeriod} purchase(s) (${dashboard.conversions.directlyAttributedInPeriod} directly attributed)`,
    );
  }
  if (dashboard.measured.publicationFailures > 0) {
    lines.push(`${dashboard.measured.publicationFailures} publication failure(s)`);
  }
  if (!lines.length) {
    lines.push("No measured marketing activity recorded");
  }

  const headline = `Analytics summary · ${yesterdayKey}`;

  return {
    timezone,
    dayKey: yesterdayKey,
    headline,
    lines,
    measuredOnly: true,
  };
}

export function formatPriorDayAnalyticsSummaryBlock(summary: PriorDayAnalyticsSummary): string {
  return [
    "Measured analytics (prior day)",
    ...summary.lines.map((line) => `• ${line}`),
    "• Meta/Pinterest Insights not included",
  ].join("\n");
}

/** Payload for authorized push infrastructure; caller must not auto-send in dev without approval. */
export function buildPriorDayAnalyticsNotificationPayload(
  summary: PriorDayAnalyticsSummary,
): MarketingNotificationPayload {
  return {
    type: "morning_brief",
    severity: "info",
    title: summary.headline,
    body: formatPriorDayAnalyticsSummaryBlock(summary),
    destination: normalizeMarketingNotificationDestination("/admin/marketing/analytics"),
  };
}
