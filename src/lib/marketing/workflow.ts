import { estimatedAiCostUsd, getAIProvider } from "./ai";
import {
  approveAll,
  approveContent,
  editContent,
  publishDue,
  regenerateItem,
  rejectAll,
  rejectContent,
  scheduleApproved,
} from "./approval";
import { ensureCatalogAssets } from "./assets";
import { recordMockMetrics } from "./attribution";
import { allowMarketingDemoSeed, isMockMode } from "./config";
import { generateWeeklyContent } from "./content-engine";
import { logMarketing } from "./logger";
import { buildWeeklyPlan, createCampaignFromObjective, getChannelQuotas } from "./planner";
import { generateRecommendations } from "./recommendations";
import { buildWeeklyReport } from "./report";
import type { MarketingStore } from "./store";
import type { MarketingCampaign } from "./types";

export async function createCampaignWorkflow(
  store: MarketingStore,
  objective: string,
  actor?: string | null,
) {
  const started = Date.now();
  const provider = getAIProvider();
  await provider.generateStructuredOutput({
    task: "campaign_strategy",
    complexity: "complex",
    prompt: objective,
    cacheKey: `campaign:${objective.toLowerCase()}`,
    fallback: { used: "deterministic_planner" },
  });
  const campaign = await createCampaignFromObjective(store, { objective, actor });
  await store.logOperation({
    id: crypto.randomUUID(),
    operation: "create_campaign",
    provider: provider.id,
    modelOrService: "complex",
    estimatedCostUsd: estimatedAiCostUsd("complex"),
    campaignId: campaign.id,
    contentId: null,
    success: true,
    durationMs: Date.now() - started,
    metadata: { mock: isMockMode() },
  });
  logMarketing({
    operation: "create_campaign",
    campaignId: campaign.id,
    provider: provider.id,
    success: true,
    durationMs: Date.now() - started,
    estimatedCostUsd: estimatedAiCostUsd("complex"),
  });
  return campaign;
}

export async function generateWeekWorkflow(
  store: MarketingStore,
  campaignId: string,
) {
  const campaign = await store.getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found.");
  await ensureCatalogAssets(store);
  const plan = await buildWeeklyPlan(store, campaign);
  const quotas = await getChannelQuotas(store);
  const started = Date.now();
  const content = await generateWeeklyContent(store, campaign, plan, quotas);
  await store.logOperation({
    id: crypto.randomUUID(),
    operation: "generate_weekly_package",
    provider: getAIProvider().id,
    modelOrService: "deterministic+simple",
    estimatedCostUsd: isMockMode() ? 0 : estimatedAiCostUsd("simple") * 0.2,
    campaignId,
    contentId: null,
    success: true,
    durationMs: Date.now() - started,
    metadata: { itemCount: content.length, mock: isMockMode() },
  });
  const ready = (await store.getWeeklyPlan(plan.id)) ?? plan;
  return { campaign, plan: ready, content };
}

export async function overview(store: MarketingStore) {
  const campaigns = await store.listCampaigns();
  const content = await store.listContent();
  const plans = await store.listWeeklyPlans();
  const operations = await store.listOperations();
  const recommendations = await store.listRecommendations();
  const assets = await store.listAssets();
  const current =
    campaigns.find((item) => item.status === "active") ?? campaigns[0] ?? null;
  const readyPlan =
    plans.find((plan) => plan.status === "ready" || plan.status === "draft") ?? plans[0] ?? null;
  return {
    mockMode: isMockMode(),
    allowDemoSeed: allowMarketingDemoSeed(),
    currentCampaign: current,
    readyPlan,
    counts: {
      needsReview: content.filter((item) => item.status === "needs_review").length,
      scheduled: content.filter((item) => item.status === "scheduled").length,
      published: content.filter((item) => item.status === "published").length,
      rejected: content.filter((item) => item.status === "rejected").length,
      assets: assets.filter((item) => item.approved).length,
      openRecommendations: recommendations.filter((item) => item.status === "open").length,
    },
    estimatedCostUsd: operations.reduce((sum, item) => sum + item.estimatedCostUsd, 0),
    recentContent: content.slice(0, 8),
  };
}

export async function runApprovalAction(
  store: MarketingStore,
  input: {
    action: "approve" | "reject" | "edit" | "regenerate" | "approve_all" | "reject_all" | "schedule" | "publish_due";
    contentId?: string;
    weeklyPlanId?: string;
    body?: string;
    feedback?: string;
    actor?: string | null;
  },
) {
  switch (input.action) {
    case "approve":
      if (!input.contentId) throw new Error("contentId required");
      return approveContent(store, input.contentId, input.actor ?? null, input.feedback);
    case "reject":
      if (!input.contentId) throw new Error("contentId required");
      return rejectContent(store, input.contentId, input.actor ?? null, input.feedback);
    case "edit":
      if (!input.contentId || !input.body) throw new Error("contentId and body required");
      return editContent(store, input.contentId, input.body, input.actor ?? null);
    case "regenerate":
      if (!input.contentId) throw new Error("contentId required");
      return regenerateItem(store, input.contentId, input.actor ?? null);
    case "approve_all":
      if (!input.weeklyPlanId) throw new Error("weeklyPlanId required");
      return approveAll(store, input.weeklyPlanId, input.actor ?? null);
    case "reject_all":
      if (!input.weeklyPlanId) throw new Error("weeklyPlanId required");
      return rejectAll(store, input.weeklyPlanId, input.actor ?? null, input.feedback);
    case "schedule":
      if (!input.contentId) throw new Error("contentId required");
      return scheduleApproved(store, input.contentId);
    case "publish_due":
      return publishDue(store);
    default:
      throw new Error("Unknown action");
  }
}

export async function afterPublishRefresh(store: MarketingStore, campaign: MarketingCampaign) {
  await recordMockMetrics(store, campaign.id);
  await generateRecommendations(store, campaign.id);
  return buildWeeklyReport(store, campaign.id);
}
