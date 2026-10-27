import { isMockMode } from "./config";
import { isFreeResourceContent } from "./content-metadata";
import { formatPreflightError, runPublishPreflight } from "./publish-preflight";
import { resolveScheduleInstant } from "./marketing-scheduling";
import { isContentRecyclablePlatform } from "./recycle-eligibility";
import { getEmailProvider, getSocialPublisher } from "./publishers";
import { getWebsiteFreeResourcePublisher } from "./website-free-resource-publisher";
import type { MarketingStore } from "./store";
import type { MarketingContent, MarketingPublication } from "./types";

export function recycleIdempotencyKey(content: MarketingContent, publicationId: string): string {
  return `pub:${content.id}:${content.platform}:recycle:${publicationId}`;
}

function publicationProviderForContent(content: MarketingContent): string {
  if (isFreeResourceContent(content)) {
    return getWebsiteFreeResourcePublisher().id;
  }
  const providerId =
    content.platform === "email"
      ? getEmailProvider().id
      : getSocialPublisher(content.platform).id;
  return isMockMode() ? `mock:${providerId}` : providerId;
}

export async function hasPublishedPublicationForContent(
  store: MarketingStore,
  content: MarketingContent,
): Promise<boolean> {
  const publications = await store.listPublications();
  return publications.some(
    (row) =>
      row.contentId === content.id &&
      row.platform === content.platform &&
      row.status === "published" &&
      Boolean(row.publishedAt ?? row.externalId),
  );
}

export async function canRecyclePublishedContent(
  store: MarketingStore,
  content: MarketingContent,
): Promise<boolean> {
  if (content.status !== "published") return false;
  if (!isContentRecyclablePlatform(content)) return false;
  return hasPublishedPublicationForContent(store, content);
}

export async function recyclePublished(
  store: MarketingStore,
  contentId: string,
  input?: { scheduledFor?: string | null },
): Promise<MarketingPublication> {
  const content = await store.getContent(contentId);
  if (!content) throw new Error("Content not found.");
  if (!isContentRecyclablePlatform(content)) {
    throw new Error("This content type cannot be recycled.");
  }
  if (content.status !== "published" && content.status !== "scheduled") {
    throw new Error("Only published content can be recycled.");
  }
  const hasPublished = await hasPublishedPublicationForContent(store, content);
  if (!hasPublished) {
    throw new Error("No published publication found for this content.");
  }

  const preflight = await runPublishPreflight(store, content);
  if (!preflight.ok) {
    throw new Error(formatPreflightError(preflight));
  }

  const scheduledFor = resolveScheduleInstant(content, input?.scheduledFor);
  const publicationId = crypto.randomUUID();
  const idempotencyKey = recycleIdempotencyKey(content, publicationId);

  const publication = await store.createPublication({
    id: publicationId,
    contentId: content.id,
    campaignId: content.campaignId,
    platform: content.platform,
    provider: publicationProviderForContent(content),
    status: "scheduled",
    idempotencyKey,
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor,
    publishedAt: null,
  });

  await store.updateContent(content.id, { status: "scheduled", scheduledFor });
  return publication;
}
