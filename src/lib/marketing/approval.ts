import { estimatedAiCostUsd, getAIProvider } from "./ai";
import { resolveContentImageUrl } from "./assets";
import { regenerateContent } from "./content-engine";
import { isMockMode } from "./config";
import { isFreeResourceContent } from "./content-metadata";
import { formatPreflightError, runPublishPreflight } from "./publish-preflight";
import { inferPreferenceSignals } from "./preference-signals";
import { getEmailProvider, getSocialPublisher } from "./publishers";
import { revalidatePublishedFreeResourcePaths } from "./free-resource-cache";
import { isPublicationDue, resolveScheduleInstant } from "./marketing-scheduling";
import { getWebsiteFreeResourcePublisher } from "./website-free-resource-publisher";
import { logMarketing } from "./logger";
import { isPublicationEligibleForCronAutoRetry } from "./publication-cron-retry";
import {
  applyAmbiguousPublicationOutcome,
  applyConfirmedPublicationFailure,
  applySuccessfulPublication,
} from "./publication-ambiguity/apply-outcome";
import { handleProviderSuccessAfterLostFinalize } from "./publication-ambiguity/lost-claim-success";
import { classifyProviderPublishResult } from "./publication-ambiguity/classify";
import {
  isPublicationBlockedForAutomaticMetaRetry,
  isPublicationStaleProcessing,
} from "./publication-ambiguity/guards";
import { PublicationScheduleBlockedError } from "./publication-ambiguity/schedule-error";
import { isPublicationAmbiguityBlocked } from "./publication-ambiguity/types";
import {
  INSTAGRAM_PROVIDER_RECOVERY_MESSAGE,
  isInstagramProviderMediaRecoveryRequired,
} from "./publication-recovery-guard";
import { scanMarketingText } from "./safety";
import type { MarketingStore } from "./store";
import type { ContentStatus, MarketingContent, MarketingPublication } from "./types";
import type { PublishResult } from "./publishers";

const PUBLISHABLE_CONTENT_STATUSES = new Set<ContentStatus>([
  "approved",
  "scheduled",
  "published",
  "failed",
]);

export function contentMayBePublished(status: ContentStatus): boolean {
  return PUBLISHABLE_CONTENT_STATUSES.has(status);
}

async function recordCost(
  store: MarketingStore,
  input: {
    operation: string;
    provider: string;
    modelOrService?: string | null;
    estimatedCostUsd?: number;
    campaignId?: string | null;
    contentId?: string | null;
    success: boolean;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  },
) {
  return store.logOperation({
    id: crypto.randomUUID(),
    operation: input.operation,
    provider: input.provider,
    modelOrService: input.modelOrService ?? null,
    estimatedCostUsd: input.estimatedCostUsd ?? 0,
    campaignId: input.campaignId ?? null,
    contentId: input.contentId ?? null,
    success: input.success,
    durationMs: input.durationMs ?? null,
    metadata: input.metadata ?? {},
  });
}

export async function approveContent(
  store: MarketingStore,
  contentId: string,
  actor: string | null,
  feedback?: string,
) {
  const content = await store.getContent(contentId);
  if (!content) throw new Error("Content not found.");
  const updated = await store.updateContent(contentId, { status: "approved" });
  await store.addApproval({
    id: crypto.randomUUID(),
    contentId,
    action: "approve",
    actor,
    feedback: feedback ?? null,
    previousBody: content.body,
    newBody: content.body,
    preferenceSignals: [],
  });
  await store.recordEvent({
    id: crypto.randomUUID(),
    name: "content_approved",
    campaignId: content.campaignId,
    contentId,
    platform: content.platform,
    properties: {},
  });
  return updated;
}

export async function rejectContent(
  store: MarketingStore,
  contentId: string,
  actor: string | null,
  feedback?: string,
) {
  const content = await store.getContent(contentId);
  if (!content) throw new Error("Content not found.");
  const updated = await store.updateContent(contentId, { status: "rejected" });
  await store.addApproval({
    id: crypto.randomUUID(),
    contentId,
    action: "reject",
    actor,
    feedback: feedback ?? null,
    previousBody: content.body,
    newBody: content.body,
    preferenceSignals: feedback
      ? [{ category: "messaging", statement: feedback, strength: "signal" }]
      : [],
  });
  if (feedback) {
    await store.addPreference({
      id: crypto.randomUUID(),
      category: "messaging",
      statement: feedback,
      source: "inferred_rejection",
      strength: "signal",
      active: true,
      ownerConfirmed: false,
    });
  }
  await store.recordEvent({
    id: crypto.randomUUID(),
    name: "content_rejected",
    campaignId: content.campaignId,
    contentId,
    platform: content.platform,
    properties: {},
  });
  return updated;
}

export async function editContent(
  store: MarketingStore,
  contentId: string,
  body: string,
  actor: string | null,
) {
  const content = await store.getContent(contentId);
  if (!content) throw new Error("Content not found.");
  const signals = inferPreferenceSignals(content.originalBody ?? content.body, body);
  const flags = scanMarketingText(`${content.title ?? ""}\n${body}\n${content.cta ?? ""}`);
  const flagged = flags.some((flag) => flag.severity === "review_required");
  const nextStatus =
    flagged || content.status === "rejected" ? "needs_review" : content.status;
  const updated = await store.updateContent(contentId, {
    body,
    originalBody: content.originalBody ?? content.body,
    status: nextStatus,
    safetyFlags: flags,
    warnings: flags.map((flag) => flag.message),
  });
  await store.addApproval({
    id: crypto.randomUUID(),
    contentId,
    action: "edit",
    actor,
    feedback: null,
    previousBody: content.body,
    newBody: body,
    preferenceSignals: signals,
  });
  for (const signal of signals) {
    await store.addPreference({
      id: crypto.randomUUID(),
      category: signal.category,
      statement: signal.statement,
      source: "inferred_edit",
      strength: "signal",
      active: true,
      ownerConfirmed: false,
    });
  }
  await store.recordEvent({
    id: crypto.randomUUID(),
    name: "content_edited",
    campaignId: content.campaignId,
    contentId,
    platform: content.platform,
    properties: { signalCount: signals.length },
  });
  return { content: updated, signals };
}

export async function regenerateItem(
  store: MarketingStore,
  contentId: string,
  actor: string | null,
) {
  const content = await store.getContent(contentId);
  if (!content) throw new Error("Content not found.");
  const started = Date.now();
  const provider = getAIProvider();
  await provider.generateText({
    task: "regenerate_content",
    prompt: content.body,
    complexity: "simple",
    cacheKey: `regen:${content.id}:${content.body.length}`,
  });
  const updated = await regenerateContent(store, content);
  await store.addApproval({
    id: crypto.randomUUID(),
    contentId,
    action: "regenerate",
    actor,
    feedback: null,
    previousBody: content.body,
    newBody: updated.body,
    preferenceSignals: [],
  });
  await recordCost(store, {
    operation: "regenerate_content",
    provider: provider.id,
    modelOrService: "simple",
    estimatedCostUsd: estimatedAiCostUsd("simple"),
    campaignId: content.campaignId,
    contentId,
    success: true,
    durationMs: Date.now() - started,
  });
  return updated;
}

export async function approveAll(
  store: MarketingStore,
  weeklyPlanId: string,
  actor: string | null,
) {
  const items = await store.listContent({ weeklyPlanId, status: "needs_review" });
  const results = [];
  for (const item of items) {
    results.push(await approveContent(store, item.id, actor));
  }
  if (!items[0]) return results;
  await store.addApproval({
    id: crypto.randomUUID(),
    contentId: items[0].id,
    action: "approve_all",
    actor,
    feedback: null,
    previousBody: null,
    newBody: null,
    preferenceSignals: [],
  });
  return results;
}

export async function rejectAll(
  store: MarketingStore,
  weeklyPlanId: string,
  actor: string | null,
  feedback?: string,
) {
  const items = await store.listContent({ weeklyPlanId, status: "needs_review" });
  const results = [];
  for (const item of items) {
    results.push(await rejectContent(store, item.id, actor, feedback));
  }
  return results;
}

function idempotencyKey(content: MarketingContent) {
  return `pub:${content.id}:${content.platform}`;
}

function publicationProviderForContent(content: MarketingContent): string {
  if (isFreeResourceContent(content)) {
    return getWebsiteFreeResourcePublisher().id;
  }
  const providerId =
    content.platform === "email"
      ? getEmailProvider().id
      : getSocialPublisher(content.platform).id;
  return isMockMode() ? `mock:${providerId}` : providerId;
}

export async function scheduleApproved(
  store: MarketingStore,
  contentId: string,
  input?: { scheduledFor?: string | null },
) {
  const content = await store.getContent(contentId);
  if (!content) throw new Error("Content not found.");
  if (content.status !== "approved" && content.status !== "scheduled") {
    throw new Error("Only approved content can be scheduled.");
  }
  const preflight = await runPublishPreflight(store, content);
  if (!preflight.ok) {
    throw new Error(formatPreflightError(preflight));
  }
  const scheduledFor = resolveScheduleInstant(content, input?.scheduledFor);
  const key = idempotencyKey(content);
  const existing = await store.getPublicationByIdempotency(key);
  if (existing?.status === "published") {
    throw new Error(
      "This content was already published. Use recycle to schedule it again.",
    );
  }
  if (existing) {
    if (isInstagramProviderMediaRecoveryRequired(existing)) {
      throw new PublicationScheduleBlockedError(
        INSTAGRAM_PROVIDER_RECOVERY_MESSAGE,
        existing.id,
      );
    }
    if (
      existing.status === "processing" ||
      isPublicationAmbiguityBlocked(existing.ambiguityState)
    ) {
      throw new PublicationScheduleBlockedError(
        "Cannot reschedule a publication that is processing or has an ambiguous publish outcome.",
        existing.id,
      );
    }
    await store.updateContent(content.id, { status: "scheduled", scheduledFor });
    const updated =
      (await store.updatePublication(existing.id, {
        status: "scheduled",
        scheduledFor,
        lastError: null,
      })) ?? existing;
    return updated;
  }
  const publication = await store.createPublication({
    id: crypto.randomUUID(),
    contentId: content.id,
    campaignId: content.campaignId,
    platform: content.platform,
    provider: publicationProviderForContent(content),
    status: "scheduled",
    idempotencyKey: key,
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor,
    publishedAt: null,
  });
  await store.updateContent(content.id, { status: "scheduled", scheduledFor });
  return publication;
}

export async function publishPublication(
  store: MarketingStore,
  publication: MarketingPublication,
  options?: { simulateFailure?: boolean; allowExhaustedRetry?: boolean },
) {
  const content = await store.getContent(publication.contentId);
  if (!content) throw new Error("Content not found.");
  const fresh = (await store.getPublication(publication.id)) ?? publication;
  if (fresh.status === "published" && fresh.externalId) {
    return fresh;
  }
  if (fresh.externalId) {
    return fresh;
  }
  if (
    isPublicationBlockedForAutomaticMetaRetry(fresh) &&
    fresh.status !== "scheduled" &&
    fresh.status !== "failed" &&
    fresh.status !== "processing"
  ) {
    return fresh;
  }
  if (!contentMayBePublished(content.status)) {
    const message = "Content is not approved for publishing.";
    if (fresh.status === "processing" && fresh.claimToken) {
      if (publication.claimToken !== fresh.claimToken) {
        return fresh;
      }
      const updated = await applyConfirmedPublicationFailure(store, {
        publication: fresh,
        claimToken: fresh.claimToken,
        attemptCount: fresh.attemptCount + 1,
        lastError: message,
        cronAutoRetry: false,
        platform: content.platform,
        providerRetryable: false,
      });
      if (updated) {
        await store.updateContent(content.id, { status: "failed" });
      }
      return updated ?? fresh;
    }
    return (
      (await store.updatePublication(publication.id, {
        status: "failed",
        lastError: message,
      })) ?? publication
    );
  }

  let current = fresh;
  if (current.status === "scheduled" && !isPublicationDue(current.scheduledFor)) {
    return current;
  }
  if (isPublicationAmbiguityBlocked(current.ambiguityState)) {
    return current;
  }
  if (current.status === "scheduled" || current.status === "failed") {
    if (isPublicationBlockedForAutomaticMetaRetry(current)) {
      return current;
    }
    const claimed = await store.claimPublication(current.id, {
      allowExhaustedRetry: options?.allowExhaustedRetry,
    });
    if (!claimed) {
      return (await store.getPublication(current.id)) ?? current;
    }
    current = claimed;
  } else if (current.status === "processing") {
    if (!current.claimToken || publication.claimToken !== current.claimToken) {
      if (isPublicationStaleProcessing(current)) {
        const marked = await store.markStaleProcessingOwnerRequired(current.id);
        if (marked) {
          void import("./publication-ambiguity/notify").then(({ notifyPublicationAmbiguousOutcome }) =>
            notifyPublicationAmbiguousOutcome(marked, "Processing claim expired or was superseded."),
          );
        }
      }
      return (await store.getPublication(current.id)) ?? current;
    }
    current = (await store.getPublication(current.id)) ?? current;
    if (!current.claimToken || current.claimToken !== publication.claimToken) {
      return current;
    }
  } else {
    return current;
  }

  const claimToken = current.claimToken;
  if (!claimToken) {
    return current;
  }

  const preflight = await runPublishPreflight(store, content);
  if (!preflight.ok) {
    const attemptCount = current.attemptCount + 1;
    const message = formatPreflightError(preflight);
    const updated = await applyConfirmedPublicationFailure(store, {
      publication: current,
      claimToken,
      attemptCount,
      lastError: message,
      cronAutoRetry: false,
      platform: content.platform,
      providerRetryable: false,
    });
    if (updated) {
      await store.updateContent(content.id, { status: "failed" });
    }
    return updated ?? current;
  }

  const isMetaPlatform = content.platform === "instagram" || content.platform === "facebook";
  if (isMetaPlatform || content.platform === "pinterest") {
    const entered = await store.tryBeginProviderPublish({
      id: current.id,
      claimToken,
    });
    if (!entered) {
      return (await store.getPublication(current.id)) ?? current;
    }
    current = (await store.getPublication(current.id)) ?? current;
  }

  const started = Date.now();
  const social = getSocialPublisher(content.platform);
  const email = getEmailProvider();
  const imageUrl = preflight.imageUrl ?? (await resolveContentImageUrl(store, content));
  const publishRequest = {
    content,
    publication: current,
    imageUrl,
    simulateFailure: options?.simulateFailure,
    hooks: content.platform === "instagram"
      ? {
          onProviderCreationId: async (creationId: string) =>
            store.persistProviderCreationId({
              id: current.id,
              claimToken,
              providerCreationId: creationId,
            }),
        }
      : undefined,
  };
  const result: PublishResult = isFreeResourceContent(content)
    ? await getWebsiteFreeResourcePublisher().publish(publishRequest, store)
    : content.platform === "email"
      ? await email.send(publishRequest)
      : await social.publish(publishRequest);
  current = (await store.getPublication(current.id)) ?? current;
  const providerInteractionStarted = Boolean(result.providerInteractionStarted);

  const attemptCount = current.attemptCount + 1;
  if (result.ok) {
    const updated = await applySuccessfulPublication(store, {
      publication: current,
      claimToken,
      attemptCount,
      externalId: result.externalId ?? publication.externalId,
      url: result.url ?? publication.url,
      publishedAt: new Date().toISOString(),
    });
    if (!updated) {
      const lostClaimOutcome = await handleProviderSuccessAfterLostFinalize(store, {
        publication: current,
        claimToken,
        attemptCount,
        result,
        publishedAt: new Date().toISOString(),
      });
      if (lostClaimOutcome.status === "published") {
        await store.updateContent(content.id, { status: "published" });
      }
      return lostClaimOutcome;
    }
    await store.updateContent(content.id, { status: "published" });
    await store.recordEvent({
      id: crypto.randomUUID(),
      name: "content_published",
      campaignId: content.campaignId,
      contentId: content.id,
      platform: content.platform,
      properties: { provider: result.provider },
    });
    await recordCost(store, {
      operation: "publish",
      provider: result.provider,
      estimatedCostUsd: 0,
      campaignId: content.campaignId,
      contentId: content.id,
      success: true,
      durationMs: Date.now() - started,
    });
    logMarketing({
      operation: "publish",
      campaignId: content.campaignId,
      contentId: content.id,
      provider: result.provider,
      success: true,
      durationMs: Date.now() - started,
    });
    if (isFreeResourceContent(content)) {
      const slug = content.metadata.slug;
      if (!slug?.trim()) {
        logMarketing({
          operation: "revalidate_free_resource_cache",
          contentId: content.id,
          success: false,
          error: "Missing metadata.slug; detail path not revalidated",
        });
      }
      revalidatePublishedFreeResourcePaths(slug ?? "");
    }
    return updated;
  }

  const outcome = classifyProviderPublishResult(result, { providerInteractionStarted });
  const retryable = Boolean(result.retryable && attemptCount < 3);
  let updated: MarketingPublication | null;
  if (outcome === "ambiguous") {
    updated = await applyAmbiguousPublicationOutcome(store, {
      publication: current,
      claimToken,
      attemptCount,
      lastError: result.error ?? "Publish failed with ambiguous outcome.",
      ownerRequired: isPublicationStaleProcessing(current),
      notifyDetail: result.error,
    });
  } else {
    updated = await applyConfirmedPublicationFailure(store, {
      publication: current,
      claimToken,
      attemptCount,
      lastError: result.error ?? "Publish failed",
      cronAutoRetry: Boolean(result.retryable),
      platform: content.platform,
      providerRetryable: Boolean(result.retryable),
    });
  }
  if (!updated) {
    return (await store.getPublication(current.id)) ?? current;
  }
  await store.updateContent(content.id, { status: "failed" });
  await store.recordEvent({
    id: crypto.randomUUID(),
    name: "content_failed",
    campaignId: content.campaignId,
    contentId: content.id,
    platform: content.platform,
    properties: { error: result.error ?? "unknown", retryable, outcome },
  });
  logMarketing({
    operation: "publish",
    campaignId: content.campaignId,
    contentId: content.id,
    provider: result.provider,
    success: false,
    durationMs: Date.now() - started,
    error: result.error,
  });
  return updated;
}

export async function retryPublication(
  store: MarketingStore,
  publicationId: string,
  options?: { allowExhaustedRetry?: boolean },
) {
  const publication = await store.getPublication(publicationId);
  if (!publication) throw new Error("Publication not found.");
  if (publication.status === "published") return publication;
  return publishPublication(store, publication, options);
}

export async function publishDue(store: MarketingStore, now = new Date()) {
  const due = (await store.listPublications("scheduled")).filter((item) => {
    if (!item.scheduledFor) return true;
    return new Date(item.scheduledFor).getTime() <= now.getTime();
  });
  const failedRetry = (await store.listPublications("failed")).filter(
    (item) =>
      item.attemptCount < 3 &&
      isPublicationEligibleForCronAutoRetry(item.lastError, item) &&
      !isPublicationBlockedForAutomaticMetaRetry(item),
  );
  const results = [];
  for (const item of [...due, ...failedRetry]) {
    results.push(await publishPublication(store, item));
  }
  return results;
}
