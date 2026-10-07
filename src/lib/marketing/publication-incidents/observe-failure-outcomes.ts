import type { MarketingIncidentRepository } from "../incidents/repository";
import type { MarketingPublication } from "../types";
import { isInstagramProviderMediaRecoveryRequired } from "../publication-recovery-guard";
import { observePublicationRecoveryRequired } from "./recovery-required";
import { recordPublicationFailedIncidentResult } from "./failed";
import { notifyPublicationFailedWithDeps } from "./failed-notify";
import type { PublicationRecoveryNotifyDeps } from "./recovery-notify";
import { notifyPublicationRecoveryRequiredWithDeps } from "./recovery-notify";
import { logMarketing } from "../logger";
import { sanitizeErrorMessage } from "../incidents/sanitize";

/**
 * Prospective observability after authoritative publication failure is persisted.
 * Does not mutate publication rows.
 */
export async function observePublicationFailureOutcomes(
  publication: MarketingPublication,
  input: {
    sourceOperation: string;
    repository?: MarketingIncidentRepository;
    notifyFailed?: typeof notifyPublicationFailedWithDeps;
    notifyRecovery?: typeof notifyPublicationRecoveryRequiredWithDeps;
    notifyRecoveryDeps?: PublicationRecoveryNotifyDeps;
  },
): Promise<void> {
  if (publication.status !== "failed") {
    return;
  }

  if (isInstagramProviderMediaRecoveryRequired(publication)) {
    await observePublicationRecoveryRequired(
      publication,
      input.sourceOperation,
      input.repository,
      {
        notifyRecovery: input.notifyRecovery,
        notifyRecoveryDeps: input.notifyRecoveryDeps,
      },
    );
    return;
  }

  const failedResult = await recordPublicationFailedIncidentResult(
    publication,
    input.sourceOperation,
    input.repository,
  );
  if (!failedResult) {
    return;
  }

  const notify = input.notifyFailed ?? notifyPublicationFailedWithDeps;
  try {
    await notify(publication, failedResult.incident, failedResult.outcome);
  } catch (error) {
    logMarketing({
      operation: "publication_failed_observe_notify",
      contentId: publication.contentId,
      success: false,
      error: sanitizeErrorMessage(
        error instanceof Error ? error.message : "observe_notify_failed",
      ),
    });
  }
}
