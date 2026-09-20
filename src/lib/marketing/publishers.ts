import {
  getBufferToken,
  getMetaFacebookCredentials,
  getMetaInstagramCredentials,
  isMockMode,
  type MetaFacebookCredentials,
  type MetaInstagramCredentials,
} from "./config";
import {
  buildMetaGraphUrl,
  composePublishCaption,
  postMetaForm,
  publicImageUrlError,
  waitForInstagramContainerReady,
  type MetaErrorCode,
} from "./meta";
import type { MarketingContent, MarketingPublication, Platform } from "./types";

export type PublishRequest = {
  content: MarketingContent;
  publication: MarketingPublication;
  imageUrl?: string | null;
  simulateFailure?: boolean;
};

export type PublishResult = {
  ok: boolean;
  provider: string;
  externalId?: string;
  url?: string;
  error?: string;
  errorCode?: MetaErrorCode | string;
  retryable?: boolean;
};

export interface SocialPublisher {
  id: string;
  publish(request: PublishRequest): Promise<PublishResult>;
}

export interface EmailProvider {
  id: string;
  send(request: PublishRequest): Promise<PublishResult>;
}

export interface ImageProvider {
  id: string;
  generate(prompt: string): Promise<{ ok: boolean; url?: string; error?: string }>;
}

type GraphPublisherOptions<T> = {
  fetch?: typeof fetch;
  credentials?: T | null;
  sleep?: (ms: number) => Promise<void>;
};

function alreadyPublished(request: PublishRequest, provider: string): PublishResult | null {
  if (request.publication.externalId && request.publication.status === "published") {
    return {
      ok: true,
      provider,
      externalId: request.publication.externalId,
      url: request.publication.url ?? undefined,
      errorCode: "meta_already_published",
    };
  }
  if (request.publication.externalId) {
    return {
      ok: true,
      provider,
      externalId: request.publication.externalId,
      url: request.publication.url ?? undefined,
      errorCode: "meta_already_published",
    };
  }
  return null;
}

export class MockSocialPublisher implements SocialPublisher {
  id = "mock_social";

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (request.simulateFailure || request.content.body.includes("[simulate-failure]")) {
      return {
        ok: false,
        provider: this.id,
        error: "Mock publisher simulated a transient failure.",
        retryable: true,
      };
    }
    return {
      ok: true,
      provider: this.id,
      externalId: `mock_${request.publication.idempotencyKey}`,
      url: `https://mock.local/${request.content.platform}/${request.content.id}`,
    };
  }
}

export class BufferPublisher implements SocialPublisher {
  id = "buffer";

  async publish(request: PublishRequest): Promise<PublishResult> {
    void request;
    const token = getBufferToken();
    if (!token) {
      return {
        ok: false,
        provider: this.id,
        error: "BUFFER_ACCESS_TOKEN is not configured.",
        retryable: false,
      };
    }
    return {
      ok: false,
      provider: this.id,
      error:
        "BufferPublisher is unused. Instagram and Facebook publish through native Meta publishers.",
      retryable: false,
    };
  }
}

export class InstagramPublisher implements SocialPublisher {
  id = "instagram";

  constructor(private readonly options: GraphPublisherOptions<MetaInstagramCredentials> = {}) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    const replay = alreadyPublished(request, this.id);
    if (replay) return replay;

    const credentials =
      this.options.credentials === undefined
        ? getMetaInstagramCredentials()
        : this.options.credentials;
    if (!credentials) {
      return {
        ok: false,
        provider: this.id,
        error:
          "meta_credentials_missing: Set META_INSTAGRAM_USER_ID and META_INSTAGRAM_ACCESS_TOKEN.",
        errorCode: "meta_credentials_missing",
        retryable: false,
      };
    }

    const imageError = publicImageUrlError(request.imageUrl);
    if (imageError) {
      const errorCode = request.imageUrl ? "meta_image_inaccessible" : "meta_image_missing";
      return {
        ok: false,
        provider: this.id,
        error: `${errorCode}: ${imageError}`,
        errorCode,
        retryable: false,
      };
    }

    const fetchImpl = this.options.fetch ?? fetch;
    const secrets = [credentials.accessToken];
    const caption = composePublishCaption(request.content.body, request.content.cta);
    const mediaUrl = buildMetaGraphUrl(
      "https://graph.instagram.com",
      credentials.graphVersion,
      `/${credentials.userId}/media`,
    );
    const container = await postMetaForm<{ id?: string }>(
      mediaUrl,
      {
        image_url: request.imageUrl!,
        caption,
        access_token: credentials.accessToken,
      },
      secrets,
      fetchImpl,
    );
    if (!container.ok) {
      return {
        ok: false,
        provider: this.id,
        error: container.error,
        errorCode: container.errorCode,
        retryable: container.retryable,
      };
    }
    if (!container.data.id) {
      return {
        ok: false,
        provider: this.id,
        error: "meta_malformed_response: Instagram media container response did not include id.",
        errorCode: "meta_malformed_response",
        retryable: false,
      };
    }

    const ready = await waitForInstagramContainerReady({
      containerId: container.data.id,
      graphVersion: credentials.graphVersion,
      accessToken: credentials.accessToken,
      fetchImpl,
      sleep: this.options.sleep,
      secrets,
    });
    if (!ready.ok) {
      return {
        ok: false,
        provider: this.id,
        error: ready.error,
        errorCode: ready.errorCode,
        retryable: ready.retryable,
      };
    }

    const publishUrl = buildMetaGraphUrl(
      "https://graph.instagram.com",
      credentials.graphVersion,
      `/${credentials.userId}/media_publish`,
    );
    const published = await postMetaForm<{ id?: string }>(
      publishUrl,
      {
        creation_id: container.data.id,
        access_token: credentials.accessToken,
      },
      secrets,
      fetchImpl,
    );
    if (!published.ok) {
      return {
        ok: false,
        provider: this.id,
        error: published.error,
        errorCode: published.errorCode,
        retryable: published.retryable,
      };
    }
    if (!published.data.id) {
      return {
        ok: false,
        provider: this.id,
        error: "meta_malformed_response: Instagram media_publish response did not include id.",
        errorCode: "meta_malformed_response",
        retryable: false,
      };
    }

    return {
      ok: true,
      provider: this.id,
      externalId: published.data.id,
    };
  }
}

export class FacebookPagePublisher implements SocialPublisher {
  id = "facebook_page";

  constructor(private readonly options: GraphPublisherOptions<MetaFacebookCredentials> = {}) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    const replay = alreadyPublished(request, this.id);
    if (replay) return replay;

    const credentials =
      this.options.credentials === undefined
        ? getMetaFacebookCredentials()
        : this.options.credentials;
    if (!credentials) {
      return {
        ok: false,
        provider: this.id,
        error:
          "meta_credentials_missing: Set META_FACEBOOK_PAGE_ID and META_FACEBOOK_PAGE_ACCESS_TOKEN.",
        errorCode: "meta_credentials_missing",
        retryable: false,
      };
    }

    const fetchImpl = this.options.fetch ?? fetch;
    const secrets = [credentials.pageAccessToken];
    const caption = composePublishCaption(request.content.body, request.content.cta);

    if (request.imageUrl) {
      const imageError = publicImageUrlError(request.imageUrl);
      if (imageError) {
        return {
          ok: false,
          provider: this.id,
          error: `meta_image_inaccessible: ${imageError}`,
          errorCode: "meta_image_inaccessible",
          retryable: false,
        };
      }
      const photoUrl = buildMetaGraphUrl(
        "https://graph.facebook.com",
        credentials.graphVersion,
        `/${credentials.pageId}/photos`,
      );
      const photo = await postMetaForm<{ id?: string; post_id?: string }>(
        photoUrl,
        {
          url: request.imageUrl,
          caption,
          published: "true",
          access_token: credentials.pageAccessToken,
        },
        secrets,
        fetchImpl,
      );
      if (!photo.ok) {
        return {
          ok: false,
          provider: this.id,
          error: photo.error,
          errorCode: photo.errorCode,
          retryable: photo.retryable,
        };
      }
      const externalId = photo.data.post_id || photo.data.id;
      if (!externalId) {
        return {
          ok: false,
          provider: this.id,
          error: "meta_malformed_response: Facebook photo response did not include id.",
          errorCode: "meta_malformed_response",
          retryable: false,
        };
      }
      return {
        ok: true,
        provider: this.id,
        externalId,
        url: `https://www.facebook.com/${externalId}`,
      };
    }

    const feedUrl = buildMetaGraphUrl(
      "https://graph.facebook.com",
      credentials.graphVersion,
      `/${credentials.pageId}/feed`,
    );
    const feed = await postMetaForm<{ id?: string }>(
      feedUrl,
      {
        message: caption,
        access_token: credentials.pageAccessToken,
      },
      secrets,
      fetchImpl,
    );
    if (!feed.ok) {
      return {
        ok: false,
        provider: this.id,
        error: feed.error,
        errorCode: feed.errorCode,
        retryable: feed.retryable,
      };
    }
    if (!feed.data.id) {
      return {
        ok: false,
        provider: this.id,
        error: "meta_malformed_response: Facebook feed response did not include id.",
        errorCode: "meta_malformed_response",
        retryable: false,
      };
    }
    return {
      ok: true,
      provider: this.id,
      externalId: feed.data.id,
      url: `https://www.facebook.com/${feed.data.id}`,
    };
  }
}

export class MockEmailProvider implements EmailProvider {
  id = "mock_email";

  async send(request: PublishRequest): Promise<PublishResult> {
    if (request.simulateFailure) {
      return {
        ok: false,
        provider: this.id,
        error: "Mock email provider simulated a send failure.",
        retryable: true,
      };
    }
    return {
      ok: true,
      provider: this.id,
      externalId: `mock_email_${request.publication.idempotencyKey}`,
      url: `https://mock.local/email/${request.content.id}`,
    };
  }
}

export class ResendEmailProvider implements EmailProvider {
  id = "resend";

  async send(request: PublishRequest): Promise<PublishResult> {
    void request;
    const key = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM_EMAIL?.trim();
    if (!key || !from) {
      return {
        ok: false,
        provider: this.id,
        error: "Resend is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL).",
        retryable: false,
      };
    }
    return {
      ok: false,
      provider: this.id,
      error:
        "Live newsletter campaign sending is intentionally not wired in V1. Use mock email or Resend's audience tools until a campaign provider is chosen.",
      retryable: false,
    };
  }
}

export class MockImageProvider implements ImageProvider {
  id = "mock_image";

  async generate(): Promise<{ ok: boolean; url?: string; error?: string }> {
    return {
      ok: false,
      error:
        "Image generation skipped. Reuse an approved catalog asset or upload a human-provided asset.",
    };
  }
}

export function getSocialPublisher(platform?: Platform): SocialPublisher {
  if (isMockMode()) return new MockSocialPublisher();
  if (platform === "instagram") return new InstagramPublisher();
  if (platform === "facebook") return new FacebookPagePublisher();
  return new MockSocialPublisher();
}

export function getEmailProvider(): EmailProvider {
  if (isMockMode()) return new MockEmailProvider();
  if (process.env.RESEND_API_KEY) return new ResendEmailProvider();
  return new MockEmailProvider();
}

export function getImageProvider(): ImageProvider {
  return new MockImageProvider();
}

export function publisherFor(platform: MarketingContent["platform"]) {
  if (platform === "email") return getEmailProvider();
  return getSocialPublisher(platform);
}
