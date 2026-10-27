import { formatMarketingScheduleDisplay } from "./marketing-scheduling";
import {
  classifyMarketingWeek,
  formatMarketingWeekTimingLabel,
  marketingUtcToday,
  type MarketingWeekTiming,
} from "./weekly-plan-dates";

export const CONTENT_BODY_EXCERPT_MAX = 220;

export const EMPTY_WEEK_MESSAGE =
  "No content has been added to this week yet.";

export type ContentWeekPlanOption = {
  id: string;
  weekStart: string;
};

function normalizeContentText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** First non-empty line of post body (trimmed), for title redundancy checks. */
export function firstMeaningfulBodyLine(body: string): string {
  const line = body.trim().split(/\n+/).find((part) => part.trim()) ?? "";
  return normalizeContentText(line);
}

/**
 * True when a stored title adds no information beyond the start of body
 * (e.g. Smart Upload title = first line of composed caption).
 */
export function isContentTitleRedundantWithBody(title: string | null, body: string): boolean {
  const normalizedTitle = normalizeContentText(title ?? "");
  if (!normalizedTitle) return true;
  const firstLine = firstMeaningfulBodyLine(body);
  if (!firstLine) return false;
  if (normalizedTitle === firstLine) return true;
  const bodyTrimmed = body.trim();
  if (bodyTrimmed.startsWith(normalizedTitle)) {
    const remainder = bodyTrimmed.slice(normalizedTitle.length);
    if (!remainder || /^\s/.test(remainder) || remainder.startsWith("\n")) {
      return true;
    }
  }
  return false;
}

/** Title to show as a heading, or null when redundant with body. */
export function contentDisplayTitle(title: string | null, body: string): string | null {
  if (isContentTitleRedundantWithBody(title, body)) return null;
  const normalizedTitle = normalizeContentText(title ?? "");
  return normalizedTitle || null;
}

export function contentBodyExcerpt(body: string, max = CONTENT_BODY_EXCERPT_MAX): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut =
    lastSpace > Math.floor(max * 0.5) ? slice.slice(0, lastSpace) : slice.trimEnd();
  return `${cut.trimEnd()}…`;
}

export function shouldShowScheduledPublishOnWeekCard(
  item: { status: string; scheduledFor: string | null },
  publicationStatus: string | undefined,
): boolean {
  const isScheduled = item.status === "scheduled" || publicationStatus === "scheduled";
  return isScheduled && Boolean(item.scheduledFor?.trim());
}

export function formatScheduledPublishLabel(scheduledFor: string, timeZone: string): string {
  return `Publishes: ${formatMarketingScheduleDisplay(scheduledFor, timeZone)}`;
}

export function formatContentWeekLabel(
  weeklyPlanId: string | null,
  plans: ContentWeekPlanOption[],
): { label: string; weekStart: string | null } {
  if (!weeklyPlanId) {
    return { label: "Unassigned", weekStart: null };
  }
  const plan = plans.find((row) => row.id === weeklyPlanId);
  if (!plan) {
    return { label: "Assigned (plan not in list)", weekStart: null };
  }
  return { label: `Week of ${plan.weekStart}`, weekStart: plan.weekStart };
}

export function formatContentCreatedAt(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function weekPlanTiming(
  weekStart: string,
  today = marketingUtcToday(),
): MarketingWeekTiming {
  return classifyMarketingWeek(weekStart, today);
}

export function formatWeekPlanSelectorLabel(
  weekStart: string,
  today = marketingUtcToday(),
): string {
  const timing = weekPlanTiming(weekStart, today);
  return `Week of ${weekStart} (${formatMarketingWeekTimingLabel(timing)})`;
}

/**
 * Prefer current or nearest upcoming week for assignment defaults.
 * Falls back to newest plan when only historical weeks exist.
 */
export function pickOperationalWeeklyPlanId(
  plans: ContentWeekPlanOption[],
  today = marketingUtcToday(),
): string | null {
  if (!plans.length) return null;

  const ranked = plans.map((plan) => ({
    ...plan,
    timing: classifyMarketingWeek(plan.weekStart, today),
  }));

  const current = ranked
    .filter((plan) => plan.timing === "current")
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  if (current[0]) return current[0].id;

  const upcoming = ranked
    .filter((plan) => plan.timing === "upcoming")
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (upcoming[0]) return upcoming[0].id;

  return plans[0]?.id ?? null;
}

export function resolveWeeklyPlanSelection(
  plans: ContentWeekPlanOption[],
  options: { preferredPlanId?: string | null; currentSelectedId?: string | null },
): string | null {
  const planIds = new Set(plans.map((plan) => plan.id));
  if (options.preferredPlanId && planIds.has(options.preferredPlanId)) {
    return options.preferredPlanId;
  }
  if (options.currentSelectedId && planIds.has(options.currentSelectedId)) {
    return options.currentSelectedId;
  }
  return pickOperationalWeeklyPlanId(plans);
}
