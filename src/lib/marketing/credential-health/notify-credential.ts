import type { MarketingNotificationPayload } from "../notifications/types";
import { logMarketing } from "../logger";
import {
  attachReliabilityDedupeNotification,
  claimReliabilityDedupe,
  releaseReliabilityDedupe,
} from "../reliability/repository";
import { notifyReliabilityPayload } from "../reliability/notify";
import type { MarketingIncidentRecord } from "../incidents/types";
import {
  credentialExpiringNotifyDedupeKey,
  credentialFailureNotifyDedupeKey,
  credentialFailureSeverityEscalationNotifyDedupeKey,
  credentialMonitoringUnavailableNotifyDedupeKey,
} from "./dedupe-keys";
import type { CredentialHealthClassification, MetaCredentialPlatform } from "./types";
import {
  incidentErrorClassForClassification,
  isConfirmedCredentialFailure,
  shouldSendMonitoringUnavailablePush,
} from "./policy";

const CREDENTIAL_NOTIFY_PUBLICATION_SENTINEL = "00000000-0000-4000-8000-credential0000";

export type CredentialNotifyDeps = {
  claimDedupe: (input: { dedupeKey: string; publicationId: string }) => Promise<boolean>;
  notify: (
    payload: MarketingNotificationPayload,
  ) => Promise<{ notificationId: string; pushDelivered?: number }>;
  attachDedupe: (input: { dedupeKey: string; notificationId: string }) => Promise<void>;
  releaseDedupe: (dedupeKey: string) => Promise<void>;
};

const defaultDeps: CredentialNotifyDeps = {
  claimDedupe: claimReliabilityDedupe,
  notify: notifyReliabilityPayload,
  attachDedupe: attachReliabilityDedupeNotification,
  releaseDedupe: releaseReliabilityDedupe,
};

function platformLabel(platform: MetaCredentialPlatform): string {
  return platform === "facebook" ? "Facebook" : "Instagram";
}

export function buildCredentialAuthFailurePayload(
  platform: MetaCredentialPlatform,
  relatedIncidentId: string,
): MarketingNotificationPayload {
  return {
    type: "credential_warning",
    severity: "error",
    title: `${platformLabel(platform)} credentials need attention`,
    body:
      "Publishing may fail until Meta credentials are renewed or permissions are fixed. " +
      "Open Marketing Admin to review the credential incident.",
    destination: "/admin/marketing/week",
    relatedIncidentId,
  };
}

export function buildCredentialExpiringPayload(
  platform: MetaCredentialPlatform,
  relatedIncidentId: string,
  knownExpiresAtIso: string,
): MarketingNotificationPayload {
  const day = knownExpiresAtIso.slice(0, 10);
  return {
    type: "credential_warning",
    severity: "warning",
    title: `${platformLabel(platform)} token expiring soon`,
    body: `Verified expiration on ${day}. Renew Meta credentials before automatic publishing fails.`,
    destination: "/admin/marketing/week",
    relatedIncidentId,
  };
}

export function buildCredentialMonitoringUnavailablePayload(
  platform: MetaCredentialPlatform,
): MarketingNotificationPayload {
  return {
    type: "credential_warning",
    severity: "warning",
    title: `Unable to verify ${platformLabel(platform)} credentials`,
    body:
      "Daily credential checks could not reach Meta. This does not mean your token is expired. " +
      "Publishing behavior is unchanged; retry will occur on the next check.",
    destination: "/admin/marketing/week",
  };
}

async function sendDeduped(
  dedupeKey: string,
  payload: MarketingNotificationPayload,
  deps: CredentialNotifyDeps,
): Promise<boolean> {
  const claimed = await deps.claimDedupe({
    dedupeKey,
    publicationId: CREDENTIAL_NOTIFY_PUBLICATION_SENTINEL,
  });
  if (!claimed) {
    return false;
  }
  try {
    const { notificationId } = await deps.notify(payload);
    await deps.attachDedupe({ dedupeKey, notificationId });
    return true;
  } catch (error) {
    await deps.releaseDedupe(dedupeKey);
    logMarketing({
      operation: "credential_health_notify",
      success: false,
      error: error instanceof Error ? error.message : "notify_failed",
    });
    return false;
  }
}

export async function notifyCredentialHealthOutcomes(
  input: {
    platform: MetaCredentialPlatform;
    classification: CredentialHealthClassification;
    incident: MarketingIncidentRecord | null;
    incidentOutcome: "created" | "reopened" | "occurrence" | null;
    consecutiveDailyUnavailable: number;
    monitoringUnavailablePushSent: boolean;
    immediateAuthFailure?: boolean;
    deps?: CredentialNotifyDeps;
  },
): Promise<{ monitoringUnavailablePushSent: boolean }> {
  const deps = input.deps ?? defaultDeps;
  let monitoringUnavailablePushSent = input.monitoringUnavailablePushSent;

  if (
    input.incident &&
    isConfirmedCredentialFailure(input.classification) &&
    (input.incidentOutcome === "created" ||
      input.incidentOutcome === "reopened" ||
      (input.immediateAuthFailure && input.incidentOutcome === "occurrence"))
  ) {
    const notifyOutcome =
      input.incidentOutcome === "occurrence" ? "occurrence" : input.incidentOutcome!;
    await sendDeduped(
      credentialFailureNotifyDedupeKey(input.platform, input.incident, notifyOutcome),
      buildCredentialAuthFailurePayload(input.platform, input.incident.id),
      deps,
    );
  }

  if (
    input.incident &&
    input.classification.healthState === "expiring_soon" &&
    input.classification.knownExpiresAtIso &&
    (input.incidentOutcome === "created" || input.incidentOutcome === "reopened")
  ) {
    await sendDeduped(
      credentialExpiringNotifyDedupeKey(
        input.platform,
        input.classification.knownExpiresAtIso,
      ),
      buildCredentialExpiringPayload(
        input.platform,
        input.incident.id,
        input.classification.knownExpiresAtIso,
      ),
      deps,
    );
  }

  if (
    shouldSendMonitoringUnavailablePush(
      input.consecutiveDailyUnavailable,
      monitoringUnavailablePushSent,
    )
  ) {
    const sent = await sendDeduped(
      credentialMonitoringUnavailableNotifyDedupeKey(input.platform),
      buildCredentialMonitoringUnavailablePayload(input.platform),
      deps,
    );
    if (sent) {
      monitoringUnavailablePushSent = true;
    }
  }

  if (
    input.incident &&
    input.incidentOutcome === "occurrence" &&
    isConfirmedCredentialFailure(input.classification)
  ) {
    const errorClass = incidentErrorClassForClassification(input.classification);
    if (errorClass !== input.incident.errorClass) {
      await sendDeduped(
        credentialFailureSeverityEscalationNotifyDedupeKey(
          input.platform,
          input.incident.id,
          errorClass,
        ),
        buildCredentialAuthFailurePayload(input.platform, input.incident.id),
        deps,
      );
    }
  }

  return { monitoringUnavailablePushSent };
}
