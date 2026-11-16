import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { marketingDatetimeLocalToIso } from "./marketing-scheduling";
import {
  assertPlannerStagingE2eFixtureMutationAllowed,
  PLANNER_E2E_STAGING_TAG,
  PLANNER_STAGING_E2E_OWNERSHIP_MESSAGE,
} from "./planner-staging-e2e-gate";
import type { MarketingStore } from "./store";
import type { MarketingContent, MarketingPublication } from "./types";

export const PLANNER_E2E_FIXTURE_BATCH_KEY = "e2eFixtureBatch";
export const PLANNER_E2E_FIXTURE_ROLE_KEY = "e2eFixtureRole";

export class PlannerStagingE2eFixturesError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "PlannerStagingE2eFixturesError";
  }
}

export function serverE2eFixtureMetadata(
  batchId: string,
  role: string,
  extra: Record<string, unknown> = {},
): MarketingContent["metadata"] {
  return {
    e2eTag: PLANNER_E2E_STAGING_TAG,
    [PLANNER_E2E_FIXTURE_BATCH_KEY]: batchId,
    [PLANNER_E2E_FIXTURE_ROLE_KEY]: role,
    ...extra,
  } as MarketingContent["metadata"];
}

export type PlannerE2eFixtureCreateResult = {
  batchId: string;
  weeklyPlanId: string;
  campaignId: string;
  contentIds: Record<
    | "instagram"
    | "facebook"
    | "smartInstagram"
    | "smartFacebook"
    | "legacy"
    | "scheduledControl"
    | "publishedControl",
    string
  >;
  publicationIds: {
    scheduledControl: string;
    publishedControl: string;
  };
};

function baseFixtureContent(
  id: string,
  batchId: string,
  role: string,
  overrides: Partial<MarketingContent>,
): Omit<MarketingContent, "createdAt" | "updatedAt"> {
  const extraMetadata =
    typeof overrides.metadata === "object" && overrides.metadata
      ? (overrides.metadata as Record<string, unknown>)
      : {};
  const { metadata: _ignored, ...restOverrides } = overrides;
  return {
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: `E2E ${role}`,
    body: "Planner E2E disposable fixture body.",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: `e2e-${role}-${id.slice(0, 8)}`,
    originalBody: null,
    bookId: null,
    isDemo: true,
    ...restOverrides,
    id,
    metadata: serverE2eFixtureMetadata(batchId, role, extraMetadata),
  };
}

export async function createPlannerE2eStagingFixtures(
  store: MarketingStore,
): Promise<PlannerE2eFixtureCreateResult> {
  assertPlannerStagingE2eFixtureMutationAllowed();

  const batchId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const weeklyPlanId = crypto.randomUUID();
  const finalizeKey = `e2e-smart-${batchId.slice(0, 8)}`;

  await store.createCampaign({
    id: campaignId,
    name: `${PLANNER_E2E_STAGING_TAG} ${batchId.slice(0, 8)}`,
    objective: "e2e",
    status: "active",
    primaryAudience: "parents",
    secondaryAudience: null,
    coreMessage: "planner e2e",
    contentThemes: [],
    channelDistribution: {},
    recommendedFrequency: {},
    cta: null,
    requiredAssets: [],
    measurementGoals: [],
    bookIds: [],
    startOn: "2026-05-12",
    endOn: null,
    createdBy: null,
    isDemo: true,
  });

  await store.createWeeklyPlan({
    id: weeklyPlanId,
    campaignId,
    weekStart: "2026-05-12",
    status: "ready",
    summary: {
      itemCount: 0,
      newAssetCount: 0,
      warningCount: 0,
      objective: "e2e",
      audience: "parents",
      quotas: { instagram: 2, facebook: 2, pinterest: 0, email: 0, website: 0, google: 0 },
    },
    rationale: {},
    isDemo: true,
  });

  const ids = {
    instagram: crypto.randomUUID(),
    facebook: crypto.randomUUID(),
    smartInstagram: crypto.randomUUID(),
    smartFacebook: crypto.randomUUID(),
    legacy: crypto.randomUUID(),
    scheduledControl: crypto.randomUUID(),
    publishedControl: crypto.randomUUID(),
  };

  const withCampaign = { campaignId } as const;
  await store.createContent(
    baseFixtureContent(ids.instagram, batchId, "instagram", {
      platform: "instagram",
      ...withCampaign,
      metadata: serverE2eFixtureMetadata(batchId, "instagram", {
        utmCampaign: "e2e-planner",
      }),
    }),
  );
  await store.createContent(
    baseFixtureContent(ids.facebook, batchId, "facebook", { platform: "facebook", ...withCampaign }),
  );
  await store.createContent(
    baseFixtureContent(ids.legacy, batchId, "legacy", {
      platform: "instagram",
      ...withCampaign,
      metadata: serverE2eFixtureMetadata(batchId, "legacy", { legacy: true }),
    }),
  );

  const sharedAssetId = crypto.randomUUID();
  await store.createAsset({
    id: sharedAssetId,
    name: `${PLANNER_E2E_STAGING_TAG} asset`,
    type: "upload",
    source: "manual_upload",
    bookId: null,
    characterId: null,
    campaignId,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "1:1",
    imageWidth: 1080,
    imageHeight: 1080,
    mimeType: "image/png",
    tags: [PLANNER_E2E_STAGING_TAG],
    url: "https://example.test/e2e.png",
    altText: "e2e",
    isDemo: true,
  });

  await store.createContent(
    baseFixtureContent(ids.smartInstagram, batchId, "smartInstagram", {
      platform: "instagram",
      ...withCampaign,
      assetIds: [sharedAssetId],
      metadata: serverE2eFixtureMetadata(batchId, "smartInstagram", {
        source: SMART_UPLOAD_SOURCE,
        smartUploadFinalizeKey: finalizeKey,
      }),
    }),
  );
  await store.createContent(
    baseFixtureContent(ids.smartFacebook, batchId, "smartFacebook", {
      platform: "facebook",
      ...withCampaign,
      assetIds: [sharedAssetId],
      metadata: serverE2eFixtureMetadata(batchId, "smartFacebook", {
        source: SMART_UPLOAD_SOURCE,
        smartUploadFinalizeKey: finalizeKey,
      }),
    }),
  );

  const scheduledWhen = marketingDatetimeLocalToIso("2026-06-15T10:00", "America/New_York");
  await store.createContent(
    baseFixtureContent(ids.scheduledControl, batchId, "scheduledControl", {
      platform: "instagram",
      ...withCampaign,
      weeklyPlanId,
      scheduledFor: scheduledWhen,
    }),
  );

  const pubScheduledId = crypto.randomUUID();
  await store.createPublication({
    id: pubScheduledId,
    contentId: ids.scheduledControl,
    campaignId,
    platform: "instagram",
    provider: "meta",
    status: "scheduled",
    idempotencyKey: `e2e:sched:${ids.scheduledControl}`,
    externalId: null,
    url: null,
    scheduledFor: scheduledWhen,
    attemptCount: 0,
    lastError: null,
    publishedAt: null,
    providerCreationId: null,
  } as Omit<MarketingPublication, "createdAt" | "updatedAt">);

  await store.createContent(
    baseFixtureContent(ids.publishedControl, batchId, "publishedControl", {
      platform: "facebook",
      ...withCampaign,
      status: "published",
    }),
  );
  const pubPublishedId = crypto.randomUUID();
  await store.createPublication({
    id: pubPublishedId,
    contentId: ids.publishedControl,
    campaignId,
    platform: "facebook",
    provider: "meta",
    status: "published",
    idempotencyKey: `e2e:pub:${ids.publishedControl}`,
    externalId: "mock-e2e-external",
    url: null,
    scheduledFor: scheduledWhen,
    attemptCount: 1,
    lastError: null,
    publishedAt: scheduledWhen,
    providerCreationId: "mock-e2e-external",
  } as Omit<MarketingPublication, "createdAt" | "updatedAt">);

  return {
    batchId,
    weeklyPlanId,
    campaignId,
    contentIds: ids,
    publicationIds: {
      scheduledControl: pubScheduledId,
      publishedControl: pubPublishedId,
    },
  };
}

/** Reject client attempts to self-assign E2E ownership. */
export function rejectClientSuppliedE2eOwnership(metadata: unknown): void {
  if (!metadata || typeof metadata !== "object") return;
  const record = metadata as Record<string, unknown>;
  if (record.e2eTag === PLANNER_E2E_STAGING_TAG) {
    throw new PlannerStagingE2eFixturesError(PLANNER_STAGING_E2E_OWNERSHIP_MESSAGE);
  }
}