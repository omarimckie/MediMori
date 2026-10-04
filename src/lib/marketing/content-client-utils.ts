export const CONTENT_BODY_EXCERPT_MAX = 220;

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
