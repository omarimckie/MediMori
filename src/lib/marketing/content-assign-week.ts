import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import type { MarketingStore } from "./store";
import type { MarketingContent } from "./types";

export type AssignContentToWeekInput = {
  contentIds: string[];
  weeklyPlanId: string;
};

export type AssignContentToWeekResult = {
  weeklyPlanId: string;
  updated: MarketingContent[];
};

export class AssignContentToWeekError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "plan_not_found"
      | "content_not_found"
      | "duplicate_ids",
  ) {
    super(message);
    this.name = "AssignContentToWeekError";
  }
}

function normalizeContentIds(contentIds: string[]): string[] {
  const trimmed = contentIds.map((id) => id.trim()).filter(Boolean);
  if (!trimmed.length) {
    throw new AssignContentToWeekError("At least one content id is required.", "invalid_input");
  }
  const unique = [...new Set(trimmed)];
  if (unique.length !== trimmed.length) {
    throw new AssignContentToWeekError("Duplicate content ids are not allowed.", "duplicate_ids");
  }
  return unique;
}

export async function assignContentToWeeklyPlan(
  store: MarketingStore,
  input: AssignContentToWeekInput,
): Promise<AssignContentToWeekResult> {
  const weeklyPlanId = input.weeklyPlanId.trim();
  if (!weeklyPlanId) {
    throw new AssignContentToWeekError("weeklyPlanId is required.", "invalid_input");
  }

  const contentIds = normalizeContentIds(input.contentIds);
  const plan = await store.getWeeklyPlan(weeklyPlanId);
  if (!plan) {
    throw new AssignContentToWeekError("Weekly plan not found.", "plan_not_found");
  }

  const updated: MarketingContent[] = [];
  for (const contentId of contentIds) {
    const row = await store.assignContentWeeklyPlan(contentId, weeklyPlanId);
    if (!row) {
      throw new AssignContentToWeekError(`Content not found: ${contentId}`, "content_not_found");
    }
    updated.push(row);
  }

  return { weeklyPlanId, updated };
}

export type SmartUploadPairResolution =
  | { kind: "not_smart_upload" }
  | { kind: "no_finalize_key" }
  | { kind: "complete"; finalizeKey: string; instagramId: string; facebookId: string }
  | { kind: "partial_or_inconsistent"; finalizeKey: string; message: string };

export async function resolveSmartUploadPairForContent(
  store: MarketingStore,
  content: MarketingContent,
): Promise<SmartUploadPairResolution> {
  if (content.metadata?.source !== SMART_UPLOAD_SOURCE) {
    return { kind: "not_smart_upload" };
  }
  const finalizeKey = content.metadata?.smartUploadFinalizeKey?.trim() ?? "";
  if (!finalizeKey) {
    return { kind: "no_finalize_key" };
  }

  const lookup = await store.findSmartUploadContentByFinalizeKey(finalizeKey);
  if (lookup.status === "complete") {
    return {
      kind: "complete",
      finalizeKey,
      instagramId: lookup.instagram.id,
      facebookId: lookup.facebook.id,
    };
  }

  const message =
    lookup.status === "partial"
      ? "Only one platform exists for this Smart Upload finalize key."
      : lookup.status === "inconsistent"
        ? lookup.reason
        : "Smart Upload pair could not be resolved for this item.";

  return { kind: "partial_or_inconsistent", finalizeKey, message };
}

export function assignWeekErrorStatus(error: unknown): number {
  if (error instanceof AssignContentToWeekError) {
    if (error.code === "plan_not_found" || error.code === "content_not_found") return 404;
    return 400;
  }
  return 500;
}
