import type { MarketingIncidentRecord } from "../incidents/types";
import type { MetaCredentialPlatform } from "./types";

export function credentialWarningIncidentDedupeKey(platform: MetaCredentialPlatform): string {
  return `incident:credential_warning:v1:meta:${platform}`;
}

/** One auth-failure push per open incident episode; reopened incidents get a new episode key. */
export function credentialFailureNotifyDedupeKey(
  platform: MetaCredentialPlatform,
  incident: Pick<MarketingIncidentRecord, "id" | "occurrenceCount">,
  outcome: "created" | "reopened" | "occurrence",
): string {
  const base = `credential_notify:v1:${platform}:auth_failure:${incident.id}`;
  if (outcome === "created") {
    return `${base}:created`;
  }
  if (outcome === "reopened") {
    return `${base}:reopened:${incident.occurrenceCount}`;
  }
  return `${base}:open`;
}

export function credentialFailureSeverityEscalationNotifyDedupeKey(
  platform: MetaCredentialPlatform,
  incidentId: string,
  errorClass: string,
): string {
  return `credential_notify:v1:${platform}:auth_failure:${incidentId}:escalation:${errorClass}`;
}

export function credentialExpiringNotifyDedupeKey(
  platform: MetaCredentialPlatform,
  knownExpiresAtIso: string,
): string {
  return `credential_notify:v1:${platform}:expiring:${knownExpiresAtIso.slice(0, 10)}`;
}

export function credentialMonitoringUnavailableNotifyDedupeKey(
  platform: MetaCredentialPlatform,
): string {
  return `credential_notify:v1:${platform}:monitoring_unavailable`;
}
