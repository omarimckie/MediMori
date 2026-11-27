import { isBufferTikTokPublication } from "./buffer-tiktok-guards";
import type { MarketingStore } from "../store";
import type { MarketingPublication } from "../types";

const SENSITIVE_LAST_ERROR_PATTERN =
  /(token|bearer|authorization|password|secret|api[_-]?key)/i;

export type TikTokInventoryBucket =
  | "scheduled"
  | "overdue"
  | "processing"
  | "failed"
  | "ambiguous"
  | "other";

export type TikTokPublicationInventoryItem = {
  publicationId: string;
  contentId: string;
  status: MarketingPublication["status"];
  provider: string;
  scheduledFor: string | null;
  attemptCount: number;
  ambiguityState: NonNullable<MarketingPublication["ambiguityState"]>;
  overdue: boolean;
  unexpectedProvider: boolean;
  lastErrorSummary: string | null;
  updatedAt: string;
  bucket: TikTokInventoryBucket;
};

export type TikTokPublicationInventoryCounts = {
  scheduled: number;
  overdue: number;
  processing: number;
  failed: number;
  ambiguous: number;
  unexpectedProvider: number;
  total: number;
};

export type TikTokPublicationInventoryResult = {
  counts: TikTokPublicationInventoryCounts;
  items: TikTokPublicationInventoryItem[];
  total: number;
  limit: number;
  offset: number;
};

export function sanitizePublicationLastError(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (SENSITIVE_LAST_ERROR_PATTERN.test(trimmed)) {
    return "Publication error details withheld.";
  }
  if (trimmed.length > 180) {
    return `${trimmed.slice(0, 177)}…`;
  }
  return trimmed;
}

function isTikTokPlatformPublication(
  publication: Pick<MarketingPublication, "platform" | "provider">,
): boolean {
  return publication.platform === "tiktok";
}

function classifyBucket(
  publication: MarketingPublication,
  now: Date,
  ambiguous: boolean,
): TikTokInventoryBucket {
  if (ambiguous) return "ambiguous";
  if (publication.status === "processing") return "processing";
  if (publication.status === "failed") return "failed";
  if (publication.status === "scheduled") {
    if (publication.scheduledFor && new Date(publication.scheduledFor).getTime() <= now.getTime()) {
      return "overdue";
    }
    return "scheduled";
  }
  return "other";
}

function isOverdue(publication: MarketingPublication, now: Date): boolean {
  return (
    publication.status === "scheduled" &&
    Boolean(publication.scheduledFor) &&
    new Date(publication.scheduledFor!).getTime() <= now.getTime()
  );
}

function unexpectedTikTokProvider(publication: MarketingPublication): boolean {
  if (!isTikTokPlatformPublication(publication)) return false;
  if (publication.provider === "buffer_tiktok" || publication.provider.startsWith("mock:buffer_tiktok")) {
    return false;
  }
  if (publication.provider.startsWith("mock_")) return false;
  return !isBufferTikTokPublication(publication);
}

export function buildTikTokPublicationInventory(
  publications: MarketingPublication[],
  now = new Date(),
  pagination: { limit: number; offset: number },
): TikTokPublicationInventoryResult {
  const tiktokRows = publications.filter(isTikTokPlatformPublication);
  const items: TikTokPublicationInventoryItem[] = tiktokRows.map((publication) => {
    const ambiguous =
      publication.ambiguityState === "ambiguous" || publication.ambiguityState === "owner_required";
    const bucket = classifyBucket(publication, now, ambiguous);
  return {
      publicationId: publication.id,
      contentId: publication.contentId,
      status: publication.status,
      provider: publication.provider,
      scheduledFor: publication.scheduledFor,
      attemptCount: publication.attemptCount,
      ambiguityState: publication.ambiguityState ?? "none",
      overdue: isOverdue(publication, now),
      unexpectedProvider: unexpectedTikTokProvider(publication),
      lastErrorSummary: sanitizePublicationLastError(publication.lastError),
      updatedAt: publication.updatedAt,
      bucket,
    };
  });

  const counts: TikTokPublicationInventoryCounts = {
    scheduled: items.filter((item) => item.bucket === "scheduled").length,
    overdue: items.filter((item) => item.bucket === "overdue").length,
    processing: items.filter((item) => item.bucket === "processing").length,
    failed: items.filter((item) => item.bucket === "failed").length,
    ambiguous: items.filter((item) => item.bucket === "ambiguous").length,
    unexpectedProvider: items.filter((item) => item.unexpectedProvider).length,
    total: items.length,
  };

  const sorted = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const page = sorted.slice(pagination.offset, pagination.offset + pagination.limit);

  return {
    counts,
    items: page,
    total: sorted.length,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

export async function listTikTokPublicationInventory(
  store: MarketingStore,
  pagination: { limit: number; offset: number },
  now = new Date(),
): Promise<TikTokPublicationInventoryResult> {
  const publications = await store.listPublications();
  return buildTikTokPublicationInventory(publications, now, pagination);
}

export function parseTikTokInventoryPagination(
  limitParam: string | null,
  offsetParam: string | null,
): { limit: number; offset: number } {
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 100;
  let limit = DEFAULT_LIMIT;
  let offset = 0;
  if (limitParam?.trim()) {
    const parsed = Number.parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }
  if (offsetParam?.trim()) {
    const parsed = Number.parseInt(offsetParam, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }
  return { limit, offset };
}