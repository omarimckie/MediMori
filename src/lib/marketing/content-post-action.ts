import { jsonError } from "./http";
import { runApprovalAction } from "./workflow";
import type { MarketingStore } from "./store";
import { NextResponse } from "next/server";

export function contentActionFailureStatus(message: string): number {
  return /^(invalid_|image_)|invalid_schedule_time|not found|Only approved|Only published|already published|cannot be recycled|No published publication|required|Unknown action|Only rejected|Permanent deletion|Cannot delete|explicit confirmation/i.test(
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
    const result = await runApprovalAction(store, {
      ...input,
      confirmPermanentDelete: input.confirmPermanentDelete,
    });
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    return jsonError(message, contentActionFailureStatus(message));
  }
}
