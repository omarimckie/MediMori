import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import type { MarketingContent, Platform } from "./types";

/** Within one Smart Upload finalize group, show Meta channels before Pinterest. */
const SMART_UPLOAD_PLATFORM_RANK: Partial<Record<Platform, number>> = {
  instagram: 0,
  facebook: 1,
  pinterest: 2,
};

export function smartUploadAdminListGroupKey(content: MarketingContent): string | null {
  if (content.metadata?.source !== SMART_UPLOAD_SOURCE) return null;
  const finalizeKey = content.metadata.smartUploadFinalizeKey?.trim();
  if (finalizeKey) return `finalize:${finalizeKey}`;
  const batchId = content.metadata.batchId?.trim();
  if (batchId) return `batch:${batchId}`;
  return null;
}

function adminListGroupKey(content: MarketingContent): string {
  const uploadGroup = smartUploadAdminListGroupKey(content);
  if (uploadGroup) return uploadGroup;
  return `solo:${content.id}`;
}

function compareCreatedAtDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

function platformRankWithinSmartUploadGroup(content: MarketingContent): number {
  const rank = SMART_UPLOAD_PLATFORM_RANK[content.platform as Platform];
  return rank ?? 100;
}

function maxCreatedAtForGroups(items: MarketingContent[]): Map<string, string> {
  const groupMax = new Map<string, string>();
  for (const item of items) {
    const group = adminListGroupKey(item);
    const existing = groupMax.get(group);
    if (!existing || compareCreatedAtDesc(item.createdAt, existing) < 0) {
      groupMax.set(group, item.createdAt);
    }
  }
  return groupMax;
}

/**
 * Newest-first admin content list. Smart Upload rows that share a finalize key (or batch)
 * stay adjacent in Instagram → Facebook → Pinterest order without changing stored timestamps.
 */
export function sortMarketingContentForAdminList(
  items: MarketingContent[],
): MarketingContent[] {
  if (items.length <= 1) return [...items];
  const copy = [...items];
  const groupMaxCreatedAt = maxCreatedAtForGroups(copy);
  copy.sort((a, b) => {
    const groupA = adminListGroupKey(a);
    const groupB = adminListGroupKey(b);
    const byGroupNewest = compareCreatedAtDesc(
      groupMaxCreatedAt.get(groupA) ?? a.createdAt,
      groupMaxCreatedAt.get(groupB) ?? b.createdAt,
    );
    if (byGroupNewest !== 0) return byGroupNewest;
    if (groupA !== groupB) {
      return groupA.localeCompare(groupB);
    }
    const byPlatform = platformRankWithinSmartUploadGroup(a) - platformRankWithinSmartUploadGroup(b);
    if (byPlatform !== 0) return byPlatform;
    const byCreated = compareCreatedAtDesc(a.createdAt, b.createdAt);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
  });
  return copy;
}
