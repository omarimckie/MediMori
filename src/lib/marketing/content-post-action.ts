import { jsonError } from "./http";
import { runApprovalAction } from "./workflow";
import type { MarketingStore } from "./store";
import { NextResponse } from "next/server";

export function contentActionFailureStatus(message: string): number {
  return /^(invalid_|image_)|not found|Only approved|required|Unknown action/i.test(message)
    ? 400
    : 500;
}

type ContentPostActionInput = {
  action: "approve" | "reject" | "edit" | "regenerate" | "schedule";
  contentId: string;
  body?: string;
  feedback?: string;
  actor?: string | null;
};

/** Shared POST handler logic for marketing content actions (testable, no auth). */
export async function executeMarketingContentPostAction(
  store: MarketingStore,
  input: ContentPostActionInput,
) {
  try {
    const result = await runApprovalAction(store, input);
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    return jsonError(message, contentActionFailureStatus(message));
  }
}
