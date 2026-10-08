"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CredentialHealthDashboardView } from "@/lib/marketing/credential-health/admin-dashboard";
import { Card, SecondaryButton, StatusPill } from "./ui";

function formatInstant(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}

function validityPill(validity: string | null): string {
  if (validity === "valid") return "valid";
  if (validity === "invalid") return "failed";
  return "draft";
}

export function CredentialHealthClient() {
  const [data, setData] = useState<CredentialHealthDashboardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/marketing/credential-health");
    if (res.status === 401) {
      setError("You are not signed in as a Marketing Admin.");
      setData(null);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError("Could not load credential health.");
      setData(null);
      setLoading(false);
      return;
    }
    const body = (await res.json()) as CredentialHealthDashboardView;
    setData(body);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </SecondaryButton>
        <Link
          href="/admin/marketing/incidents"
          className="inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal hover:bg-cream-deep"
        >
          All incidents
        </Link>
      </div>

      {error ? (
        <p className="rounded-2xl bg-brand-orange/20 px-4 py-3 text-sm font-semibold" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-brand-charcoal/70">Loading credential health…</p>
      ) : null}

      {data ? (
        <>
          <Card>
            <h2 className="font-display text-xl font-bold text-brand-navy">Monitoring</h2>
            <p className="mt-2 text-sm text-brand-charcoal/80">
              {data.monitoringEnabled
                ? `Proactive monitoring is enabled (since ${formatInstant(data.monitoringEnabledAt)}).`
                : "Monitoring is not enabled. Set MARKETING_CREDENTIAL_MONITORING_ENABLED_AT in the server environment to activate checks."}
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {data.platforms.map((platform) => (
              <Card key={platform.platform}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-bold text-brand-navy">
                    {platform.platformLabel}
                  </h3>
                  {platform.monitoringState === "disabled" ? (
                    <StatusPill status="draft" />
                  ) : platform.validity ? (
                    <StatusPill status={validityPill(platform.validity)} />
                  ) : (
                    <StatusPill status="draft" />
                  )}
                </div>

                {platform.monitoringState === "disabled" ? (
                  <p className="mt-3 text-sm font-semibold text-brand-charcoal/80">Not enabled</p>
                ) : null}

                {platform.monitoringUnavailableWarning ? (
                  <p
                    className="mt-3 rounded-2xl bg-brand-gold/25 px-3 py-2 text-sm font-semibold text-brand-navy"
                    role="status"
                  >
                    Unable to verify credential status recently. This does not mean the token is
                    expired.
                  </p>
                ) : null}

                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-brand-charcoal/60">Health status</dt>
                    <dd className="font-semibold text-brand-charcoal">{platform.healthStateLabel}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-brand-charcoal/60">Credential validity</dt>
                    <dd className="font-semibold text-brand-charcoal">
                      {platform.validity ?? "unknown"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-brand-charcoal/60">Last successful validation</dt>
                    <dd className="font-semibold text-brand-charcoal">
                      {formatInstant(platform.lastSuccessfulValidationAt)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-brand-charcoal/60">Last validation attempt</dt>
                    <dd className="font-semibold text-brand-charcoal">
                      {formatInstant(platform.lastValidationAttemptAt)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-brand-charcoal/60">Expiration</dt>
                    <dd className="text-right font-semibold text-brand-charcoal">
                      {platform.knownExpiresAt
                        ? formatInstant(platform.knownExpiresAt)
                        : platform.expirationStatusLabel}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-brand-charcoal/60">Publishing permissions</dt>
                    <dd className="text-right font-semibold text-brand-charcoal">
                      {platform.permissionStatusLabel}
                    </dd>
                  </div>
                </dl>

                {platform.activeIncident ? (
                  <div className="mt-4 rounded-2xl border border-brand-orange/30 bg-cream-deep/50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-brand-orange-deep">
                      Active credential incident
                    </p>
                    <p className="mt-1 text-sm font-semibold text-brand-charcoal">
                      {platform.activeIncident.summary}
                    </p>
                    <p className="mt-1 text-xs text-brand-charcoal/60">
                      {platform.activeIncident.errorClass} · {platform.activeIncident.severity}
                    </p>
                    <Link
                      href={platform.activeIncident.incidentUrl}
                      className="mt-2 inline-block text-sm font-bold text-brand-green-deep hover:underline"
                    >
                      View incident
                    </Link>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
