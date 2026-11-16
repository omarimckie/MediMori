import { assertPlannerE2eApproveAllowed, PlannerStagingE2eOwnershipError } from "./planner-staging-e2e-gate";
import { jsonError, marketingPreviewReadonlyResponse } from "./http";
import {
  assertMarketingPreviewAllowsMutations,
  MarketingPreviewReadonlyError,
} from "./preview-readonly";
import { runApprovalAction } from "./workflow";
import type { MarketingStore } from "./store";
import { NextResponse } from "next/server";

export function contentActionFailureStatus(message: string): number {
  return /^(invalid_|image_|tracking_link_required|destination_path_invalid|asset_not_ready)|invalid_schedule_time|not found|Only approved|Only published|already published|cannot be recycled|No published publication|required|Unknown action|Only rejected|Permanent deletion|Cannot delete|explicit confirmation|tracking token is required|website destination|needing a new approved asset/i.test(
      message,
    )
    ? 400
    : 500;
}

type ContentPostActionInput = {
  action:
    | "approve"
    | "reject"
    | "edit"
    | "regenerate"
    | "schedule"
    | "recycle"
    | "restore"
    | "delete_permanent";
  contentId: string;
  body?: string;
  feedback?: string;
  scheduledFor?: string | null;
  confirmPermanentDelete?: unknown;
  actor?: string | null;
};

/** Shared POST handler logic for marketing content actions (testable, no auth). */
export async function executeMarketingContentPostAction(
  store: MarketingStore,
  input: ContentPostActionInput,
) {
  try {
    assertMarketingPreviewAllowsMutations();
    const existing = await store.getContent(input.contentId);
    if (existing && input.action === "approve") {
      assertPlannerE2eApproveAllowed(existing);
    }
    const result = await runApprovalAction(store, {
      ...input,
      confirmPermanentDelete: input.confirmPermanentDelete,
    });
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof MarketingPreviewReadonlyError) {
      return marketingPreviewReadonlyResponse();
    }
    if (error instanceof PlannerStagingE2eOwnershipError) {
      return jsonError(error.message, 403);
    }
    const message = error instanceof Error ? error.message : "Action failed.";
    return jsonError(message, contentActionFailureStatus(message));
  }
}
