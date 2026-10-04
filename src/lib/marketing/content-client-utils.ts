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

export function contentBodyExcerpt(body: string, max = CONTENT_BODY_EXCERPT_MAX): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
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
