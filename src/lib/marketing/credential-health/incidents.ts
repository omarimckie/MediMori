import type { MarketingIncidentRepository } from "../incidents/repository";
import { recordMarketingIncidentSafely } from "../incidents/record-safely";
import { recordIncident } from "../incidents/record";
import { resolveIncident } from "../incidents/record";
import type { RecordIncidentResult } from "../incidents/record-types";
import type { MarketingIncidentRecord } from "../incidents/types";
import { credentialWarningIncidentDedupeKey } from "./dedupe-keys";
import {
  incidentErrorClassForClassification,
  incidentSeverityForClassification,
  isVerifiedCredentialRecovery,
  shouldOpenCredentialWarningIncident,
  type CredentialProbeKind,
} from "./policy";
import { snapshotIncidentEvidence } from "./snapshot";
import type {
  CredentialHealthClassification,
  CredentialHealthPlatform,
  CredentialValidationAttempt,
} from "./types";

function credentialProviderForPlatform(platform: CredentialHealthPlatform): "meta" | "openai" {
  return platform === "openai" ? "openai" : "meta";
}

export async function findOpenCredentialWarningIncident(
  repository: MarketingIncidentRepository,
  platform: CredentialHealthPlatform,
): Promise<MarketingIncidentRecord | null> {
  const incident = await repository.findByDedupeKey(
    credentialWarningIncidentDedupeKey(platform),
  );
  if (!incident) {
    return null;
  }
  return incident.status === "resolved" ? null : incident;
}

export async function recordCredentialWarningIncident(
  input: {
    platform: CredentialHealthPlatform;
    classification: CredentialHealthClassification;
    attempt: CredentialValidationAttempt;
    credentialFingerprint: string | null;
    lastSuccessfulValidationAt: string | null;
    sourceOperation: string;
    probeKind: CredentialProbeKind;
    repository?: MarketingIncidentRepository;
  },
): Promise<RecordIncidentResult | null> {
  if (!shouldOpenCredentialWarningIncident(input.classification, input.probeKind)) {
    return null;
  }
  const evidence = snapshotIncidentEvidence({
    attempt: input.attempt,
    credentialFingerprint: null,
    lastSuccessfulValidationAt: input.lastSuccessfulValidationAt,
  });
  const severity = incidentSeverityForClassification(input.classification);
  const errorClass = incidentErrorClassForClassification(input.classification);

  if (!input.repository) {
    return recordMarketingIncidentSafely(
      {
        incidentType: "credential_warning",
        status: "action_required",
        severity,
        sourceOperation: input.sourceOperation,
        dedupeKey: credentialWarningIncidentDedupeKey(input.platform),
        errorClass,
        errorMessage: credentialIncidentMessage(input.platform, errorClass),
        retrySafety: "not_applicable",
        permittedActions: ["investigate_read_only", "notify_owner"],
        humanApprovalRequired: false,
        platform: input.platform,
        provider: credentialProviderForPlatform(input.platform),
        evidence,
        detectedAt: input.attempt.attemptedAt,
      },
      { reopenIfResolved: true },
    ).then((incident) =>
      incident ? { outcome: "created" as const, incident } : null,
    );
  }
  try {
    return await recordIncident(
      input.repository,
      {
        incidentType: "credential_warning",
        status: "action_required",
        severity,
        sourceOperation: input.sourceOperation,
        dedupeKey: credentialWarningIncidentDedupeKey(input.platform),
        errorClass,
        errorMessage: credentialIncidentMessage(input.platform, errorClass),
        retrySafety: "not_applicable",
        permittedActions: ["investigate_read_only", "notify_owner"],
        humanApprovalRequired: false,
        platform: input.platform,
        provider: credentialProviderForPlatform(input.platform),
        evidence,
        detectedAt: input.attempt.attemptedAt,
      },
      { reopenIfResolved: true },
    );
  } catch {
    return null;
  }
}

export async function resolveCredentialWarningIfRecovered(
  input: {
    platform: CredentialHealthPlatform;
    classification: CredentialHealthClassification;
    repository?: MarketingIncidentRepository;
    sourceOperation: string;
  },
): Promise<MarketingIncidentRecord | null> {
  const repo = input.repository;
  if (!repo) {
    return null;
  }
  const open = await findOpenCredentialWarningIncident(repo, input.platform);
  if (!open) {
    return null;
  }
  if (!isVerifiedCredentialRecovery(input.classification, open)) {
    return null;
  }
  return resolveIncident(repo, open.id, {
    resolutionType: "auto_recovered",
    resolutionSummary: `Verified ${input.platform} credential health recovery (${input.sourceOperation}).`,
    actor: "system",
  });
}

function credentialIncidentMessage(
  platform: CredentialHealthPlatform,
  errorClass: string,
): string {
  if (platform === "openai") {
    if (errorClass === "openai_credentials_missing") {
      return "OpenAI API key is not configured.";
    }
    if (errorClass === "openai_auth_expired") {
      return "OpenAI API key has expired. Smart Upload captions and other AI features may fail.";
    }
    if (errorClass === "openai_auth_invalid") {
      return "OpenAI API key is invalid or revoked.";
    }
    return `OpenAI API credential health requires attention (${errorClass}).`;
  }
  const label = platform === "facebook" ? "Facebook" : "Instagram";
  if (errorClass === "meta_auth_expiring_soon") {
    return `${label} access token expires within seven days. Renew before publishing fails.`;
  }
  if (errorClass === "meta_permissions") {
    return `${label} credentials lack required publishing permissions.`;
  }
  if (errorClass === "meta_credentials_missing") {
    return `${label} credentials are not configured.`;
  }
  if (errorClass === "meta_auth_expired") {
    return `${label} access token is expired or invalid.`;
  }
  return `${label} credential health requires attention (${errorClass}).`;
}
