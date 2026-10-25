import { attributePurchases, loadPurchaseSnapshotsWithStatus } from "../attribution";
import { isApprovedMarketingDestinationPath } from "../marketing-website-destination";
import { isMockMode, PLATFORM_LABELS } from "../config";
import { isPinterestLiveConfigured } from "../pinterest";
import type { MarketingStore } from "../store";
import type { MarketingClick, MarketingContent, MarketingMetric, Platform } from "../types";
import type { MeasuredAttributionDimensions } from "./analytics-contracts";
import {
  MARKETING_ANALYTICS_PRIVACY_NOTE,
  sanitizeAttributionRows,
} from "./analytics-privacy";
import {
  ANALYTICS_MAX_ATTRIBUTION_SAMPLE,
  ANALYTICS_MAX_CAMPAIGN_ATTRIBUTION_ROWS,
  ANALYTICS_MAX_POST_PERFORMANCE_ROWS,
  ANALYTICS_MAX_VISITED_PAGES,
} from "./analytics-limits";
import {
  eventDayKey,
  isDayKeyInPeriod,
  resolveAnalyticsReportingPeriod,
  type AnalyticsReportingPeriod,
  type AnalyticsReportingWindow,
} from "./analytics-time";

export type AnalyticsSourceKind = "measured" | "derived" | "synthetic_mock" | "unavailable";

export type AnalyticsConnectionStatus = {
  id: string;
  label: string;
  status: "connected" | "partial" | "unavailable";
  detail: string;
};

export type MarketingAnalyticsDashboard = {
  generatedAt: string;
  timezone: string;
  window: AnalyticsReportingWindow;
  period: AnalyticsReportingPeriod;
  freshness: {
    latestClickAt: string | null;
    latestEventAt: string | null;
    latestMetricAt: string | null;
    purchasesSnapshotLoaded: boolean;
  };
  connections: AnalyticsConnectionStatus[];
  measured: {
    trackedLinkClicks: number;
    uniqueDestinationPaths: number;
    resourceDownloads: number;
    postsPublished: number;
    publicationFailures: number;
  };
  conversions: {
    purchasesInPeriod: number;
    directlyAttributedInPeriod: number;
    assistedInPeriod: number;
    source: AnalyticsSourceKind;
  };
  platformAttribution: Array<{
    platform: string;
    trackedClicks: number;
    postsPublished: number;
    source: AnalyticsSourceKind;
  }>;
  campaignAttribution: Array<{
    campaignId: string;
    trackedClicks: number;
    postsPublished: number;
    source: AnalyticsSourceKind;
  }>;
  visitedPages: Array<{
    destinationPath: string;
    trackedClicks: number;
    source: AnalyticsSourceKind;
  }>;
  postPerformance: Array<{
    contentId: string;
    title: string;
    platform: string;
    category: string;
    status: string;
    trackedClicks: number;
    publishedInPeriod: boolean;
    platformEngagements: number | null;
    platformImpressions: number | null;
    engagementSource: AnalyticsSourceKind;
  }>;
  socialEngagement: {
    facebook: { impressions: number | null; engagements: number | null; source: AnalyticsSourceKind };
    instagram: { impressions: number | null; engagements: number | null; source: AnalyticsSourceKind };
    pinterest: { impressions: number | null; engagements: number | null; source: AnalyticsSourceKind };
  };
  syntheticMetricsRollup: {
    included: boolean;
    impressions: number;
    engagements: number;
    clicks: number;
    websiteSessions: number;
    bookPageViews: number;
    note: string;
  };
  attributionSample: ReturnType<typeof sanitizeAttributionRows>;
  partialDataWarnings: string[];
  privacyNote: string;
  resultLimits: {
    postPerformanceTruncated: boolean;
    visitedPagesTruncated: boolean;
    campaignAttributionTruncated: boolean;
  };
};

function latestIso(rows: Array<{ at: string }>): string | null {
  if (!rows.length) return null;
  return rows.reduce((max, row) => (row.at > max ? row.at : max), rows[0].at);
}

function clickDimensions(
  click: MarketingClick,
  contentById: Map<string, MarketingContent>,
): MeasuredAttributionDimensions {
  const content = click.contentId ? contentById.get(click.contentId) : undefined;
  return {
    platform: content?.platform ?? null,
    campaignId: click.campaignId ?? content?.campaignId ?? null,
    contentId: click.contentId,
    destinationPath: click.destinationPath,
  };
}

function metricsForPlatform(
  metrics: MarketingMetric[],
  platform: Platform,
  period: AnalyticsReportingPeriod,
): { impressions: number; engagements: number; hasPlatformSource: boolean; hasMockOnly: boolean } {
  const inPeriod = metrics.filter(
    (row) =>
      row.platform === platform && period.dayKeys.includes(row.metricDate.slice(0, 10)),
  );
  let impressions = 0;
  let engagements = 0;
  let hasPlatformSource = false;
  let hasMockOnly = false;
  for (const row of inPeriod) {
    if (row.source === "platform") {
      hasPlatformSource = true;
      impressions += row.impressions;
      engagements += row.engagements;
    } else if (row.source === "mock") {
      hasMockOnly = true;
    }
  }
  return { impressions, engagements, hasPlatformSource, hasMockOnly };
}

export type BuildMarketingAnalyticsDashboardInput = {
  store: MarketingStore;
  window?: AnalyticsReportingWindow;
  anchor?: Date;
};

export async function buildMarketingAnalyticsDashboard(
  input: BuildMarketingAnalyticsDashboardInput,
): Promise<MarketingAnalyticsDashboard> {
  const window = input.window ?? "week";
  const period = resolveAnalyticsReportingPeriod(window, input.anchor);
  const partialDataWarnings: string[] = [];

  const [metrics, events, clicks, content, publications, purchaseLoad] = await Promise.all([
    input.store.listMetrics(),
    input.store.listEvents(),
    input.store.listClicks(),
    input.store.listContent(),
    input.store.listPublications(),
    loadPurchaseSnapshotsWithStatus(),
  ]);
  const purchases = purchaseLoad.snapshots;

  const contentById = new Map(content.map((item) => [item.id, item]));
  const purchasesStoreReachable = purchaseLoad.storeReachable;

  const clicksInPeriod = clicks.filter((row) =>
    isDayKeyInPeriod(eventDayKey(row.clickedAt, period.timezone), period),
  );
  const eventsInPeriod = events.filter((row) =>
    isDayKeyInPeriod(eventDayKey(row.createdAt, period.timezone), period),
  );

  const resourceDownloads = eventsInPeriod.filter((row) => row.name === "resource_downloaded").length;

  const publishedInPeriod = publications.filter(
    (row) =>
      row.status === "published" &&
      row.publishedAt &&
      isDayKeyInPeriod(eventDayKey(row.publishedAt, period.timezone), period),
  );
  const failedInPeriod = publications.filter(
    (row) =>
      row.status === "failed" &&
      isDayKeyInPeriod(eventDayKey(row.updatedAt, period.timezone), period),
  );

  const platformClicks = new Map<string, number>();
  const campaignClicks = new Map<string, number>();
  const pageClicks = new Map<string, number>();
  const contentClicks = new Map<string, number>();

  let invalidDestinationClicks = 0;
  for (const click of clicksInPeriod) {
    const dims = clickDimensions(click, contentById);
    if (!isApprovedMarketingDestinationPath(dims.destinationPath)) {
      invalidDestinationClicks += 1;
    }
    const platformKey = dims.platform ?? "unknown";
    platformClicks.set(platformKey, (platformClicks.get(platformKey) ?? 0) + 1);
    if (dims.campaignId) {
      campaignClicks.set(dims.campaignId, (campaignClicks.get(dims.campaignId) ?? 0) + 1);
    }
    pageClicks.set(dims.destinationPath, (pageClicks.get(dims.destinationPath) ?? 0) + 1);
    if (dims.contentId) {
      contentClicks.set(dims.contentId, (contentClicks.get(dims.contentId) ?? 0) + 1);
    }
  }
  if (invalidDestinationClicks > 0) {
    partialDataWarnings.push(
      `${invalidDestinationClicks} tracked click(s) in this period used a destination path outside the approved on-site allowlist (legacy or misconfigured content).`,
    );
  }

  const attributed = await attributePurchases(input.store, purchases);
  const purchasesInPeriod = purchases.filter((row) =>
    isDayKeyInPeriod(eventDayKey(row.purchasedAt, period.timezone), period),
  );
  const attributedInPeriod = attributed.filter((row) =>
    purchasesInPeriod.some((p) => p.id === row.purchaseId),
  );

  const mockMetricsInPeriod = metrics.filter(
    (row) => row.source === "mock" && period.dayKeys.includes(row.metricDate.slice(0, 10)),
  );
  const platformMetricsExist = metrics.some((row) => row.source === "platform");
  const syntheticRollup = mockMetricsInPeriod.reduce(
    (acc, row) => {
      acc.impressions += row.impressions;
      acc.engagements += row.engagements;
      acc.clicks += row.clicks;
      acc.websiteSessions += row.websiteSessions;
      acc.bookPageViews += row.bookPageViews;
      return acc;
    },
    { impressions: 0, engagements: 0, clicks: 0, websiteSessions: 0, bookPageViews: 0 },
  );

  if (mockMetricsInPeriod.length && !platformMetricsExist) {
    partialDataWarnings.push(
      "Stored marketing_metrics rows include mock-derived impressions/engagements. Those totals are shown separately and are not live Meta or Pinterest Insights.",
    );
  }
  if (!clicksInPeriod.length && clicks.length) {
    partialDataWarnings.push("No tracked link clicks in this period (other periods have data).");
  }
  if (!purchasesStoreReachable) {
    partialDataWarnings.push(
      "Purchase conversion counts are unavailable when the purchases table cannot be read.",
    );
  } else if (!purchases.length) {
    partialDataWarnings.push(
      "Purchases table is reachable but returned no rows in the analytics snapshot (empty or outside the 200-row window).",
    );
  }

  const measuredActivity =
    clicksInPeriod.length +
    resourceDownloads +
    publishedInPeriod.length +
    failedInPeriod.length +
    purchasesInPeriod.length;
  if (measuredActivity === 0) {
    partialDataWarnings.push("No measured marketing activity in this reporting window.");
  }

  const socialEngagementFor = (platform: Platform) => {
    const stats = metricsForPlatform(metrics, platform, period);
    if (stats.hasPlatformSource) {
      return {
        impressions: stats.impressions,
        engagements: stats.engagements,
        source: "measured" as AnalyticsSourceKind,
      };
    }
    if (stats.hasMockOnly) {
      return {
        impressions: null,
        engagements: null,
        source: "unavailable" as AnalyticsSourceKind,
      };
    }
    return {
      impressions: null,
      engagements: null,
      source: "unavailable" as AnalyticsSourceKind,
    };
  };

  const connections: AnalyticsConnectionStatus[] = [
    {
      id: "tracked_links",
      label: "Tracked social links (/api/m)",
      status: "connected",
      detail: "Clicks are measured when visitors use marketing tracking URLs.",
    },
    {
      id: "meta_insights",
      label: "Facebook / Instagram Insights",
      status: "unavailable",
      detail: "Live reach, saves, and engagement from Meta are not ingested into this dashboard.",
    },
    {
      id: "pinterest_insights",
      label: "Pinterest Analytics API",
      status: isPinterestLiveConfigured() ? "partial" : "unavailable",
      detail: isPinterestLiveConfigured()
        ? "Pinterest publishing is configured; pin analytics are not ingested yet."
        : "Pinterest live credentials are not configured.",
    },
    {
      id: "purchases",
      label: "Site purchases (attribution)",
      status: purchasesStoreReachable ? "connected" : "unavailable",
      detail: purchasesStoreReachable
        ? "Book purchases are counted without exposing customer identifiers."
        : "Purchases table could not be queried in this environment.",
    },
    {
      id: "site_analytics",
      label: "Full-site behavioral analytics",
      status: "unavailable",
      detail: "Only marketing-tracked landings and resource download events are measured here.",
    },
  ];

  const publishedContentIds = new Set(publishedInPeriod.map((row) => row.contentId));

  const postPerformance = content
    .filter((item) => contentClicks.has(item.id) || publishedContentIds.has(item.id))
    .map((item) => {
      const platformMetric = metrics.filter(
        (m) =>
          m.contentId === item.id &&
          period.dayKeys.includes(m.metricDate.slice(0, 10)) &&
          m.source === "platform",
      );
      const mockMetric = metrics.filter(
        (m) =>
          m.contentId === item.id &&
          period.dayKeys.includes(m.metricDate.slice(0, 10)) &&
          m.source === "mock",
      );
      let engagementSource: AnalyticsSourceKind = "unavailable";
      let platformEngagements: number | null = null;
      let platformImpressions: number | null = null;
      if (platformMetric.length) {
        engagementSource = "measured";
        platformEngagements = platformMetric.reduce((s, m) => s + m.engagements, 0);
        platformImpressions = platformMetric.reduce((s, m) => s + m.impressions, 0);
      } else if (mockMetric.length) {
        engagementSource = "synthetic_mock";
      }
      return {
        contentId: item.id,
        title: item.title ?? item.body.slice(0, 80),
        platform: PLATFORM_LABELS[item.platform] ?? item.platform,
        category: item.category,
        status: item.status,
        trackedClicks: contentClicks.get(item.id) ?? 0,
        publishedInPeriod: publishedContentIds.has(item.id),
        platformEngagements,
        platformImpressions,
        engagementSource,
      };
    })
    .sort((a, b) => b.trackedClicks - a.trackedClicks);

  const postPerformanceTruncated = postPerformance.length > ANALYTICS_MAX_POST_PERFORMANCE_ROWS;
  const visitedPagesFull = [...pageClicks.entries()]
    .map(([destinationPath, count]) => ({
      destinationPath,
      trackedClicks: count,
      source: "measured" as AnalyticsSourceKind,
    }))
    .sort((a, b) => b.trackedClicks - a.trackedClicks);
  const visitedPagesTruncated = visitedPagesFull.length > ANALYTICS_MAX_VISITED_PAGES;
  const campaignAttributionFull = [...campaignClicks.entries()]
    .map(([campaignId, count]) => ({
      campaignId,
      trackedClicks: count,
      postsPublished: publishedInPeriod.filter((pub) => pub.campaignId === campaignId).length,
      source: "measured" as AnalyticsSourceKind,
    }))
    .sort((a, b) => b.trackedClicks - a.trackedClicks);
  const campaignAttributionTruncated =
    campaignAttributionFull.length > ANALYTICS_MAX_CAMPAIGN_ATTRIBUTION_ROWS;

  if (isMockMode()) {
    partialDataWarnings.push(
      "MARKETING_MOCK_MODE is active: platform publishers are mocked; engagement metrics will not reflect live networks.",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    timezone: period.timezone,
    window,
    period,
    freshness: {
      latestClickAt: latestIso(clicks.map((c) => ({ at: c.clickedAt }))),
      latestEventAt: latestIso(events.map((e) => ({ at: e.createdAt }))),
      latestMetricAt: latestIso(metrics.map((m) => ({ at: m.createdAt }))),
      purchasesSnapshotLoaded: purchasesStoreReachable,
    },
    connections,
    measured: {
      trackedLinkClicks: clicksInPeriod.length,
      uniqueDestinationPaths: pageClicks.size,
      resourceDownloads,
      postsPublished: publishedInPeriod.length,
      publicationFailures: failedInPeriod.length,
    },
    conversions: {
      purchasesInPeriod: purchasesInPeriod.length,
      directlyAttributedInPeriod: attributedInPeriod.filter((r) => r.kind === "directly_attributed")
        .length,
      assistedInPeriod: attributedInPeriod.filter((r) => r.kind === "assisted").length,
      source: purchasesStoreReachable ? "measured" : "unavailable",
    },
    platformAttribution: [...platformClicks.entries()]
      .map(([platform, count]) => ({
        platform: PLATFORM_LABELS[platform as Platform] ?? platform,
        trackedClicks: count,
        postsPublished: publishedInPeriod.filter((pub) => {
          const c = contentById.get(pub.contentId);
          return c?.platform === platform;
        }).length,
        source: "measured" as AnalyticsSourceKind,
      }))
      .sort((a, b) => b.trackedClicks - a.trackedClicks),
    campaignAttribution: campaignAttributionFull.slice(0, ANALYTICS_MAX_CAMPAIGN_ATTRIBUTION_ROWS),
    visitedPages: visitedPagesFull.slice(0, ANALYTICS_MAX_VISITED_PAGES),
    postPerformance: postPerformance.slice(0, ANALYTICS_MAX_POST_PERFORMANCE_ROWS),
    socialEngagement: {
      facebook: socialEngagementFor("facebook"),
      instagram: socialEngagementFor("instagram"),
      pinterest: socialEngagementFor("pinterest"),
    },
    syntheticMetricsRollup: {
      included: mockMetricsInPeriod.length > 0,
      ...syntheticRollup,
      note:
        "Mock metrics are generated internally (e.g. recordMockMetrics) and must not be reported as measured platform performance.",
    },
    attributionSample: sanitizeAttributionRows(attributed).slice(0, ANALYTICS_MAX_ATTRIBUTION_SAMPLE),
    partialDataWarnings,
    privacyNote: MARKETING_ANALYTICS_PRIVACY_NOTE,
    resultLimits: {
      postPerformanceTruncated,
      visitedPagesTruncated,
      campaignAttributionTruncated,
    },
  };
}
