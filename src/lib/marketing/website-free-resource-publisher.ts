import { absoluteUrl } from "@/lib/site";
import { freeResourcePublicPath } from "./content-metadata";
import type { PublishRequest, PublishResult } from "./publishers";
import type { MarketingStore } from "./store";

export class WebsiteFreeResourcePublisher {
  id = "website_free_resources";

  async publish(
    request: PublishRequest,
    store: MarketingStore,
  ): Promise<PublishResult> {
    const slug = request.content.metadata.slug;
    if (!slug?.trim()) {
      return {
        ok: false,
        provider: this.id,
        error: "free_resource_missing_slug: Resource slug is required before publishing.",
        retryable: false,
      };
    }
    const publicPath = freeResourcePublicPath(slug);
    const publishedAt = new Date().toISOString();
    await store.updateContent(request.content.id, {
      status: "published",
      metadata: {
        ...request.content.metadata,
        resourcePublishedAt: publishedAt,
      },
    });
    await store.recordEvent({
      id: crypto.randomUUID(),
      name: "resource_published",
      campaignId: request.content.campaignId,
      contentId: request.content.id,
      platform: "website",
      properties: { slug, publicPath },
    });
    return {
      ok: true,
      provider: this.id,
      externalId: slug,
      url: absoluteUrl(publicPath),
    };
  }
}

let singleton: WebsiteFreeResourcePublisher | null = null;

export function getWebsiteFreeResourcePublisher(): WebsiteFreeResourcePublisher {
  singleton ??= new WebsiteFreeResourcePublisher();
  return singleton;
}
