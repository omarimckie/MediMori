import { composeSocialPublishCaption } from "./marketing-social-website-link";
import { resolveContentImageUrl } from "./assets";
import {
  getBufferTikTokChannelId,
  isBufferTikTokLivePublishingAllowed,
  isMarketingBufferTikTokFeatureEnabled,
} from "./buffer/buffer-config";
import {
  bufferCreateTikTokPost,
  type BufferCreateTikTokPostInput,
} from "./buffer/buffer-tiktok-post";
import {
  BufferGraphqlError,
  type BufferGraphqlClientOptions,
} from "./buffer/buffer-graphql-client";
import {
  classifyTikTokAsset,
  resolveTikTokPublishMedia,
  tiktokMediaKindForFormat,
  type TikTokPublishMedia,
} from "./buffer-tiktok-media";
import { isMockMode } from "./config";
import type { MarketingStore } from "./store";
import type { PublishRequest, PublishResult, SocialPublisher } from "./publishers";
import { resolvePublishableMarketingAssetUrl } from "./marketing-asset-public-image-url";

function alreadyPublished(request: PublishRequest, provider: string): PublishResult | null {
  if (request.publication.externalId) {
    return {
      ok: true,
      provider,
      externalId: request.publication.externalId,
      url: request.publication.url ?? undefined,
      errorCode: "buffer_already_submitted",
    };
  }
  return null;
}

export type BufferTikTokPublisherOptions = {
  graphql?: BufferGraphqlClientOptions;
  store?: MarketingStore;
};

async function resolveMediaForPublish(
  request: PublishRequest,
  store: MarketingStore | undefined,
): Promise<TikTokPublishMedia | null> {
  const required = tiktokMediaKindForFormat(request.content.format);
  if (!required) return null;

  const assets = [];
  for (const assetId of request.content.assetIds) {
    if (!store) continue;
    const asset = await store.getAsset(assetId);
    if (asset) assets.push(asset);
  }

  if (assets.length) {
    const withUrls = assets.map((asset) => ({
      ...asset,
      url: resolvePublishableMarketingAssetUrl(asset, request.content.status),
    }));
    const resolved = resolveTikTokPublishMedia(request.content, withUrls);
    if (resolved.ok) return resolved.media;
  }

  const imageUrl = request.imageUrl?.trim();
  if (required === "image" && imageUrl) {
    return { kind: "image", publicUrl: imageUrl };
  }
  const videoUrl = request.videoUrl?.trim();
  if (required === "video" && videoUrl) {
    return { kind: "video", publicUrl: videoUrl };
  }
  return null;
}

export class BufferTikTokPublisher implements SocialPublisher {
  id = "buffer_tiktok";

  constructor(private readonly options: BufferTikTokPublisherOptions = {}) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    const replay = alreadyPublished(request, this.id);
    if (replay) return replay;

    if (!isMarketingBufferTikTokFeatureEnabled() && !isMockMode()) {
      return {
        ok: false,
        provider: this.id,
        error: "buffer_tiktok_disabled: MARKETING_BUFFER_TIKTOK_ENABLED is not set.",
        errorCode: "buffer_tiktok_disabled",
        retryable: false,
      };
    }

    if (isMockMode()) {
      return {
        ok: true,
        provider: this.id,
        externalId: `mock_buffer_${request.publication.idempotencyKey}`,
        url: "https://buffer.com/mock/tiktok",
      };
    }

    const channelId = getBufferTikTokChannelId();
    if (!channelId) {
      return {
        ok: false,
        provider: this.id,
        error: "buffer_tiktok_channel_missing: Set BUFFER_TIKTOK_CHANNEL_ID.",
        errorCode: "buffer_tiktok_channel_missing",
        retryable: false,
      };
    }

    const media = await resolveMediaForPublish(request, this.options.store);
    if (!media) {
      return {
        ok: false,
        provider: this.id,
        error: "buffer_tiktok_media_missing: No TikTok-compatible media URL is attached.",
        errorCode: "buffer_tiktok_media_missing",
        retryable: false,
      };
    }

    if (!isBufferTikTokLivePublishingAllowed()) {
      return {
        ok: false,
        provider: this.id,
        error:
          "buffer_tiktok_live_blocked: Live Buffer mutations require MARKETING_BUFFER_TIKTOK_LIVE=true (owner authorization).",
        errorCode: "buffer_tiktok_live_blocked",
        retryable: false,
      };
    }

    const scheduledFor = request.publication.scheduledFor;
    const mode: BufferCreateTikTokPostInput["mode"] =
      scheduledFor && new Date(scheduledFor).getTime() > Date.now() + 60_000
        ? "customScheduled"
        : "shareNow";

    try {
      const created = await bufferCreateTikTokPost(
        {
          channelId,
          text: composeSocialPublishCaption(request.content),
          schedulingType: "automatic",
          mode,
          dueAt: mode === "customScheduled" ? scheduledFor ?? undefined : undefined,
          media,
          photoTitle: media.kind === "image" ? request.content.title : null,
        },
        this.options.graphql,
      );

      return {
        ok: true,
        provider: this.id,
        externalId: created.postId,
        url: undefined,
        providerInteractionStarted: true,
        deferFinalPublishedState: true,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Buffer publish failed.";
      const retryable = error instanceof BufferGraphqlError ? error.retryable : false;
      return {
        ok: false,
        provider: this.id,
        error: message,
        errorCode: "buffer_publish_failed",
        retryable,
        providerInteractionStarted: true,
      };
    }
  }
}

export async function resolveTikTokPreflightMedia(
  store: MarketingStore,
  content: Parameters<typeof resolveContentImageUrl>[1],
): Promise<TikTokPublishMedia | null> {
  const assets = [];
  for (const assetId of content.assetIds) {
    const asset = await store.getAsset(assetId);
    if (asset) {
      assets.push({
        ...asset,
        url: resolvePublishableMarketingAssetUrl(asset, content.status),
      });
    }
  }
  const resolved = resolveTikTokPublishMedia(content, assets);
  if (!resolved.ok) return null;
  const kind = classifyTikTokAsset(assets.find((a) => a.url === resolved.media.publicUrl) ?? assets[0]!);
  return resolved.media;
}