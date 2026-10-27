import type { MarketingNotificationPayload } from "../notifications/types";
import { logMarketing } from "../logger";
import { sendMarketingAdminBroadcastNotification } from "../notifications/broadcast";
import { formatPlatformLabel } from "../reliability/format";
import type { MarketingPublication } from "../types";
import { INSTAGRAM_PROVIDER_RECOVERY_MESSAGE } from "../publication-recovery-guard";

export function buildPublicationRecoveryRequiredNotificationPayload(
  publication: MarketingPublication,
  relatedIncidentId: string,
): MarketingNotificationPayload {
  const platform = formatPlatformLabel(publication.platform);
  return {
    type: "publication_recovery_required",
    severity: "error",
    title: `${platform} publication needs provider recovery`,
    body:
      `${INSTAGRAM_PROVIDER_RECOVERY_MESSAGE} Review the linked incident in Marketing Admin — ` +
      `this notification does not retry or reconcile the publication.`,
    destination: "/admin/marketing/week",
    relatedContentId: publication.contentId,
    relatedPublicationId: publication.id,
    relatedIncidentId,
  };
}

export type PublicationRecoveryNotifyDeps = {
  sendBroadcast: (
    input: MarketingNotificationPayload & { deliverPush?: boolean },
  ) => Promise<{ notification: { id: string } }>;
};

const defaultRecoveryNotifyDeps: PublicationRecoveryNotifyDeps = {
  sendBroadcast: async (input) => {
    const result = await sendMarketingAdminBroadcastNotification({
      ...input,
      deliverPush: input.deliverPush ?? true,
    });
    return { notification: result.notification };
  },
};

/**
 * Observability only: failures are logged and never unblock the recovery guard.
 */
export async function notifyPublicationRecoveryRequiredWithDeps(
  publication: MarketingPublication,
  relatedIncidentId: string,
  deps: PublicationRecoveryNotifyDeps = defaultRecoveryNotifyDeps,
): Promise<void> {
  try {
    const payload = buildPublicationRecoveryRequiredNotificationPayload(
      publication,
      relatedIncidentId,
    );
    await deps.sendBroadcast({
      ...payload,
      deliverPush: true,
    });
  } catch (error) {
    logMarketing({
      operation: "publication_recovery_required_notify",
      contentId: publication.contentId,
      success: false,
      error: error instanceof Error ? error.message : "notify failed",
    });
  }
}

export async function notifyPublicationRecoveryRequired(
  publication: MarketingPublication,
  relatedIncidentId: string,
): Promise<void> {
  return notifyPublicationRecoveryRequiredWithDeps(publication, relatedIncidentId);
}
