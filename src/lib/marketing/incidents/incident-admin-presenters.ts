import { legalTransitionsFrom } from "./lifecycle";
import type {
  MarketingIncidentEventRecord,
  MarketingIncidentStatus,
  MarketingIncidentType,
  PermittedAction,
  ResolutionType,
  RetrySafety,
} from "./types";

export type IncidentLifecycleAction = {
  targetStatus: MarketingIncidentStatus;
  label: string;
};

const LIFECYCLE_ACTION_LABELS: Record<MarketingIncidentStatus, string> = {
  investigating: "Start investigation",
  action_required: "Needs action",
  blocked: "Mark blocked",
  open: "Resume investigation",
  resolved: "Resolve",
};

export function lifecycleActionsForStatus(
  status: MarketingIncidentStatus,
): IncidentLifecycleAction[] {
  if (status === "resolved") return [];
  const targets = legalTransitionsFrom(status).filter((s) => s !== "resolved");
  return targets.map((targetStatus) => ({
    targetStatus,
    label:
      status === "open" && targetStatus === "investigating"
        ? "Start investigation"
        : status === "action_required" && targetStatus === "investigating"
          ? "Resume investigation"
          : status === "blocked" && targetStatus === "investigating"
            ? "Resume investigation"
            : targetStatus === "action_required"
              ? "Needs action"
              : targetStatus === "blocked"
                ? "Mark blocked"
                : LIFECYCLE_ACTION_LABELS[targetStatus] ?? targetStatus.replaceAll("_", " "),
  }));
}

export function formatIncidentTypeLabel(type: MarketingIncidentType | string): string {
  const labels: Record<string, string> = {
    publication_failed: "Publication failed",
    partial_publication_failure: "Partial publication failure",
    publication_ambiguous: "Ambiguous publish outcome",
    publication_overdue: "Publication overdue",
    publication_stuck_processing: "Publication stuck processing",
    publication_recovery_required: "Publication recovery required",
    credential_warning: "Credential warning",
    dispatcher_warning: "Dispatcher warning",
    smart_upload_caption_failed: "Smart Upload caption failed",
    smart_upload_finalize_failed: "Smart Upload finalize failed",
    smart_upload_operational_failed: "Smart Upload operational failed",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

export function formatIncidentStatusLabel(status: MarketingIncidentStatus | string): string {
  return status.replaceAll("_", " ");
}

export function formatSeverityLabel(severity: string): string {
  return severity;
}

export function formatRetrySafetyLabel(retrySafety: RetrySafety | string): string {
  const labels: Record<string, string> = {
    safe_automatic: "Automatic retry may be appropriate (system safety rules still apply)",
    safe_manual: "Manual retry may be appropriate after review",
    unsafe_duplicate_risk: "Do not retry — duplicate publication risk",
    unknown_requires_verification: "Verify outcome before any publication action",
    not_applicable: "Retry safety not applicable",
  };
  return labels[retrySafety] ?? String(retrySafety);
}

export function formatPermittedActionLabel(action: PermittedAction | string): string {
  const labels: Record<string, string> = {
    investigate_read_only: "Investigate (read-only)",
    notify_owner: "Notify owner",
    admin_retry_publication: "Admin retry publication (not available in Incidents UI)",
    cron_retry_publication: "Cron retry publication (not available in Incidents UI)",
    schedule_reschedule: "Schedule or reschedule",
    reconcile_meta_read_only: "Reconcile Meta (read-only; not available in Incidents UI)",
    owner_approve_remediation: "Owner approval may be required for remediation",
    no_op: "No operation",
  };
  return labels[action] ?? String(action).replaceAll("_", " ");
}

export const MANUAL_RESOLUTION_OPTIONS: { value: ResolutionType; label: string }[] = [
  { value: "owner_resolved", label: "Resolved by owner" },
  { value: "false_positive", label: "Not actually an issue" },
];

export function formatResolutionTypeLabel(type: ResolutionType | string): string {
  const match = MANUAL_RESOLUTION_OPTIONS.find((o) => o.value === type);
  if (match) return match.label;
  return String(type).replaceAll("_", " ");
}

export function incidentNeedsResolveSafetyWarning(type: MarketingIncidentType | string): boolean {
  return type === "publication_ambiguous" || type === "publication_recovery_required";
}

export function shortResourceId(id: string | null | undefined): string | null {
  if (!id?.trim()) return null;
  const trimmed = id.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 8)}…`;
}

export function formatEvidenceEntries(
  evidence: Record<string, unknown>,
): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(evidence ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") {
      entries.push({ key, value: JSON.stringify(value, null, 2) });
    } else {
      entries.push({ key, value: String(value) });
    }
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

export function formatEventDescription(event: MarketingIncidentEventRecord): string {
  const payload = event.payload ?? {};
  switch (event.eventType) {
    case "status_changed": {
      const from = payload.from ?? "?";
      const to = payload.to ?? "?";
      return `Status changed: ${String(from)} → ${String(to)}`;
    }
    case "incident_resolved":
      return `Resolved (${String(payload.resolutionType ?? "owner_resolved")})`;
    case "incident_reopened":
      return "Incident reopened after genuine re-observation";
    case "occurrence_recorded":
      return `Occurrence recorded (count ${String(payload.occurrenceCount ?? "")})`;
    case "incident_created":
      return "Incident created";
    default: {
      const eventType = event.eventType as string;
      return eventType.replaceAll("_", " ");
    }
  }
}

export const RETRY_SAFETY_DISCLAIMER =
  "Retry safety describes the incident when it was recorded. It is informational here and does not grant permission to publish.";

export const PERMITTED_ACTIONS_DISCLAIMER =
  "Permitted actions describe the recorded safety envelope. They do not enable actions in this UI.";

export const RESOLVE_PRIMARY_WARNING =
  "Resolving closes the operational incident. It does not fix the publication, clear ambiguity, enable retry, or call Meta.";

export const RESOLVE_SAFETY_BLOCK_WARNING =
  "Publication safety blocks may still apply on Your week. Resolving this incident does not remove them.";
