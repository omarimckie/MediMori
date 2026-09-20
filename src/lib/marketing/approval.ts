import { estimatedAiCostUsd, getAIProvider } from "./ai";
import { resolveContentImageUrl } from "./assets";
import { regenerateContent } from "./content-engine";
import { isMockMode } from "./config";
import { inferPreferenceSignals } from "./preference-signals";
import { getEmailProvider, getSocialPublisher } from "./publishers";
import { logMarketing } from "./logger";
import { scanMarketingText } from "./safety";
import type { MarketingStore } from "./store";
import type { ContentStatus, MarketingContent, MarketingPublication } from "./types";

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

export async function scheduleApproved(
  store: MarketingStore,
  contentId: string,
) {
  const content = await store.getContent(contentId);
  if (!content) throw new Error("Content not found.");
  if (content.status !== "approved" && content.status !== "scheduled") {
    throw new Error("Only approved content can be scheduled.");
  }
  const key = idempotencyKey(content);
  const existing = await store.getPublicationByIdempotency(key);
  if (existing) return existing;
  const provider =
    content.platform === "email"
      ? getEmailProvider().id
      : getSocialPublisher(content.platform).id;
  const publication = await store.createPublication({
    id: crypto.randomUUID(),
    contentId: content.id,
    campaignId: content.campaignId,
    platform: content.platform,
    provider: isMockMode() ? `mock:${provider}` : provider,
    status: "scheduled",
    idempotencyKey: key,
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: content.scheduledFor ?? new Date().toISOString(),
    publishedAt: null,
  });
  await store.updateContent(content.id, { status: "scheduled" });
  return publication;
}

export async function publishPublication(
  store: MarketingStore,
  publication: MarketingPublication,
  options?: { simulateFailure?: boolean },
) {
  const content = await store.getContent(publication.contentId);
  if (!content) throw new Error("Content not found.");
  if (publication.status === "published" && publication.externalId) {
    return publication;
  }
  if (!contentMayBePublished(content.status)) {
    return (
      (await store.updatePublication(publication.id, {
        status: "failed",
        lastError: "Content is not approved for publishing.",
      })) ?? publication
    );
  }

  let current = publication;
  if (current.status === "scheduled" || current.status === "failed") {
    const claimed = await store.claimPublication(current.id);
    if (!claimed) {
      return (await store.getPublication(current.id)) ?? current;
    }
    current = claimed;
  } else if (current.status !== "processing") {
    return current;
  }

  const started = Date.now();
  const social = getSocialPublisher(content.platform);
  const email = getEmailProvider();
  const imageUrl = await resolveContentImageUrl(store, content);
  const result =
    content.platform === "email"
      ? await email.send({
          content,
          publication: current,
          imageUrl,
          simulateFailure: options?.simulateFailure,
        })
      : await social.publish({
          content,
          publication: current,
          imageUrl,
          simulateFailure: options?.simulateFailure,
        });

  const attemptCount = current.attemptCount + 1;
  if (result.ok) {
    const updated = await store.updatePublication(current.id, {
      status: "published",
      externalId: result.externalId ?? publication.externalId,
      url: result.url ?? publication.url,
      attemptCount,
      lastError: null,
      publishedAt: new Date().toISOString(),
    });
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
    return updated ?? current;
  }

  const retryable = Boolean(result.retryable && attemptCount < 3);
  const updated = await store.updatePublication(current.id, {
    status: "failed",
    attemptCount,
    lastError: result.error ?? "Publish failed",
  });
  await store.updateContent(content.id, { status: "failed" });
  await store.recordEvent({
    id: crypto.randomUUID(),
    name: "content_failed",
    campaignId: content.campaignId,
    contentId: content.id,
    platform: content.platform,
    properties: { error: result.error ?? "unknown", retryable },
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
  return updated ?? current;
}

export async function retryPublication(store: MarketingStore, publicationId: string) {
  const publication = await store.getPublication(publicationId);
  if (!publication) throw new Error("Publication not found.");
  if (publication.status === "published") return publication;
  return publishPublication(store, publication);
}

export async function publishDue(store: MarketingStore, now = new Date()) {
  const due = (await store.listPublications("scheduled")).filter((item) => {
    if (!item.scheduledFor) return true;
    return new Date(item.scheduledFor).getTime() <= now.getTime();
  });
  const failedRetry = (await store.listPublications("failed")).filter(
    (item) => item.attemptCount < 3 && item.lastError?.includes("transient"),
  );
  const results = [];
  for (const item of [...due, ...failedRetry]) {
    results.push(await publishPublication(store, item));
  }
  return results;
}
