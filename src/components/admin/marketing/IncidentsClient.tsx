"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { IncidentApiRecord } from "@/lib/marketing/incidents/api-serialization";
import {
  formatIncidentStatusLabel,
  formatIncidentTypeLabel,
  formatRetrySafetyLabel,
  formatSeverityLabel,
  shortResourceId,
} from "@/lib/marketing/incidents/incident-admin-presenters";
import { Card, SecondaryButton, StatusPill } from "./ui";

type ListMode = "unresolved" | "all";

export function IncidentsClient() {
  const [mode, setMode] = useState<ListMode>("unresolved");
  const [incidents, setIncidents] = useState<IncidentApiRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "100" });
    if (mode === "unresolved") params.set("unresolvedOnly", "true");
    const res = await fetch(`/api/admin/marketing/incidents?${params}`);
    if (res.status === 401) {
      setError("You are not signed in as a Marketing Admin.");
      setIncidents([]);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError("Could not load incidents.");
      setIncidents([]);
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { incidents: IncidentApiRecord[] };
    setIncidents(data.incidents ?? []);
    setLoading(false);
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Incident list filter">
        <SecondaryButton
          type="button"
          aria-pressed={mode === "unresolved"}
          className={mode === "unresolved" ? "ring-2 ring-brand-green-deep" : ""}
          onClick={() => setMode("unresolved")}
        >
          Unresolved
        </SecondaryButton>
        <SecondaryButton
          type="button"
          aria-pressed={mode === "all"}
          className={mode === "all" ? "ring-2 ring-brand-green-deep" : ""}
          onClick={() => setMode("all")}
        >
          All
        </SecondaryButton>
        <SecondaryButton type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </SecondaryButton>
      </div>

      {error ? (
        <p className="rounded-2xl bg-brand-orange/20 px-4 py-3 text-sm font-semibold" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-brand-charcoal/70">Loading incidents…</p>
      ) : incidents.length === 0 ? (
        <Card>
          <h2 className="text-lg font-extrabold text-brand-navy">No incidents right now</h2>
          <p className="mt-2 text-sm text-brand-charcoal/80">
            Marketing Autopilot records publication and reliability problems here when they need
            owner attention.
          </p>
          <p className="mt-3 text-sm text-brand-charcoal/70">
            An empty incident list does not guarantee that every publication or channel is healthy.
            Routine review remains available in{" "}
            <Link href="/admin/marketing/week" className="font-bold text-brand-navy underline">
              Your week
            </Link>{" "}
            and{" "}
            <Link
              href="/admin/marketing/notifications"
              className="font-bold text-brand-navy underline"
            >
              Notifications
            </Link>
            .
          </p>
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="Incidents">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <Link
                href={`/admin/marketing/incidents/${incident.id}`}
                className="block rounded-2xl border border-brand-brown/15 bg-white p-4 shadow-sm hover:border-brand-green-deep/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-brand-navy">
                      {formatIncidentTypeLabel(incident.incidentType)}
                    </p>
                    <p className="mt-1 text-xs text-brand-charcoal/60">
                      Last seen {new Date(incident.lastSeenAt).toLocaleString()}
                      {incident.platform ? ` · ${incident.platform}` : ""}
                      {shortResourceId(incident.publicationId)
                        ? ` · pub ${shortResourceId(incident.publicationId)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill status={incident.status} />
                    <span className="inline-flex rounded-full bg-cream-deep px-2.5 py-1 text-xs font-bold uppercase text-brand-charcoal">
                      {formatSeverityLabel(incident.severity)}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-brand-charcoal/70">
                  {formatIncidentStatusLabel(incident.status)} · Occurrences {incident.occurrenceCount}{" "}
                  · {formatRetrySafetyLabel(incident.retrySafety)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
