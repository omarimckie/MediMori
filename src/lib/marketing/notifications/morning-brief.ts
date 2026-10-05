import { loadPurchaseSnapshots } from "../attribution";
import { getMarketingTimezone } from "../config";
import type { MarketingStore } from "../store";
import { normalizeMarketingNotificationDestination } from "./destination";
import type { MarketingNotificationPayload } from "./types";

export type MorningBriefMetricLine = {
  label: string;
  value: number;
  source: "publications" | "clicks" | "purchases" | "events" | "content";
};

export type MorningMarketingBrief = {
  timezone: string;
  yesterday: MorningBriefMetricLine[];
  today: MorningBriefMetricLine[];
  needsAttention: string[];
  excludedSyntheticMetrics: string[];
  payload: MarketingNotificationPayload;
};

function isoDayKey(iso: string, timeZone: string): string {
  return calendarDayInTimezone(new Date(iso), timeZone);
}

export function calendarDayInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

function previousCalendarDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const yy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(prev.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export async function buildMorningMarketingBrief(
  store: MarketingStore,
  now = new Date(),
): Promise<MorningMarketingBrief> {
  const timezone = getMarketingTimezone();
  const todayKey = calendarDayInTimezone(now, timezone);
  const yesterdayKey = previousCalendarDayKey(todayKey);

  const publications = await store.listPublications();
  const publishedYesterday = publications.filter(
    (row) =>
      row.status === "published" &&
      row.publishedAt &&
      isoDayKey(row.publishedAt, timezone) === yesterdayKey,
  ).length;

  const failedYesterday = publications.filter(
    (row) =>
      row.status === "failed" &&
      row.updatedAt &&
      isoDayKey(row.updatedAt, timezone) === yesterdayKey,
  ).length;

  const scheduledToday = publications.filter(
    (row) =>
      row.status === "scheduled" &&
      row.scheduledFor &&
      isoDayKey(row.scheduledFor, timezone) === todayKey,
  ).length;

  const clicks = await store.listClicks();
  const clicksYesterday = clicks.filter(
    (row) => isoDayKey(row.clickedAt, timezone) === yesterdayKey,
  ).length;

  const purchases = await loadPurchaseSnapshots();
  const purchasesYesterday = purchases.filter(
    (row) => isoDayKey(row.purchasedAt, timezone) === yesterdayKey,
  ).length;

  const events = await store.listEvents();
  const downloadsYesterday = events.filter(
    (row) =>
      row.name === "resource_downloaded" &&
      isoDayKey(row.createdAt, timezone) === yesterdayKey,
  ).length;

  const yesterdayLines: MorningBriefMetricLine[] = [];
  if (publishedYesterday > 0) {
    yesterdayLines.push({
      label: "posts published",
      value: publishedYesterday,
      source: "publications",
    });
  }
  if (failedYesterday > 0) {
    yesterdayLines.push({
      label: "publication failures",
      value: failedYesterday,
      source: "publications",
    });
  }
  if (clicksYesterday > 0) {
    yesterdayLines.push({
      label: "tracked marketing clicks",
      value: clicksYesterday,
      source: "clicks",
    });
  }
  if (purchasesYesterday > 0) {
    yesterdayLines.push({
      label: "purchases",
      value: purchasesYesterday,
      source: "purchases",
    });
  }
  if (downloadsYesterday > 0) {
    yesterdayLines.push({
      label: "resource downloads",
      value: downloadsYesterday,
      source: "events",
    });
  }

  const todayLines: MorningBriefMetricLine[] = [];
  if (scheduledToday > 0) {
    todayLines.push({
      label: "posts scheduled",
      value: scheduledToday,
      source: "publications",
    });
  }

  const needsAttention: string[] = [];
  if (failedYesterday > 0) {
    needsAttention.push(`${failedYesterday} publication failure(s) yesterday`);
  }
  if (!needsAttention.length) {
    needsAttention.push("None");
  }

  const excludedSyntheticMetrics = [
    "marketing_metrics impressions/engagements (often mock-derived)",
    "website sessions / book page views from recordMockMetrics",
    "Meta Insights (not ingested)",
    "website behavioral analytics (not implemented)",
  ];

  const bodyLines = [
    "Twilight Feather — Morning Brief",
    "",
    "Yesterday",
    ...(yesterdayLines.length
      ? yesterdayLines.map((line) => `• ${line.value} ${line.label}`)
      : ["• No recorded activity"]),
    "",
    "Today",
    ...(todayLines.length
      ? todayLines.map((line) => `• ${line.value} ${line.label}`)
      : ["• No posts scheduled"]),
    "",
    "Needs attention",
    ...needsAttention.map((line) => `• ${line}`),
  ];

  const payload: MarketingNotificationPayload = {
    type: "morning_brief",
    severity: failedYesterday > 0 ? "warning" : "info",
    title: "Twilight Feather — Morning Brief",
    body: bodyLines.join("\n"),
    destination: normalizeMarketingNotificationDestination("/admin/marketing"),
  };

  return {
    timezone,
    yesterday: yesterdayLines,
    today: todayLines,
    needsAttention,
    excludedSyntheticMetrics,
    payload,
  };
}
