import { retryPublication } from "./approval";
import { formatPreflightError, runPublishPreflight } from "./publish-preflight";
import type { MarketingStore } from "./store";
import type { MarketingPublication, Platform } from "./types";

export type PublicationRetryErrorBody = {
  code: string;
  message: string;
};

export type PublicationRetryResponseBody = {
  success: boolean;
  publicationId: string;
  platform?: Platform;
  status?: MarketingPublication["status"];
  attempt_count?: number;
  external_id?: string | null;
  error?: PublicationRetryErrorBody;
  preflight?: PublicationRetryErrorBody;
};

export type PublicationRetryResult = {
  status: number;
  body: PublicationRetryResponseBody;
};

function parseWorkflowError(lastError: string | null | undefined): PublicationRetryErrorBody {
  const raw = lastError?.trim() ?? "";
  if (!raw) {
    return { code: "publish_failed", message: "Publish failed." };
  }
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const code = raw.slice(0, colon).trim();
    const message = raw.slice(colon + 1).trim();
    if (code && message) return { code, message };
  }
  return { code: "publish_failed", message: raw };
}

/** Retries one failed Instagram publication (single-id path only). */
export async function retryFailedInstagramPublication(
  store: MarketingStore,
  publicationId: string,
): Promise<PublicationRetryResult> {
  const publication = await store.getPublication(publicationId);
  if (!publication) {
    return {
      status: 404,
      body: {
        success: false,
        publicationId,
        error: { code: "publication_not_found", message: "Publication not found." },
      },
    };
  }

  if (publication.platform !== "instagram") {
    return {
      status: 400,
      body: {
        success: false,
        publicationId,
        platform: publication.platform,
        status: publication.status,
        error: {
          code: "unsupported_platform",
          message: "Only failed Instagram publications can be retried through this endpoint.",
        },
      },
    };
  }

  if (publication.status !== "failed") {
    return {
      status: 400,
      body: {
        success: false,
        publicationId,
        platform: publication.platform,
        status: publication.status,
        error: {
          code: "invalid_publication_status",
          message: "Only publications with status failed can be retried.",
        },
      },
    };
  }

  const content = await store.getContent(publication.contentId);
  if (!content) {
    return {
      status: 404,
      body: {
        success: false,
        publicationId,
        platform: publication.platform,
        error: { code: "content_not_found", message: "Associated content was not found." },
      },
    };
  }

  const preflight = await runPublishPreflight(store, content);
  if (!preflight.ok) {
    return {
      status: 422,
      body: {
        success: false,
        publicationId,
        platform: publication.platform,
        status: publication.status,
        attempt_count: publication.attemptCount,
        external_id: publication.externalId,
        preflight: {
          code: preflight.code,
          message: preflight.message,
        },
        error: {
          code: preflight.code,
          message: formatPreflightError(preflight),
        },
      },
    };
  }

  const result = await retryPublication(store, publicationId);

  const published = result.status === "published";
  return {
    status: 200,
    body: {
      success: published,
      publicationId: result.id,
      platform: result.platform,
      status: result.status,
      attempt_count: result.attemptCount,
      external_id: result.externalId,
      ...(published
        ? {}
        : { error: parseWorkflowError(result.lastError) }),
    },
  };
}
