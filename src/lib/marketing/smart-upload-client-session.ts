import {
  SMART_UPLOAD_DESTINATIONS_ALL,
  type SmartUploadDestinations,
} from "./smart-upload-destinations";
import { createSmartUploadSessionBatchId } from "./smart-upload-session-batch";

/** Workspace file statuses relevant to post-submit auto-reset. */
export type SmartUploadWorkspaceFileStatus =
  | "ready"
  | "uploading"
  | "validating"
  | "needs_attention"
  | "failed"
  | "submitted";

export type SmartUploadWorkspaceFileRef = {
  id: string;
  status: SmartUploadWorkspaceFileStatus;
};

export type SmartUploadClientFormDefaults = {
  weeklyPlanId: string;
  campaignId: string;
  bookId: string;
  destinations: SmartUploadDestinations;
};

export function defaultSmartUploadClientFormState(): SmartUploadClientFormDefaults {
  return {
    weeklyPlanId: "",
    campaignId: "",
    bookId: "",
    destinations: { ...SMART_UPLOAD_DESTINATIONS_ALL },
  };
}

/**
 * After Submit valid completes, reset only when every file that was not already
 * submitted before this click is now server-confirmed `submitted`.
 */
export function shouldAutoResetSmartUploadAfterSubmitValid(
  before: SmartUploadWorkspaceFileRef[],
  after: SmartUploadWorkspaceFileRef[],
): boolean {
  const targeted = before.filter((file) => file.status !== "submitted");
  if (!targeted.length) return false;
  const beforeIds = new Set(before.map((file) => file.id));
  const afterById = new Map(after.map((file) => [file.id, file]));
  if (!targeted.every((file) => afterById.get(file.id)?.status === "submitted")) {
    return false;
  }
  // Do not reset if the user added files during an in-flight submit (would lose unsubmitted work).
  return after.every((file) => beforeIds.has(file.id));
}

export function countSmartUploadSubmitTargets(before: SmartUploadWorkspaceFileRef[]): number {
  return before.filter((file) => file.status !== "submitted").length;
}

export function formatSmartUploadSubmitSuccessMessage(submittedCount: number): string {
  const noun = submittedCount === 1 ? "image" : "images";
  return `Successfully submitted ${submittedCount} ${noun} to Needs Review. You can upload another image.`;
}

export function createNextSmartUploadSessionBatchId(): string {
  return createSmartUploadSessionBatchId();
}
