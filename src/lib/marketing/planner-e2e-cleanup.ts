import {
  assertPlannerStagingE2eFixtureMutationAllowed,
  isPlannerE2eStagingTaggedMetadata,
  PLANNER_E2E_STAGING_TAG,
} from "./planner-staging-e2e-gate";
import { PLANNER_E2E_FIXTURE_ROLE_KEY } from "./planner-e2e-fixtures";
import { PLANNER_E2E_FIXTURE_BATCH_KEY } from "./planner-e2e-fixtures";
import type { MarketingStore } from "./store";

export type PlannerE2eCleanupInput = {
  batchId?: string;
};

export type PlannerE2eCleanupResult = {
  deletedContentIds: string[];
  deletedPublicationIds: string[];
  deletedWeeklyPlanIds: string[];
  deletedCampaignIds: string[];
  deletedAssetIds: string[];
  skippedUntagged: number;
};

export class PlannerStagingE2eCleanupError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "PlannerStagingE2eCleanupError";
  }
}

function contentMatchesBatch(
  metadata: unknown,
  batchId: string | undefined,
): metadata is Record<string, unknown> {
  if (!isPlannerE2eStagingTaggedMetadata(metadata)) return false;
  if (!batchId) return true;
  const record = metadata as Record<string, unknown>;
  return record[PLANNER_E2E_FIXTURE_BATCH_KEY] === batchId;
}

export async function cleanupPlannerE2eStagingFixtures(
  store: MarketingStore,
  input: PlannerE2eCleanupInput = {},
): Promise<PlannerE2eCleanupResult> {
  assertPlannerStagingE2eFixtureMutationAllowed();

  const batchId = input.batchId?.trim() || undefined;
  const allContent = await store.listContent();
  const targetContent = allContent.filter((row) => contentMatchesBatch(row.metadata, batchId));
  const skippedUntagged = allContent.filter(
    (row) => !isPlannerE2eStagingTaggedMetadata(row.metadata),
  ).length;

  if (batchId && targetContent.length === 0) {
    return {
      deletedContentIds: [],
      deletedPublicationIds: [],
      deletedWeeklyPlanIds: [],
      deletedCampaignIds: [],
      deletedAssetIds: [],
      skippedUntagged,
    };
  }

  const targetIds = new Set(targetContent.map((row) => row.id));
  const publications = await store.listPublications();
  const pubsToDelete = publications.filter((pub) => targetIds.has(pub.contentId));

  const nonE2eLinked = publications.filter(
    (pub) =>
      !targetIds.has(pub.contentId) &&
      pub.idempotencyKey?.startsWith("e2e:") === true,
  );
  if (nonE2eLinked.length > 0) {
    throw new PlannerStagingE2eCleanupError(
      "Unexpected E2E publication linkage; cleanup aborted.",
    );
  }

  const deletedPublicationIds = pubsToDelete.map((pub) => pub.id);

  const deletedContentIds: string[] = [];
  for (const row of targetContent) {
    if (!isPlannerE2eStagingTaggedMetadata(row.metadata)) {
      throw new PlannerStagingE2eCleanupError("Refusing to delete non-E2E tagged content.");
    }
    const record = row.metadata as Record<string, unknown>;
    const role = record[PLANNER_E2E_FIXTURE_ROLE_KEY];
    if (
      (row.status === "published" || row.status === "scheduled") &&
      role !== "scheduledControl" &&
      role !== "publishedControl" &&
      role !== "tiktokImage" &&
      role !== "tiktokVideo"
    ) {
      throw new PlannerStagingE2eCleanupError(
        `Refusing to delete scheduled/published content without control role: ${row.id}.`,
      );
    }
    const ok = await store.deleteContent(row.id);
    if (!ok) {
      throw new PlannerStagingE2eCleanupError(`Failed to delete content ${row.id}.`);
    }
    deletedContentIds.push(row.id);
  }

  const weeklyPlanIds = new Set(
    targetContent.map((r) => r.weeklyPlanId).filter((id): id is string => Boolean(id)),
  );
  const deletedWeeklyPlanIds: string[] = [];
  for (const planId of weeklyPlanIds) {
    const plan = await store.getWeeklyPlan(planId);
    if (!plan) continue;
    const remaining = (await store.listContent()).some((c) => c.weeklyPlanId === planId);
    if (remaining) {
      throw new PlannerStagingE2eCleanupError(
        `Weekly plan ${planId} still referenced; cleanup aborted.`,
      );
    }
    if (!plan.isDemo) {
      throw new PlannerStagingE2eCleanupError(
        `Refusing to delete non-demo weekly plan ${planId}.`,
      );
    }
    const deleted = await store.deleteWeeklyPlan(planId);
    if (!deleted) {
      throw new PlannerStagingE2eCleanupError(`Failed to delete weekly plan ${planId}.`);
    }
    deletedWeeklyPlanIds.push(planId);
  }

  const campaignIds = new Set(
    targetContent.map((r) => r.campaignId).filter((id): id is string => Boolean(id)),
  );
  const deletedCampaignIds: string[] = [];
  for (const campaignId of campaignIds) {
    const campaign = await store.getCampaign(campaignId);
    const remaining = (await store.listContent()).some((c) => c.campaignId === campaignId);
    if (remaining) continue;
    if (!campaign?.isDemo || !campaign.name.includes(PLANNER_E2E_STAGING_TAG)) {
      throw new PlannerStagingE2eCleanupError(
        `Refusing to delete non-E2E demo campaign ${campaignId}.`,
      );
    }
    const deleted = await store.deleteCampaign(campaignId);
    if (!deleted) {
      throw new PlannerStagingE2eCleanupError(`Failed to delete campaign ${campaignId}.`);
    }
    deletedCampaignIds.push(campaignId);
  }

  const assets = await store.listAssets();
  const deletedAssetIds: string[] = [];
  for (const asset of assets.filter((a) => a.tags.includes(PLANNER_E2E_STAGING_TAG))) {
    const stillUsed = (await store.listContent()).some((c) => c.assetIds.includes(asset.id));
    if (stillUsed) continue;
    const ok = await store.deleteAsset(asset.id);
    if (ok) deletedAssetIds.push(asset.id);
  }

  return {
    deletedContentIds,
    deletedPublicationIds,
    deletedWeeklyPlanIds,
    deletedCampaignIds,
    deletedAssetIds,
    skippedUntagged,
  };
}