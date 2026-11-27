import { publishPublication, scheduleApproved } from "./approval";
import {
  assertPlannerStagingE2eFixtureMutationAllowed,
  PLANNER_E2E_STAGING_TAG,
} from "./planner-staging-e2e-gate";
import { marketingDatetimeLocalToIso } from "./marketing-scheduling";
import type { PlannerE2eFixtureCreateResult } from "./planner-e2e-fixtures";
import type { MarketingStore } from "./store";

export type PlannerE2eTikTokMockPublishResult = {
  imagePublicationId: string;
  imageExternalId: string | null;
  videoPublicationId: string;
  videoExternalId: string | null;
};

/**
 * Schedules and mock-publishes tagged TikTok fixtures (image + video) through
 * the standard approval / claim / publisher path — no hand-inserted published rows.
 */
export async function exercisePlannerE2eTikTokMockPublish(
  store: MarketingStore,
  fixtures: Pick<PlannerE2eFixtureCreateResult, "contentIds">,
): Promise<PlannerE2eTikTokMockPublishResult> {
  assertPlannerStagingE2eFixtureMutationAllowed();

  const when = marketingDatetimeLocalToIso("2026-06-20T14:30", "America/New_York");
  const imagePub = await scheduleApproved(store, fixtures.contentIds.tiktokImage, {
    scheduledFor: when,
  });
  const videoPub = await scheduleApproved(store, fixtures.contentIds.tiktokVideo, {
    scheduledFor: when,
  });

  const publishedImage = await publishPublication(store, imagePub);
  const publishedVideo = await publishPublication(store, videoPub);

  return {
    imagePublicationId: publishedImage.id,
    imageExternalId: publishedImage.externalId,
    videoPublicationId: publishedVideo.id,
    videoExternalId: publishedVideo.externalId,
  };
}

export function isPlannerE2eTikTokFixtureBatch(
  metadata: unknown,
): metadata is Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") return false;
  const record = metadata as Record<string, unknown>;
  return record.e2eTag === PLANNER_E2E_STAGING_TAG;
}