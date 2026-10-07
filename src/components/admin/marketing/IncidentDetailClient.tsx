"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createIncidentMutationGate,
  runIncidentResolveMutation,
  runIncidentTransitionMutation,
} from "./incident-detail-mutations";
import type { IncidentApiRecord } from "@/lib/marketing/incidents/api-serialization";
import type { MarketingIncidentEventRecord } from "@/lib/marketing/incidents/types";
import type { MarketingAdminNotificationRecord } from "@/lib/marketing/notifications/types";
import {
  formatEventDescription,
  formatEvidenceEntries,
  formatIncidentTypeLabel,
  formatPermittedActionLabel,
  formatResolutionTypeLabel,
  formatRetrySafetyLabel,
  formatSeverityLabel,
  incidentNeedsResolveSafetyWarning,
  lifecycleActionsForStatus,
  MANUAL_RESOLUTION_OPTIONS,
  PERMITTED_ACTIONS_DISCLAIMER,
  RESOLVE_PRIMARY_WARNING,
  RESOLVE_SAFETY_BLOCK_WARNING,
  RETRY_SAFETY_DISCLAIMER,
} from "@/lib/marketing/incidents/incident-admin-presenters";
import { Card, PrimaryButton, SecondaryButton, StatusPill } from "./ui";

type DetailResponse = {
  incident: IncidentApiRecord;
  events: MarketingIncidentEventRecord[];
  notifications: MarketingAdminNotificationRecord[];
};

export function IncidentDetailClient({ incidentId }: { incidentId: string }) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveSummary, setResolveSummary] = useState("");
  const [resolveType, setResolveType] = useState<"owner_resolved" | "false_positive">(
    "owner_resolved",
  );
  const [showRawActions, setShowRawActions] = useState(false);
  const mutationGateRef = useRef(createIncidentMutationGate());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/admin/marketing/incidents/${incidentId}`);
    if (res.status === 404) {
      setError("Incident not found.");
      setDetail(null);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError("Could not load incident.");
      setDetail(null);
      setLoading(false);
      return;
    }
    setDetail((await res.json()) as DetailResponse);
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleTransition(targetStatus: string) {
    if (!detail || !mutationGateRef.current.tryEnter()) return;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await runIncidentTransitionMutation({
        incidentId,
        targetStatus,
        incidentVersion: detail.incident.incidentVersion,
        fetchFn: fetch,
        reload: load,
      });
      if (outcome.userMessage) setMessage(outcome.userMessage);
    } finally {
      mutationGateRef.current.exit();
      setBusy(false);
    }
  }

  async function handleResolve() {
    if (!detail || !mutationGateRef.current.tryEnter()) return;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await runIncidentResolveMutation({
        incidentId,
        resolutionType: resolveType,
        resolutionSummary: resolveSummary,
        incidentVersion: detail.incident.incidentVersion,
        fetchFn: fetch,
        reload: load,
      });
      if (outcome.userMessage) setMessage(outcome.userMessage);
      if (outcome.closeResolvePanel) {
        setResolveOpen(false);
        if (outcome.success) setResolveSummary("");
      }
    } finally {
      mutationGateRef.current.exit();
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-brand-charcoal/70">Loading incident…</p>;
  }

  if (error || !detail) {
    return (
      <p className="rounded-2xl bg-brand-orange/20 px-4 py-3 text-sm font-semibold" role="alert">
        {error ?? "Incident unavailable."}
      </p>
    );
  }

  const { incident, events, notifications } = detail;
  const lifecycleActions = lifecycleActionsForStatus(incident.status);
  const evidenceEntries = formatEvidenceEntries(incident.evidence);

  return (
    <div className="space-y-4">
      <Link
        href="/admin/marketing/incidents"
        className="text-sm font-bold text-brand-green-deep"
      >
        ← All incidents
      </Link>

      {(message || error) && message ? (
        <p className="rounded-2xl bg-brand-gold/20 px-4 py-3 text-sm font-semibold" role="alert">
          {message}
        </p>
      ) : null}

      <Card>
        <h2 className="text-lg font-extrabold text-brand-navy">Summary</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="font-bold">Type</dt>
            <dd>{formatIncidentTypeLabel(incident.incidentType)}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill status={incident.status} />
            <span className="inline-flex rounded-full bg-cream-deep px-2.5 py-1 text-xs font-bold uppercase">
              Severity: {formatSeverityLabel(incident.severity)}
            </span>
          </div>
          {incident.platform ? (
            <div>
              <dt className="font-bold">Platform</dt>
              <dd>{incident.platform}{incident.provider ? ` (${incident.provider})` : ""}</dd>
            </div>
          ) : null}
          {incident.publicationId ? (
            <div>
              <dt className="font-bold">Publication</dt>
              <dd className="font-mono text-xs">{incident.publicationId}</dd>
            </div>
          ) : null}
          {incident.contentId ? (
            <div>
              <dt className="font-bold">Content</dt>
              <dd className="font-mono text-xs">{incident.contentId}</dd>
            </div>
          ) : null}
          <div>
            <dt className="font-bold">First seen</dt>
            <dd>{new Date(incident.firstSeenAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="font-bold">Last seen</dt>
            <dd>{new Date(incident.lastSeenAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="font-bold">Occurrences</dt>
            <dd>{incident.occurrenceCount}</dd>
          </div>
          {incident.sanitizedError ? (
            <div>
              <dt className="font-bold">Error</dt>
              <dd>{incident.errorClass}: {incident.sanitizedError}</dd>
            </div>
          ) : null}
          {incident.status === "resolved" && incident.resolutionSummary ? (
            <div>
              <dt className="font-bold">Resolution</dt>
              <dd>
                {formatResolutionTypeLabel(incident.resolutionType ?? "owner_resolved")} —{" "}
                {incident.resolutionSummary}
                {incident.resolvedAt
                  ? ` (${new Date(incident.resolvedAt).toLocaleString()})`
                  : ""}
              </dd>
            </div>
          ) : null}
        </dl>
        {(incident.publicationId || incident.contentId) && (
          <div className="mt-4">
            <Link
              href="/admin/marketing/week"
              className="inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal hover:bg-cream-deep"
            >
              View in Your week
            </Link>
            <p className="mt-2 text-xs text-brand-charcoal/60">
              Read-only navigation. Does not retry, publish, or change publication state.
            </p>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold text-brand-navy">Safety (informational)</h2>
        <p className="mt-2 text-sm text-brand-charcoal/75">{RETRY_SAFETY_DISCLAIMER}</p>
        <p className="mt-3 text-sm font-semibold">{formatRetrySafetyLabel(incident.retrySafety)}</p>
        <p className="mt-4 text-xs font-bold uppercase text-brand-green-deep">Permitted actions</p>
        <p className="mt-1 text-xs text-brand-charcoal/60">{PERMITTED_ACTIONS_DISCLAIMER}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {incident.permittedActions.map((action) => (
            <li key={action}>{formatPermittedActionLabel(action)}</li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-2 text-xs font-semibold text-brand-charcoal/60 underline"
          onClick={() => setShowRawActions((v) => !v)}
        >
          {showRawActions ? "Hide" : "Show"} raw action IDs
        </button>
        {showRawActions ? (
          <p className="mt-1 font-mono text-xs text-brand-charcoal/70">
            {incident.permittedActions.join(", ")}
          </p>
        ) : null}
        <p className="mt-3 text-sm">
          Human approval required:{" "}
          <strong>{incident.humanApprovalRequired ? "Yes" : "No"}</strong>
        </p>
      </Card>

      {evidenceEntries.length > 0 ? (
        <Card>
          <h2 className="text-lg font-extrabold text-brand-navy">Evidence</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {evidenceEntries.map((entry) => (
              <div key={entry.key}>
                <dt className="font-bold">{entry.key}</dt>
                <dd className="whitespace-pre-wrap break-words font-mono text-xs">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-lg font-extrabold text-brand-navy">History</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {events.map((event) => (
            <li key={event.id} className="rounded-xl border border-brand-brown/10 p-3">
              <p className="font-bold">{formatEventDescription(event)}</p>
              <p className="text-xs text-brand-charcoal/60">
                {new Date(event.createdAt).toLocaleString()} · {event.actor}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold text-brand-navy">Linked notifications</h2>
        {notifications.length === 0 ? (
          <p className="mt-2 text-sm text-brand-charcoal/70">No linked notifications.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {notifications.map((n) => (
              <li key={n.id} className="rounded-xl border border-brand-brown/10 p-3">
                <p className="font-bold">{n.title}</p>
                <p className="text-xs text-brand-charcoal/60">
                  {new Date(n.createdAt).toLocaleString()} · {n.deliveryStatus}
                  {n.readAt ? " · read" : " · unread"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {incident.status !== "resolved" ? (
        <Card>
          <h2 className="text-lg font-extrabold text-brand-navy">Lifecycle</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {lifecycleActions.map((action) => (
              <SecondaryButton
                key={action.targetStatus}
                type="button"
                disabled={busy}
                onClick={() => void handleTransition(action.targetStatus)}
              >
                {action.label}
              </SecondaryButton>
            ))}
            <PrimaryButton type="button" disabled={busy} onClick={() => setResolveOpen(true)}>
              Resolve incident
            </PrimaryButton>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-brand-charcoal/75">
            This incident is resolved. If the same condition is genuinely observed again, the
            system may reopen this incident automatically.
          </p>
        </Card>
      )}

      {resolveOpen ? (
        <Card>
          <h2 className="text-lg font-extrabold text-brand-navy">Resolve incident</h2>
          <p className="mt-2 text-sm font-semibold text-brand-navy">{RESOLVE_PRIMARY_WARNING}</p>
          {incidentNeedsResolveSafetyWarning(incident.incidentType) ? (
            <p className="mt-2 text-sm text-brand-orange-deep">{RESOLVE_SAFETY_BLOCK_WARNING}</p>
          ) : null}
          <fieldset className="mt-4 space-y-2">
            <legend className="text-sm font-bold">Resolution type</legend>
            {MANUAL_RESOLUTION_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="resolutionType"
                  value={opt.value}
                  checked={resolveType === opt.value}
                  onChange={() =>
                    setResolveType(opt.value as "owner_resolved" | "false_positive")
                  }
                />
                {opt.label}
              </label>
            ))}
          </fieldset>
          <label className="mt-4 block text-sm">
            <span className="font-bold">Summary</span>
            <textarea
              className="mt-1 w-full rounded-xl border border-brand-brown/20 px-3 py-2 text-sm"
              rows={3}
              value={resolveSummary}
              onChange={(e) => setResolveSummary(e.target.value)}
              aria-required="true"
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <PrimaryButton type="button" disabled={busy} onClick={() => void handleResolve()}>
              Confirm resolve
            </PrimaryButton>
            <SecondaryButton
              type="button"
              disabled={busy}
              onClick={() => setResolveOpen(false)}
            >
              Cancel
            </SecondaryButton>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
