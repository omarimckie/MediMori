import { PLATFORM_LABELS } from "./config";
import { attributePurchases, loadPurchaseSnapshots } from "./attribution";
import type { MarketingStore } from "./store";

export async function buildWeeklyReport(store: MarketingStore, campaignId?: string) {
  const content = campaignId
    ? await store.listContent({ campaignId })
    : await store.listContent();
  const published = content.filter((item) => item.status === "published");
  const metrics = campaignId ? await store.listMetrics(campaignId) : await store.listMetrics();
  const operations = await store.listOperations();
  const clicks = await store.listClicks();
  const purchases = await loadPurchaseSnapshots();
  const attributed = await attributePurchases(store, purchases);
  const recommendations = await store.listRecommendations();

  const totals = metrics.reduce(
    (acc, item) => {
      acc.impressions += item.impressions;
      acc.engagements += item.engagements;
      acc.clicks += item.clicks;
      acc.emailOpens += item.emailOpens;
      acc.emailClicks += item.emailClicks;
      acc.websiteSessions += item.websiteSessions;
      acc.bookPageViews += item.bookPageViews;
      return acc;
    },
    {
      impressions: 0,
      engagements: 0,
      clicks: 0,
      emailOpens: 0,
      emailClicks: 0,
      websiteSessions: 0,
      bookPageViews: 0,
    },
  );

  const scored = published.map((item) => {
    const metric = metrics.find((entry) => entry.contentId === item.id);
    return {
      id: item.id,
      title: item.title ?? item.body.slice(0, 80),
      platform: PLATFORM_LABELS[item.platform],
      category: item.category,
      engagements: metric?.engagements ?? 0,
      clicks: metric?.clicks ?? clicks.filter((click) => click.contentId === item.id).length,
    };
  });

  const top = [...scored].sort((a, b) => b.engagements - a.engagements).slice(0, 3);
  const under = [...scored].sort((a, b) => a.engagements - b.engagements).slice(0, 3);
  const cost = operations.reduce((sum, item) => sum + item.estimatedCostUsd, 0);

  return {
    generatedAt: new Date().toISOString(),
    contentPublished: published.length,
    byPlatform: published.reduce<Record<string, number>>((acc, item) => {
      acc[item.platform] = (acc[item.platform] ?? 0) + 1;
      return acc;
    }, {}),
    totals,
    trackingClicks: clicks.length,
    purchases: {
      counted: purchases.length,
      directlyAttributed: attributed.filter((row) => row.kind === "directly_attributed").length,
      assisted: attributed.filter((row) => row.kind === "assisted").length,
      unattributed: attributed.filter((row) => row.kind === "unattributed").length,
    },
    topPerforming: top,
    underperforming: under,
    estimatedCostUsd: cost,
    recommendations: recommendations
      .filter((item) => item.status === "open")
      .map((item) => ({
        id: item.id,
        title: item.title,
        recommendation: item.recommendation,
        reason: item.reason,
        evidenceStrength: item.evidenceStrength,
        status: item.status,
      })),
    notes: [
      "Recommendations are suggestions. They do not change campaign strategy automatically.",
      "Purchase attribution never includes customer emails or payment details.",
      "Mock metrics are labeled as mock and should not be treated as live platform analytics.",
    ],
  };
}
