import {
  bufferFetchPostById,
  mapBufferPostStatusToPublication,
} from "./buffer/buffer-tiktok-post";
import {
  isBufferTikTokLivePublishingAllowed,
  isMarketingBufferTikTokFeatureEnabled,
} from "./buffer/buffer-config";
import type { MarketingStore } from "./store";
import type { MarketingPublication } from "./types";

const BUFFER_TIKTOK_PROVIDER = "buffer_tiktok";

function isBufferTikTokAwaitingReconcile(publication: MarketingPublication): boolean {
  if (publication.platform !== "tiktok") return false;
  if (publication.provider !== BUFFER_TIKTOK_PROVIDER && !publication.provider.startsWith("mock:buffer_tiktok")) {
    return false;
  }
  if (!publication.externalId?.trim()) return false;
  return publication.status === "processing" || publication.status === "scheduled";
}

export type BufferTikTokReconcileStats = {
  scanned: number;
  published: number;
  failed: number;
  unchanged: number;
};

export type BufferTikTokReconcileOptions = {
  fetchPost?: typeof bufferFetchPostById;
  env?: Record<string, string | undefined>;
};

export async function reconcileBufferTikTokPublications(
  store: MarketingStore,
  options?: BufferTikTokReconcileOptions,
): Promise<BufferTikTokReconcileStats> {
  const env = options?.env ?? process.env;
  const fetchPost = options?.fetchPost ?? bufferFetchPostById;
  const stats: BufferTikTokReconcileStats = {
    scanned: 0,
    published: 0,
    failed: 0,
    unchanged: 0,
  };

  if (!isMarketingBufferTikTokFeatureEnabled(env) || env.MARKETING_MOCK_MODE !== "false") {
    return stats;
  }

  if (!isBufferTikTokLivePublishingAllowed(env)) {
    return stats;
  }

  const scheduled = await store.listPublications("scheduled");
  const processing = await store.listPublications("processing");
  const candidates = [...scheduled, ...processing].filter(isBufferTikTokAwaitingReconcile);

  for (const publication of candidates) {
    stats.scanned += 1;
    const externalId = publication.externalId!.trim();
    let remote;
    try {
      remote = await fetchPost(externalId);
    } catch {
      stats.unchanged += 1;
      continue;
    }
    if (!remote) {
      stats.unchanged += 1;
      continue;
    }

    const mapped = mapBufferPostStatusToPublication(remote.status);
    if (mapped === "published") {
      const content = await store.getContent(publication.contentId);
      const updated = await store.updatePublication(publication.id, {
        status: "published",
        publishedAt: publication.publishedAt ?? new Date().toISOString(),
        lastError: null,
        ambiguityState: "none",
        claimToken: null,
        processingStartedAt: null,
      });
      if (updated && content) {
        await store.updateContent(content.id, { status: "published" });
        stats.published += 1;
      } else {
        stats.unchanged += 1;
      }
      continue;
    }

    if (mapped === "failed") {
      await store.updatePublication(publication.id, {
        status: "failed",
        lastError: "buffer_tiktok_remote_failed: Buffer reported post failure.",
        claimToken: null,
        processingStartedAt: null,
      });
      const content = await store.getContent(publication.contentId);
      if (content) {
        await store.updateContent(content.id, { status: "failed" });
      }
      stats.failed += 1;
      continue;
    }

    stats.unchanged += 1;
  }

  return stats;
}