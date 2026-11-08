import type { MarketingIncidentRecord } from "../incidents/types";
import { isIntegrationCredentialPlatform } from "./integration-platforms";
import type { CredentialHealthPlatform, MetaCredentialPlatform } from "./types";

export function credentialWarningIncidentDedupeKey(
  platform: CredentialHealthPlatform,
): string {
  if (platform === "openai") {
    return "incident:credential_warning:v1:openai:api_key";
  }
  if (platform === "facebook" || platform === "instagram") {
    return `incident:credential_warning:v1:meta:${platform}`;
  }
  if (isIntegrationCredentialPlatform(platform)) {
    return `incident:credential_warning:v1:${platform}:credential`;
  }
  return `incident:credential_warning:v1:meta:${platform}`;
}

/** One auth-failure push per open incident episode; reopened incidents get a new episode key. */
export function credentialFailureNotifyDedupeKey(
  platform: CredentialHealthPlatform,
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
  platform: CredentialHealthPlatform,
  incidentId: string,
  errorClass: string,
): string {
  return `credential_notify:v1:${platform}:auth_failure:${incidentId}:escalation:${errorClass}`;
}

export function credentialExpiringNotifyDedupeKey(
  platform: CredentialHealthPlatform,
  knownExpiresAtIso: string,
): string {
  return `credential_notify:v1:${platform}:expiring:${knownExpiresAtIso.slice(0, 10)}`;
}

export function credentialMonitoringUnavailableNotifyDedupeKey(
  platform: CredentialHealthPlatform,
): string {
  return `credential_notify:v1:${platform}:monitoring_unavailable`;
}
