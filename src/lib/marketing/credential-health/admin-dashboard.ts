import { listIncidents } from "../incidents/admin-queries";
import type { MarketingIncidentRecord } from "../incidents/types";
import { credentialWarningIncidentDedupeKey } from "./dedupe-keys";
import type { CredentialHealthHeartbeatStore } from "./heartbeat-store";
import { resolveCredentialHealthHeartbeatStore } from "./heartbeat-store-runtime";
import { storedToClientSafeMetadata } from "./merge-state";
import {
  getCredentialMonitoringEnabledAtIso,
  isCredentialMonitoringEnabled,
} from "./monitoring-config";
import type { MetaCredentialPlatform } from "./types";

const PLATFORMS: MetaCredentialPlatform[] = ["facebook", "instagram"];

export type CredentialHealthActiveIncidentView = {
  id: string;
  status: string;
  severity: string;
  errorClass: string;
  summary: string;
  incidentUrl: string;
};

export type CredentialHealthPlatformDashboardView = {
  platform: MetaCredentialPlatform;
  platformLabel: string;
  monitoringState: "disabled" | "no_observation" | "observed";
  validity: "valid" | "invalid" | "unknown" | null;
  healthState: string | null;
  healthStateLabel: string;
  lastSuccessfulValidationAt: string | null;
  lastValidationAttemptAt: string | null;
  knownExpiresAt: string | null;
  expirationStatus: "known" | "unknown" | "provider_non_expiring" | null;
  expirationStatusLabel: string;
  permissionStatus: string;
  permissionStatusLabel: string;
  monitoringUnavailableWarning: boolean;
  activeIncident: CredentialHealthActiveIncidentView | null;
};

export type CredentialHealthDashboardView = {
  monitoringEnabled: boolean;
  monitoringEnabledAt: string | null;
  platforms: CredentialHealthPlatformDashboardView[];
};

export type CredentialHealthDashboardDeps = {
  heartbeatStore?: CredentialHealthHeartbeatStore;
  listIncidentsFn?: typeof listIncidents;
  env?: Record<string, string | undefined>;
  nowIso?: string;
};

function platformLabel(platform: MetaCredentialPlatform): string {
  return platform === "facebook" ? "Facebook" : "Instagram";
}

function formatHealthStateLabel(
  healthState: string | null,
  monitoringState: CredentialHealthPlatformDashboardView["monitoringState"],
): string {
  if (monitoringState === "disabled") {
    return "Monitoring not enabled";
  }
  if (monitoringState === "no_observation") {
    return "Not verified yet";
  }
  if (!healthState) {
    return "Not verified yet";
  }
  return healthState.replaceAll("_", " ");
}

function expirationStatusLabel(
  status: CredentialHealthPlatformDashboardView["expirationStatus"],
): string {
  if (status === "known") return "Verified expiration date";
  if (status === "provider_non_expiring") return "Provider reports non-expiring token";
  if (status === "unknown") return "Expiration unknown";
  return "Expiration not verified";
}

function permissionStatusLabel(permission: string): string {
  const labels: Record<string, string> = {
    sufficient: "Publishing permissions appear sufficient",
    insufficient: "Insufficient publishing permissions",
    unknown: "Publishing permissions not verified",
    not_checked: "Permission check not performed",
  };
  return labels[permission] ?? permission.replaceAll("_", " ");
}

function pickActiveCredentialIncident(
  incidents: MarketingIncidentRecord[],
  platform: MetaCredentialPlatform,
): MarketingIncidentRecord | null {
  const dedupe = credentialWarningIncidentDedupeKey(platform);
  const match = incidents.find(
    (row) =>
      row.incidentType === "credential_warning" &&
      row.dedupeKey === dedupe &&
      row.status !== "resolved",
  );
  return match ?? null;
}

function incidentView(row: MarketingIncidentRecord): CredentialHealthActiveIncidentView {
  return {
    id: row.id,
    status: row.status,
    severity: row.severity,
    errorClass: row.errorClass,
    summary: row.sanitizedError,
    incidentUrl: `/admin/marketing/incidents/${row.id}`,
  };
}

export async function buildCredentialHealthDashboardView(
  deps: CredentialHealthDashboardDeps = {},
): Promise<CredentialHealthDashboardView> {
  const env = deps.env ?? process.env;
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const monitoringEnabled = isCredentialMonitoringEnabled(env, nowIso);
  const monitoringEnabledAt = getCredentialMonitoringEnabledAtIso(env);
  const store = resolveCredentialHealthHeartbeatStore(deps.heartbeatStore);
  const listIncidentsFn = deps.listIncidentsFn ?? listIncidents;

  const incidents = monitoringEnabled
    ? await listIncidentsFn({ unresolvedOnly: true, limit: 100 })
    : [];

  const platforms: CredentialHealthPlatformDashboardView[] = [];

  for (const platform of PLATFORMS) {
    const activeIncident = monitoringEnabled
      ? pickActiveCredentialIncident(incidents, platform)
      : null;

    if (!monitoringEnabled) {
      platforms.push({
        platform,
        platformLabel: platformLabel(platform),
        monitoringState: "disabled",
        validity: null,
        healthState: null,
        healthStateLabel: formatHealthStateLabel(null, "disabled"),
        lastSuccessfulValidationAt: null,
        lastValidationAttemptAt: null,
        knownExpiresAt: null,
        expirationStatus: null,
        expirationStatusLabel: expirationStatusLabel(null),
        permissionStatus: "not_checked",
        permissionStatusLabel: permissionStatusLabel("not_checked"),
        monitoringUnavailableWarning: false,
        activeIncident: null,
      });
      continue;
    }

    const stored = await store.load(platform);
    if (!stored) {
      platforms.push({
        platform,
        platformLabel: platformLabel(platform),
        monitoringState: "no_observation",
        validity: "unknown",
        healthState: null,
        healthStateLabel: formatHealthStateLabel(null, "no_observation"),
        lastSuccessfulValidationAt: null,
        lastValidationAttemptAt: null,
        knownExpiresAt: null,
        expirationStatus: null,
        expirationStatusLabel: expirationStatusLabel(null),
        permissionStatus: "not_checked",
        permissionStatusLabel: permissionStatusLabel("not_checked"),
        monitoringUnavailableWarning: false,
        activeIncident: activeIncident ? incidentView(activeIncident) : null,
      });
      continue;
    }

    const safe = storedToClientSafeMetadata(stored);
    const expirationStatus =
      (safe.expiration_knowledge as CredentialHealthPlatformDashboardView["expirationStatus"]) ??
      null;
    const permissionStatus = safe.permission_check ?? "not_checked";
    const healthState = safe.health_state ?? null;
    const monitoringUnavailableWarning =
      safe.health_state === "validation_unavailable" ||
      (stored.consecutive_validation_failures ?? 0) >= 2;

    platforms.push({
      platform,
      platformLabel: platformLabel(platform),
      monitoringState: "observed",
      validity:
        safe.validity === "valid" || safe.validity === "invalid" || safe.validity === "unknown"
          ? safe.validity
          : "unknown",
      healthState,
      healthStateLabel: formatHealthStateLabel(healthState, "observed"),
      lastSuccessfulValidationAt: safe.last_successful_validation_at,
      lastValidationAttemptAt: safe.last_validation_attempt_at,
      knownExpiresAt: safe.evidence?.known_expires_at ?? null,
      expirationStatus,
      expirationStatusLabel: expirationStatusLabel(expirationStatus),
      permissionStatus,
      permissionStatusLabel: permissionStatusLabel(permissionStatus),
      monitoringUnavailableWarning,
      activeIncident: activeIncident ? incidentView(activeIncident) : null,
    });
  }

  return {
    monitoringEnabled,
    monitoringEnabledAt,
    platforms,
  };
}

/** JSON-safe payload for admin API (no internal heartbeat security fields). */
export function serializeCredentialHealthDashboardForApi(
  view: CredentialHealthDashboardView,
): CredentialHealthDashboardView {
  return JSON.parse(JSON.stringify(view)) as CredentialHealthDashboardView;
}
