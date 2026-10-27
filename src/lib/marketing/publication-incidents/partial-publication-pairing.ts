import type { MarketingContent, MarketingPublication, Platform } from "../types";
import { evaluatePublicationFailedCapture } from "./publication-failed-eligibility";
import { parsePublicationErrorClass } from "./evidence";
const PARTIAL_PLATFORMS = new Set<Platform>(["facebook", "instagram"]);

export function canonicalPublicationIdempotencyKey(
  contentId: string,
  platform: Platform,
): string {
  return `pub:${contentId}:${platform}`;
}

export function isCanonicalMarketingPublication(
  publication: Pick<MarketingPublication, "contentId" | "platform" | "idempotencyKey">,
): boolean {
  return (
    publication.idempotencyKey ===
    canonicalPublicationIdempotencyKey(publication.contentId, publication.platform)
  );
}

function smartUploadBatchId(content: MarketingContent): string | null {
  if (content.metadata?.source !== "smart_upload") return null;
  const batchId = content.metadata.batchId?.trim();
  return batchId || null;
}

export type PartialPublicationPairSuccess = {
  batchId: string;
  finalizeKey: string | null;
  failedPublication: MarketingPublication;
  failedContent: MarketingContent;
  publishedPublication: MarketingPublication;
  publishedContent: MarketingContent;
  intentSignals: string[];
};

export type PartialPublicationPairEvaluation =
  | { ok: true; pair: PartialPublicationPairSuccess }
  | { ok: false; reason: string; diagnostics?: Record<string, unknown> };

function contentScheduleAligned(
  content: MarketingContent,
  publication: MarketingPublication,
): boolean {
  if (!publication.scheduledFor || !content.scheduledFor) return false;
  return content.scheduledFor === publication.scheduledFor;
}

function resolveBatchContents(
  failedContent: MarketingContent,
  allContent: MarketingContent[],
  batchId: string,
): { facebook?: MarketingContent; instagram?: MarketingContent } | { error: string } {
  const matches = allContent.filter(
    (row) =>
      row.metadata?.source === "smart_upload" &&
      row.metadata.batchId === batchId &&
      PARTIAL_PLATFORMS.has(row.platform),
  );
  const facebook = matches.filter((row) => row.platform === "facebook");
  const instagram = matches.filter((row) => row.platform === "instagram");
  if (facebook.length !== 1 || instagram.length !== 1) {
    return {
      error: "batch_platform_cardinality",
    };
  }
  return { facebook: facebook[0], instagram: instagram[0] };
}

export function evaluatePartialPublicationPair(input: {
  failedPublication: MarketingPublication;
  failedContent: MarketingContent;
  allContent: MarketingContent[];
  publishedPublication: MarketingPublication;
  publishedContent: MarketingContent;
}): PartialPublicationPairEvaluation {
  const diagnostics: Record<string, unknown> = {
    failed_publication_id: input.failedPublication.id,
    published_publication_id: input.publishedPublication.id,
  };

  if (!PARTIAL_PLATFORMS.has(input.failedPublication.platform)) {
    return { ok: false, reason: "platform_scope", diagnostics };
  }
  if (!PARTIAL_PLATFORMS.has(input.publishedPublication.platform)) {
    return { ok: false, reason: "platform_scope", diagnostics };
  }
  if (input.failedPublication.platform === input.publishedPublication.platform) {
    return { ok: false, reason: "same_platform", diagnostics };
  }

  if (input.failedPublication.status !== "failed") {
    return { ok: false, reason: "failed_not_terminal", diagnostics };
  }
  if (input.publishedPublication.status !== "published") {
    return { ok: false, reason: "counterpart_not_published", diagnostics };
  }

  if (!isCanonicalMarketingPublication(input.failedPublication)) {
    return { ok: false, reason: "failed_not_canonical_publication", diagnostics };
  }
  if (!isCanonicalMarketingPublication(input.publishedPublication)) {
    return { ok: false, reason: "published_not_canonical_publication", diagnostics };
  }

  const capture = evaluatePublicationFailedCapture(input.failedPublication);
  if (!capture.capture) {
    return { ok: false, reason: capture.reason, diagnostics };
  }

  const batchId = smartUploadBatchId(input.failedContent);
  if (!batchId) {
    return { ok: false, reason: "missing_smart_upload_batch", diagnostics };
  }
  const peerBatchId = smartUploadBatchId(input.publishedContent);
  if (peerBatchId !== batchId) {
    return { ok: false, reason: "batch_mismatch", diagnostics };
  }

  const batchContents = resolveBatchContents(input.failedContent, input.allContent, batchId);
  if ("error" in batchContents) {
    return { ok: false, reason: batchContents.error, diagnostics };
  }

  const expectedFb = batchContents.facebook!;
  const expectedIg = batchContents.instagram!;
  if (
    input.failedContent.id !== expectedFb.id &&
    input.failedContent.id !== expectedIg.id
  ) {
    return { ok: false, reason: "failed_content_not_in_batch", diagnostics };
  }
  if (
    input.publishedContent.id !== expectedFb.id &&
    input.publishedContent.id !== expectedIg.id
  ) {
    return { ok: false, reason: "published_content_not_in_batch", diagnostics };
  }

  const scheduledFor = input.failedPublication.scheduledFor;
  const publishedScheduledFor = input.publishedPublication.scheduledFor;
  if (!scheduledFor || !publishedScheduledFor) {
    return { ok: false, reason: "scheduled_for_null", diagnostics };
  }
  if (scheduledFor !== publishedScheduledFor) {
    return { ok: false, reason: "scheduled_for_mismatch", diagnostics };
  }

  if (!contentScheduleAligned(input.failedContent, input.failedPublication)) {
    return { ok: false, reason: "failed_content_schedule_stale", diagnostics };
  }
  if (!contentScheduleAligned(input.publishedContent, input.publishedPublication)) {
    return { ok: false, reason: "published_content_schedule_stale", diagnostics };
  }

  if (input.failedContent.status !== "failed") {
    return { ok: false, reason: "failed_content_status", diagnostics };
  }
  if (input.publishedContent.status !== "published") {
    return { ok: false, reason: "published_content_status", diagnostics };
  }

  const intentSignals = [
    "smart_upload_batch_id",
    "canonical_publication_rows",
    "equal_non_null_scheduled_for",
    "counterpart_published_terminal",
    "failed_actionable_capture",
  ];

  return {
    ok: true,
    pair: {
      batchId,
      finalizeKey: input.failedContent.metadata.smartUploadFinalizeKey?.trim() ?? null,
      failedPublication: input.failedPublication,
      failedContent: input.failedContent,
      publishedPublication: input.publishedPublication,
      publishedContent: input.publishedContent,
      intentSignals,
    },
  };
}

export function evaluatePartialPublicationPairFromFailed(input: {
  failedPublication: MarketingPublication;
  failedContent: MarketingContent;
  allContent: MarketingContent[];
  publishedPublication: MarketingPublication | null;
  publishedContent: MarketingContent | null;
}): PartialPublicationPairEvaluation {
  if (!input.publishedPublication || !input.publishedContent) {
    return {
      ok: false,
      reason: "missing_counterpart_publication",
      diagnostics: { failed_publication_id: input.failedPublication.id },
    };
  }
  return evaluatePartialPublicationPair({
    failedPublication: input.failedPublication,
    failedContent: input.failedContent,
    allContent: input.allContent,
    publishedPublication: input.publishedPublication,
    publishedContent: input.publishedContent,
  });
}

export function partialPublicationFailureErrorClass(
  failedPublication: MarketingPublication,
): string {
  return parsePublicationErrorClass(failedPublication.lastError);
}
