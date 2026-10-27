import { composePublishCaption } from "./meta";
import {
  createPinterestPin,
  getPinterestAccessToken,
  getPinterestCredentials,
  pinterestPinPublicUrl,
  truncatePinterestDescription,
  truncatePinterestTitle,
  type PinterestCredentials,
} from "./pinterest";
import type { PublishRequest, PublishResult, SocialPublisher } from "./publishers";
import { buildPublishTrackingLink } from "./tracking";
import { resolvePrimaryImageAltText } from "./pinterest-content";

type PinterestPublisherOptions = {
  fetch?: typeof fetch;
  credentials?: PinterestCredentials | null;
};

function alreadyPublished(request: PublishRequest, provider: string): PublishResult | null {
  if (request.publication.externalId) {
    return {
      ok: true,
      provider,
      externalId: request.publication.externalId,
      url: request.publication.url ?? pinterestPinPublicUrl(request.publication.externalId),
      errorCode: "pinterest_already_published",
    };
  }
  return null;
}

export class PinterestPublisher implements SocialPublisher {
  id = "pinterest";

  constructor(private readonly options: PinterestPublisherOptions = {}) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    const replay = alreadyPublished(request, this.id);
    if (replay) return replay;

    const credentials =
      this.options.credentials === undefined
        ? getPinterestCredentials()
        : this.options.credentials;
    if (!credentials) {
      return {
        ok: false,
        provider: this.id,
        error:
          "pinterest_credentials_missing: Set PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET, PINTEREST_REFRESH_TOKEN, and PINTEREST_BOARD_ID.",
        errorCode: "pinterest_credentials_missing",
        retryable: false,
      };
    }

    const imageUrl = request.imageUrl?.trim();
    if (!imageUrl) {
      return {
        ok: false,
        provider: this.id,
        error: "pinterest_invalid_request: No publishable image URL is attached.",
        errorCode: "pinterest_invalid_request",
        retryable: false,
      };
    }

    const link = buildPublishTrackingLink(request.content);
    if (!link) {
      return {
        ok: false,
        provider: this.id,
        error: "pinterest_invalid_request: Pinterest pin requires a tracking link (trackingToken).",
        errorCode: "pinterest_invalid_request",
        retryable: false,
      };
    }

    const fetchImpl = this.options.fetch ?? fetch;
    const tokenResult = await getPinterestAccessToken(credentials, fetchImpl);
    if (!tokenResult.ok) {
      return {
        ok: false,
        provider: this.id,
        error: tokenResult.error,
        errorCode: tokenResult.errorCode,
        retryable: tokenResult.retryable,
      };
    }

    const title = truncatePinterestTitle(request.content.title ?? request.content.body.split("\n")[0] ?? "Pin");
    const description = truncatePinterestDescription(
      composePublishCaption(request.content.body, request.content.cta),
    );
    const altText = resolvePrimaryImageAltText(request.content);

    const created = await createPinterestPin(tokenResult.data, {
      boardId: credentials.boardId,
      boardSectionId: credentials.boardSectionId,
      title,
      description,
      link,
      altText,
      imageUrl,
    }, fetchImpl);

    if (!created.ok) {
      return {
        ok: false,
        provider: this.id,
        error: created.error,
        errorCode: created.errorCode,
        retryable: created.retryable,
      };
    }

    const pinId = created.data.id!;
    return {
      ok: true,
      provider: this.id,
      externalId: pinId,
      url: created.data.link ?? pinterestPinPublicUrl(pinId),
    };
  }
}
