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

const ADMIN_RETRY_PLATFORMS = new Set<Platform>(["instagram", "facebook", "pinterest"]);

function adminRetryEligibleStatus(platform: Platform, status: MarketingPublication["status"]): boolean {
  if (platform === "instagram") {
    return status === "failed";
  }
  if (platform === "facebook") {
    return status === "scheduled" || status === "failed";
  }
  if (platform === "pinterest") {
    return status === "scheduled" || status === "failed";
  }
  return false;
}

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

/** Admin-only single-publication retry for Instagram and Facebook. */
export async function retryAdminPublication(
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

  if (!ADMIN_RETRY_PLATFORMS.has(publication.platform)) {
    return {
      status: 400,
      body: {
        success: false,
        publicationId,
        platform: publication.platform,
        status: publication.status,
        error: {
          code: "unsupported_platform",
          message:
            "Only Instagram, Facebook, and Pinterest publications can be retried through this endpoint.",
        },
      },
    };
  }

  if (!adminRetryEligibleStatus(publication.platform, publication.status)) {
    return {
      status: 400,
      body: {
        success: false,
        publicationId,
        platform: publication.platform,
        status: publication.status,
        error: {
          code: "invalid_publication_status",
          message:
            publication.platform === "instagram"
              ? "Only publications with status failed can be retried."
              : publication.platform === "facebook"
                ? "Only scheduled or failed Facebook publications can be retried."
                : "Only scheduled or failed Pinterest publications can be retried.",
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

  const result = await retryPublication(store, publicationId, {
    allowExhaustedRetry: publication.platform === "instagram",
  });

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

/** @deprecated Use retryAdminPublication */
export const retryFailedInstagramPublication = retryAdminPublication;
