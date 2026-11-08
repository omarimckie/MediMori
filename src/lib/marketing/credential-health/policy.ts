import type { MarketingIncidentRecord } from "../incidents/types";
import type { CredentialHealthClassification, CredentialHealthState } from "./types";

export type CredentialProbeKind = "proactive_daily" | "reactive";

function isDefinitiveCredentialFailureClass(errorClass: string | null): boolean {
  if (!errorClass) {
    return false;
  }
  return (
    errorClass.endsWith("_credentials_missing") ||
    errorClass.endsWith("_auth_invalid") ||
    errorClass.endsWith("_auth_expired") ||
    errorClass === "meta_permissions"
  );
}

export function isTransientValidationUnavailable(
  classification: CredentialHealthClassification,
): boolean {
  return (
    classification.healthState === "validation_unavailable" &&
    !isDefinitiveCredentialFailureClass(classification.errorClass)
  );
}

export function isConfirmedCredentialFailure(
  classification: CredentialHealthClassification,
): boolean {
  if (classification.healthState === "expired" || classification.healthState === "revoked_or_invalid") {
    return true;
  }
  if (classification.permissionCheck === "insufficient") {
    return true;
  }
  if (isDefinitiveCredentialFailureClass(classification.errorClass)) {
    return true;
  }
  return false;
}

export function shouldOpenIntegrationCredentialIncident(
  classification: CredentialHealthClassification,
  probeKind: CredentialProbeKind,
  suppressAuthIncidents: boolean,
): boolean {
  if (classification.errorClass === "pinterest_no_safe_probe") {
    return false;
  }
  if (suppressAuthIncidents && classification.validity !== "valid") {
    return isConfirmedCredentialFailure(classification) && classification.errorClass?.endsWith("_credentials_missing") === true;
  }
  return shouldOpenCredentialWarningIncident(classification, probeKind);
}

export function incidentSeverityForClassification(
  classification: CredentialHealthClassification,
): "error" | "warning" {
  if (classification.healthState === "expiring_soon") {
    return "warning";
  }
  return "error";
}

export function shouldOpenCredentialWarningIncident(
  classification: CredentialHealthClassification,
  probeKind: CredentialProbeKind,
): boolean {
  if (isConfirmedCredentialFailure(classification)) {
    return true;
  }
  if (classification.healthState === "expiring_soon") {
    return classification.expirationKnowledge === "known" && Boolean(classification.knownExpiresAtIso);
  }
  if (probeKind === "reactive" && isConfirmedCredentialFailure(classification)) {
    return true;
  }
  return false;
}

export function incidentErrorClassForClassification(
  classification: CredentialHealthClassification,
): string {
  if (classification.errorClass) {
    return classification.errorClass;
  }
  if (classification.healthState === "expiring_soon") {
    return "meta_auth_expiring_soon";
  }
  return "meta_credential_health";
}

export function severityRank(severity: string): number {
  if (severity === "error") return 2;
  if (severity === "warning") return 1;
  return 0;
}

export function isVerifiedCredentialRecovery(
  classification: CredentialHealthClassification,
  openIncident: MarketingIncidentRecord | null,
): boolean {
  if (!openIncident || openIncident.status === "resolved") {
    return false;
  }
  if (classification.healthState === "validation_unavailable") {
    return false;
  }
  if (classification.validity !== "valid") {
    return false;
  }
  const incidentClass = openIncident.errorClass;
  if (incidentClass === "meta_permissions") {
    return classification.permissionCheck === "sufficient";
  }
  if (incidentClass === "meta_auth_expiring_soon") {
    return (
      classification.healthState === "healthy" ||
      (classification.healthState === "unknown_expiration" &&
        classification.permissionCheck !== "insufficient")
    );
  }
  if (
    incidentClass === "openai_auth_expired" ||
    incidentClass === "openai_auth_invalid" ||
    incidentClass === "openai_credentials_missing" ||
    incidentClass?.endsWith("_auth_invalid") ||
    incidentClass?.endsWith("_auth_expired") ||
    incidentClass?.endsWith("_credentials_missing")
  ) {
    return (
      classification.healthState === "healthy" ||
      classification.healthState === "unknown_expiration"
    );
  }
  if (
    incidentClass === "meta_auth_expired" ||
    incidentClass === "meta_credentials_missing" ||
    classification.healthState === "expired" ||
    classification.healthState === "revoked_or_invalid"
  ) {
    return (
      classification.healthState === "healthy" ||
      classification.healthState === "unknown_expiration" ||
      (classification.healthState === "expiring_soon" &&
        classification.expirationKnowledge === "known")
    );
  }
  return classification.healthState === "healthy";
}

export function shouldSendMonitoringUnavailablePush(
  consecutiveDailyUnavailable: number,
  pushAlreadySent: boolean,
): boolean {
  return consecutiveDailyUnavailable >= 2 && !pushAlreadySent;
}

export function isSuccessfulValidationState(state: CredentialHealthState): boolean {
  return (
    state === "healthy" ||
    state === "unknown_expiration" ||
    state === "expiring_soon"
  );
}
