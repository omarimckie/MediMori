"use client";

import type { OwnerQueueProjection } from "@/lib/central-agent-manager/orchestration/projections";
import type { ManagerStatusPayload, ProjectAdapterSnapshot } from "@/lib/central-agent-manager/types";
import {
  collectProjectBlockers,
  connectionStatusLabel,
  formatOptionalSourceField,
  formatProgressPercent,
  pendingApprovalLabel,
} from "@/lib/central-agent-manager/source-status-display";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

function connectionBadge(connection: ProjectAdapterSnapshot["connection"]) {
  switch (connection) {
    case "connected":
      return "bg-brand-green/15 text-brand-green-deep";
    case "stale":
      return "bg-brand-yellow-bright/30 text-brand-charcoal";
    case "unavailable":
      return "bg-red-100 text-red-900";
    case "disconnected":
    default:
      return "bg-brand-brown/10 text-brand-charcoal/70";
  }
}

function SourceStatusPanel({ project }: { project: ProjectAdapterSnapshot }) {
  const isLive = project.connection === "connected" || project.connection === "stale";
  const blockers = collectProjectBlockers(project);

  return (
    <div className="mt-4 rounded-2xl border border-brand-brown/10 bg-cream-deep/60 p-4">
      <h3 className="text-sm font-bold text-brand-charcoal">Source status</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">
            Reporting status
          </dt>
          <dd className="text-brand-charcoal">{connectionStatusLabel(project.connection)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">
            Progress (source)
          </dt>
          <dd className="text-brand-charcoal">{formatProgressPercent(project.source)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">
            Milestone
          </dt>
          <dd className="break-words text-brand-charcoal">
            {formatOptionalSourceField(project.source?.milestone)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">
            Checklist item
          </dt>
          <dd className="break-words text-brand-charcoal">
            {formatOptionalSourceField(project.source?.checklistItem)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">
            Last meaningful change
          </dt>
          <dd className="text-brand-charcoal">
            {project.source?.lastMeaningfulStateChange ?? "Not reported"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">
            Pending approvals
          </dt>
          <dd className="text-brand-charcoal">
            {isLive ? pendingApprovalLabel(project.pendingApprovals.length) : "Hidden (not connected)"}
          </dd>
        </div>
      </dl>
      {isLive && blockers.length ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">
            Blockers
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-900">
            {blockers.map((summary) => (
              <li key={summary}>{summary}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectAdapterSnapshot }) {
  const isLive = project.connection === "connected" || project.connection === "stale";

  return (
    <section className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">{project.displayName}</h2>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">
            {project.projectId}
          </p>
        </div>
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${connectionBadge(project.connection)}`}
        >
          {project.connection}
        </span>
      </div>

      <p className="mt-3 text-sm text-brand-charcoal/75">{project.connectionDetail}</p>
      <p className="mt-2 text-xs text-brand-charcoal/60">
        Source snapshot time:{" "}
        {project.lastSuccessfulUpdate ? project.lastSuccessfulUpdate : "—"}
      </p>

      <SourceStatusPanel project={project} />

      {isLive ? (
        <div className="mt-6 space-y-6">
          <div>
            <h3 className="text-sm font-bold text-brand-charcoal">Active agents</h3>
            {project.activeAgents.length ? (
              <ul className="mt-2 space-y-2">
                {project.activeAgents.map((agent) => (
                  <li
                    key={agent.id}
                    className="rounded-2xl border border-brand-brown/10 bg-cream-deep px-4 py-3 text-sm"
                  >
                    <span className="font-semibold">{agent.label}</span>
                    <span className="ml-2 text-brand-charcoal/60">({agent.state})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-brand-charcoal/65">No active agents reported.</p>
            )}
          </div>

          <div>
            <h3 className="text-sm font-bold text-brand-charcoal">Tasks</h3>
            {project.tasks.length ? (
              <ul className="mt-2 space-y-2">
                {project.tasks.map((task) => (
                  <li
                    key={task.id}
                    className="rounded-2xl border border-brand-brown/10 px-4 py-3 text-sm"
                  >
                    <p className="font-semibold text-brand-charcoal">{task.title}</p>
                    <p className="text-xs text-brand-charcoal/60">
                      {task.id} · {task.status}
                    </p>
                    {task.blockers.length ? (
                      <ul className="mt-2 space-y-1">
                        {task.blockers.map((blocker) => (
                          <li key={blocker.id} className="text-xs text-red-800">
                            {blocker.summary}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-brand-charcoal/65">No tasks reported.</p>
            )}
          </div>

          <div>
            <h3 className="text-sm font-bold text-brand-charcoal">Pending approvals</h3>
            {project.pendingApprovals.length ? (
              <ul className="mt-2 space-y-2">
                {project.pendingApprovals.map((approval) => (
                  <li
                    key={approval.id}
                    className="rounded-2xl border border-brand-yellow-bright/40 bg-brand-yellow-bright/10 px-4 py-3 text-sm"
                  >
                    <p className="font-semibold">{approval.summary}</p>
                    <p className="text-xs text-brand-charcoal/60">{approval.id}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-brand-charcoal/65">No pending approvals.</p>
            )}
          </div>

          {project.evidence.length ? (
            <div>
              <h3 className="text-sm font-bold text-brand-charcoal">Evidence</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {project.evidence.map((item) => (
                  <li key={`${item.kind}-${item.label}`}>
                    {item.href ? (
                      <a href={item.href} className="font-semibold text-brand-green-deep underline">
                        {item.label}
                      </a>
                    ) : (
                      <span>{item.label}</span>
                    )}
                    <span className="text-brand-charcoal/55"> · {item.kind}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-6 rounded-2xl border border-dashed border-brand-brown/20 bg-cream-deep px-4 py-3 text-sm text-brand-charcoal/70">
          Live task, agent, and approval details are hidden until this project adapter is
          connected.
        </p>
      )}
    </section>
  );
}

function QueueSimulationPanel({
  queue,
  queueError,
  queueLoading,
  onRefresh,
}: {
  queue: OwnerQueueProjection | null;
  queueError: string | null;
  queueLoading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold text-brand-charcoal">Job queue (simulation)</h2>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-9 items-center rounded-xl border border-brand-brown/20 px-3 text-xs font-bold text-brand-charcoal"
        >
          Reload queue
        </button>
      </div>
      {queue?.simulationNotice ? (
        <p className="mt-3 rounded-2xl border border-brand-yellow-bright/50 bg-brand-yellow-bright/15 px-4 py-3 text-sm font-semibold text-brand-charcoal">
          {queue.simulationNotice}
        </p>
      ) : null}
      {queueError ? (
        <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">{queueError}</p>
      ) : null}
      {queueLoading ? (
        <p className="mt-4 text-sm text-brand-charcoal/70">Loading queue projection…</p>
      ) : queue ? (
        <div className="mt-4 space-y-6 text-sm">
          <div>
            <h3 className="font-bold text-brand-charcoal">Active assignments</h3>
            {queue.activeAssignments.length ? (
              <ul className="mt-2 space-y-2">
                {queue.activeAssignments.map((row) => (
                  <li key={row.id} className="rounded-xl border border-brand-brown/10 bg-cream-deep/60 px-3 py-2">
                    {row.id} · {row.projectId} · agent {row.agentId} · lease until {row.leaseExpiresAt}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-brand-charcoal/65">No active assignments.</p>
            )}
          </div>
          <div>
            <h3 className="font-bold text-brand-charcoal">Waiting for owner</h3>
            {queue.waitingForOwner.length ? (
              <ul className="mt-2 space-y-2">
                {queue.waitingForOwner.map((row) => (
                  <li key={row.jobId} className="rounded-xl border border-brand-yellow-bright/40 bg-brand-yellow-bright/10 px-3 py-2">
                    {row.jobId} ({row.projectId}) · operation {row.operation ?? "—"}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-brand-charcoal/65">No owner decisions pending in simulation.</p>
            )}
          </div>
          <div>
            <h3 className="font-bold text-brand-charcoal">Agent availability</h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {queue.agentAvailability.map((agent) => (
                <li key={agent.id} className="rounded-xl border border-brand-brown/10 px-3 py-2">
                  <span className="font-semibold">{agent.label}</span>
                  <span className="ml-2 text-brand-charcoal/60">
                    {agent.status} · capacity {agent.capacityAvailable ? "yes" : "no"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-bold text-brand-charcoal">Queued by project</h3>
            <div className="mt-2 space-y-4">
              {Object.entries(queue.queuedByProject).map(([projectId, jobs]) => (
                <div key={projectId}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">{projectId}</p>
                  {jobs.length ? (
                    <ul className="mt-1 space-y-1">
                      {jobs.map((job) => (
                        <li key={job.id} className="text-brand-charcoal/80">
                          {job.id} · {job.state} · p{job.priority}
                          {job.blockReason ? ` · ${job.blockReason}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-brand-charcoal/60">—</p>
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-brand-charcoal/55">{queue.estimatedRemainingWork.disclaimer}</p>
        </div>
      ) : null}
    </section>
  );
}

export function CentralAgentManagerClient() {
  const router = useRouter();
  const [payload, setPayload] = useState<ManagerStatusPayload | null>(null);
  const [queue, setQueue] = useState<OwnerQueueProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(true);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    const url = refresh
      ? "/api/admin/central-agent-manager/status?refresh=true"
      : "/api/admin/central-agent-manager/status";
    const response = await fetch(url, {
      cache: "no-store",
    });
    if (response.status === 401) {
      router.push("/admin/login");
      return;
    }
    if (response.status === 403) {
      setError("This dashboard is restricted to owner accounts.");
      setLoading(false);
      return;
    }
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Could not load manager status.");
      setLoading(false);
      return;
    }
    setPayload((await response.json()) as ManagerStatusPayload);
    setLoading(false);
  }, [router]);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    const response = await fetch("/api/admin/central-agent-manager/queue", { cache: "no-store" });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setQueueError(data.error ?? "Could not load queue projection.");
      setQueueLoading(false);
      return;
    }
    setQueue((await response.json()) as OwnerQueueProjection);
    setQueueLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(false);
      void loadQueue();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, loadQueue]);

  return (
    <div className="space-y-6">
      <QueueSimulationPanel
        queue={queue}
        queueError={queueError}
        queueLoading={queueLoading}
        onRefresh={() => void loadQueue()}
      />
      <div className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
        {payload?.mockDemonstration ? (
          <p className="mb-3 rounded-2xl border border-brand-yellow-bright/50 bg-brand-yellow-bright/15 px-4 py-3 text-sm font-semibold text-brand-charcoal">
            Mock demonstration — synthetic contract v1 fixtures only. Not connected to real
            satellites.
          </p>
        ) : null}
        <p className="text-sm text-brand-charcoal/75">
          Consolidated read-only view across registered projects. Refresh manually to update;
          there is no background polling.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            className="inline-flex h-10 items-center rounded-xl bg-brand-green-deep px-4 text-sm font-bold text-white transition hover:brightness-95"
          >
            Refresh
          </button>
        </div>
        {payload ? (
          <div className="mt-3 space-y-1 text-xs text-brand-charcoal/55">
            <p>
              Generated {payload.generatedAt} · stale threshold {payload.staleAfterMs} ms
            </p>
            <p>
              Data retrieval:{" "}
              {payload.retrieval === "cached" ? "cached (may not be current)" : "fresh"} ·{" "}
              {payload.cacheTtlMs
                ? `cache TTL ${payload.cacheTtlMs} ms (in-memory, per server instance)`
                : "cache disabled"}
            </p>
            {payload.retrieval === "cached" && payload.cachedAt ? (
              <p>Cached at {payload.cachedAt}</p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-brand-charcoal/70">Loading manager status…</p>
      ) : payload ? (
        <div className="space-y-6">
          {payload.projects.map((project) => (
            <ProjectCard key={project.projectId} project={project} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
