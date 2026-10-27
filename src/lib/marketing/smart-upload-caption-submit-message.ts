import {
  findSubmitValidCaptionPreflightIssue,
  type SubmitValidCaptionPreflightEntry,
} from "./smart-upload-caption-client-state";

export function formatStaleCaptionSubmitPreflightMessage(fileName: string): string {
  return `Caption for "${fileName}" is out of date. Regenerate or choose Keep Caption Anyway before submitting.`;
}

export function isStaleCaptionSubmitPreflightMessage(message: string): boolean {
  return (
    message.startsWith('Caption for "') &&
    message.includes('" is out of date.') &&
    message.includes("Keep Caption Anyway")
  );
}

/** Clears only the stale-caption submit preflight message when no file is stale-unacknowledged. */
export function reconcileStaleCaptionSubmitSessionMessage(
  message: string | null,
  entries: SubmitValidCaptionPreflightEntry[],
): string | null {
  if (message === null || !isStaleCaptionSubmitPreflightMessage(message)) {
    return message;
  }
  const issue = findSubmitValidCaptionPreflightIssue(entries);
  if (issue?.kind === "stale_generated") {
    return message;
  }
  return null;
}
