import {
  hasActiveScheduledPublication,
  filterUnscheduledApprovedContent,
} from "./calendar-unscheduled";
import { resolveSmartUploadPairForContent } from "./content-assign-week";
import type { MarketingStore } from "./store";
import type {
  MarketingContent,
  MarketingPublication,
  PlannerQueueListParams,
  PlannerQueueListResult,
} from "./types";

export const PLANNER_QUEUE_QUEUED_AT_KEY = "plannerQueuedAt";
export const PLANNER_QUEUE_EXCLUDED_AT_KEY = "plannerQueueExcludedAt";

export const BLOCKING_PLANNER_PUBLICATION_STATUSES: MarketingPublication["status"][] = [
  "scheduled",
  "processing",
  "published",
];

export type AddContentToPlannerInput = {
  contentIds: string[];
};

export type AddContentToPlannerResult = {
  queued: MarketingContent[];
  alreadyQueued: MarketingContent[];
};

export type RemoveContentFromPlannerInput = {
  contentIds: string[];
};

export type RemoveContentFromPlannerResult = {
  removed: MarketingContent[];
};

export class AddToPlannerError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "content_not_found"
      | "duplicate_ids"
      | "not_approved"
      | "blocked_publication",
    readonly contentId?: string,
  ) {
    super(message);
    this.name = "AddToPlannerError";
  }
}

export class RemoveFromPlannerError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "content_not_found" | "duplicate_ids",
    readonly contentId?: string,
  ) {
    super(message);
    this.name = "RemoveFromPlannerError";
  }
}

const enqueueLocks = new Map<string, Promise<void>>();

async function withContentEnqueueLock<T>(contentId: string, fn: () => Promise<T>): Promise<T> {
  const previous = enqueueLocks.get(contentId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  enqueueLocks.set(contentId, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (enqueueLocks.get(contentId) === tail) {
      enqueueLocks.delete(contentId);
    }
  }
}

function normalizeIdList(
  contentIds: string[],
  onError: (message: string, code: "invalid_input" | "duplicate_ids") => never,
): string[] {
  const trimmed = contentIds.map((id) => id.trim()).filter(Boolean);
  if (!trimmed.length) {
    onError("At least one content id is required.", "invalid_input");
  }
  const unique = [...new Set(trimmed)];
  if (unique.length !== trimmed.length) {
    onError("Duplicate content ids are not allowed.", "duplicate_ids");
  }
  return unique;
}

function normalizeContentIds(contentIds: string[]): string[] {
  return normalizeIdList(contentIds, (message, code) => {
    throw new AddToPlannerError(message, code);
  });
}

function normalizeRemoveContentIds(contentIds: string[]): string[] {
  return normalizeIdList(contentIds, (message, code) => {
    throw new RemoveFromPlannerError(message, code);
  });
}

export function hasBlockingPlannerPublication(
  publications: Pick<MarketingPublication, "contentId" | "platform" | "status">[],
  content: Pick<MarketingContent, "id" | "platform">,
): boolean {
  return publications.some(
    (publication) =>
      publication.contentId === content.id &&
      publication.platform === content.platform &&
      BLOCKING_PLANNER_PUBLICATION_STATUSES.includes(publication.status),
  );
}

export function isExplicitPlannerMember(content: MarketingContent): boolean {
  return Boolean(content.metadata?.plannerQueuedAt?.trim());
}

export function isPlannerQueueExcluded(content: MarketingContent): boolean {
  return Boolean(content.metadata?.plannerQueueExcludedAt?.trim());
}

export function isPlannerQueueEligible(
  content: MarketingContent,
  publications: Pick<MarketingPublication, "contentId" | "platform" | "status">[],
): boolean {
  if (content.status !== "approved") return false;
  if (isPlannerQueueExcluded(content)) return false;
  if (hasBlockingPlannerPublication(publications, content)) return false;
  return true;
}

export function appearsInPlannerQueueView(
  content: MarketingContent,
  publications: Pick<MarketingPublication, "contentId" | "platform" | "status">[],
): boolean {
  if (!isPlannerQueueEligible(content, publications)) return false;
  if (isExplicitPlannerMember(content)) return true;
  return filterUnscheduledApprovedContent([content], publications).length === 1;
}

export function parsePlannerQueuePagination(
  limitParam: string | null,
  offsetParam: string | null,
): { limit: number; offset: number } {
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 100;
  let limit = DEFAULT_LIMIT;
  let offset = 0;
  if (limitParam?.trim()) {
    const parsed = Number.parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }
  if (offsetParam?.trim()) {
    const parsed = Number.parseInt(offsetParam, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }
  return { limit, offset };
}

async function expandSmartUploadPlannerIds(
  store: MarketingStore,
  contentIds: string[],
): Promise<string[]> {
  const expanded = new Set(contentIds);
  for (const contentId of contentIds) {
    const content = await store.getContent(contentId);
    if (!content) continue;
    const pair = await resolveSmartUploadPairForContent(store, content);
    if (pair.kind !== "complete") continue;
    for (const id of [pair.instagramId, pair.facebookId, pair.pinterestId]) {
      if (id) expanded.add(id);
    }
  }
  return [...expanded];
}

function assertEnqueueable(content: MarketingContent, publications: MarketingPublication[]) {
  if (content.status !== "approved") {
    throw new AddToPlannerError(
      `Content must be approved before adding to the planner: ${content.id}`,
      "not_approved",
      content.id,
    );
  }
  if (hasBlockingPlannerPublication(publications, content)) {
    throw new AddToPlannerError(
      `Content has an active scheduled, processing, or published publication: ${content.id}`,
      "blocked_publication",
      content.id,
    );
  }
}

async function enqueueSingleContent(
  store: MarketingStore,
  contentId: string,
  publications: MarketingPublication[],
  nowIso: string,
): Promise<{ kind: "queued" | "already_queued"; content: MarketingContent }> {
  return withContentEnqueueLock(contentId, async () => {
    const content = await store.getContent(contentId);
    if (!content) {
      throw new AddToPlannerError(`Content not found: ${contentId}`, "content_not_found", contentId);
    }
    assertEnqueueable(content, publications);
    const existingQueuedAt = content.metadata?.plannerQueuedAt?.trim();
    if (existingQueuedAt && !isPlannerQueueExcluded(content)) {
      return { kind: "already_queued", content };
    }
    const metadata = {
      ...content.metadata,
      plannerQueuedAt: existingQueuedAt ?? nowIso,
    };
    delete metadata.plannerQueueExcludedAt;
    const row = await store.updateContent(contentId, { metadata });
    if (!row) {
      throw new AddToPlannerError(`Content not found: ${contentId}`, "content_not_found", contentId);
    }
    return { kind: "queued", content: row };
  });
}

export async function addContentToPlanner(
  store: MarketingStore,
  input: AddContentToPlannerInput,
  now = () => new Date().toISOString(),
): Promise<AddContentToPlannerResult> {
  const requestedIds = normalizeContentIds(input.contentIds);
  for (const contentId of requestedIds) {
    const content = await store.getContent(contentId);
    if (!content) {
      throw new AddToPlannerError(`Content not found: ${contentId}`, "content_not_found", contentId);
    }
  }

  const expandedIds = await expandSmartUploadPlannerIds(store, requestedIds);
  const publications = await store.listPublications();
  const nowIso = now();
  const queued: MarketingContent[] = [];
  const alreadyQueued: MarketingContent[] = [];

  for (const contentId of expandedIds) {
    const result = await enqueueSingleContent(store, contentId, publications, nowIso);
    if (result.kind === "already_queued") {
      alreadyQueued.push(result.content);
    } else {
      queued.push(result.content);
    }
  }

  return { queued, alreadyQueued };
}

export async function removeContentFromPlanner(
  store: MarketingStore,
  input: RemoveContentFromPlannerInput,
  now = () => new Date().toISOString(),
): Promise<RemoveContentFromPlannerResult> {
  const contentIds = normalizeRemoveContentIds(input.contentIds);
  const removed: MarketingContent[] = [];
  const nowIso = now();

  for (const contentId of contentIds) {
    const content = await store.getContent(contentId);
    if (!content) {
      throw new RemoveFromPlannerError(
        `Content not found: ${contentId}`,
        "content_not_found",
        contentId,
      );
    }
    const metadata = { ...content.metadata };
    delete metadata[PLANNER_QUEUE_QUEUED_AT_KEY as keyof typeof metadata];
    metadata.plannerQueueExcludedAt = nowIso;
    const row = await store.updateContent(contentId, { metadata });
    if (!row) {
      throw new RemoveFromPlannerError(
        `Content not found: ${contentId}`,
        "content_not_found",
        contentId,
      );
    }
    if (row.weeklyPlanId !== content.weeklyPlanId) {
      throw new Error("Weekly plan assignment must not change when removing planner membership.");
    }
    removed.push(row);
  }

  return { removed };
}

export async function listPlannerQueue(
  store: MarketingStore,
  params: PlannerQueueListParams,
): Promise<PlannerQueueListResult> {
  return store.listPlannerQueue(params);
}

export function addToPlannerErrorStatus(error: unknown): number {
  if (error instanceof AddToPlannerError) {
    if (error.code === "content_not_found") return 404;
    return 400;
  }
  return 500;
}

export function removeFromPlannerErrorStatus(error: unknown): number {
  if (error instanceof RemoveFromPlannerError) {
    if (error.code === "content_not_found") return 404;
    return 400;
  }
  return 500;
}

export { hasActiveScheduledPublication };
