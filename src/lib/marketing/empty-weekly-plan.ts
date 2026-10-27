import { getChannelQuotas } from "./planner";
import type { MarketingStore } from "./store";
import type { WeeklyPlan } from "./types";
import {
  normalizeToWeekMonday,
  parseMarketingDateOnly,
  WeeklyPlanDateError,
} from "./weekly-plan-dates";

export type CreateEmptyWeeklyPlanInput = {
  weekStart: string;
  campaignId?: null;
};

export type CreateEmptyWeeklyPlanResult = {
  plan: WeeklyPlan;
  created: boolean;
  normalizedWeekStart: string;
};

export async function createEmptyWeeklyPlan(
  store: MarketingStore,
  input: CreateEmptyWeeklyPlanInput,
): Promise<CreateEmptyWeeklyPlanResult> {
  if (input.campaignId !== undefined && input.campaignId !== null) {
    throw new WeeklyPlanDateError("Empty operational weeks must not be tied to a campaign.");
  }

  const parsed = parseMarketingDateOnly(input.weekStart);
  const normalizedWeekStart = normalizeToWeekMonday(parsed);

  const existing = await store.findCampaignlessWeeklyPlan(normalizedWeekStart);
  if (existing) {
    return { plan: existing, created: false, normalizedWeekStart };
  }

  const quotas = await getChannelQuotas(store);
  const plan = await store.createWeeklyPlan({
    id: crypto.randomUUID(),
    campaignId: null,
    weekStart: normalizedWeekStart,
    status: "draft",
    summary: {
      itemCount: 0,
      newAssetCount: 0,
      warningCount: 0,
      objective: "Planning week",
      audience: "—",
      quotas,
    },
    rationale: { kind: "empty_operational_week" },
    isDemo: false,
  });

  return { plan, created: true, normalizedWeekStart };
}
