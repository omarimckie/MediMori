import { withMarketingPoolTransaction } from "../../credential-health/heartbeat-store-pool";
import { loadVerifiedPrimaryLastSeenAt } from "../qstash-primary/persistence";
import {
  deliverWatchdogOutagePush,
  deliverWatchdogRecoveryPush,
  type DeliverWatchdogPushDeps,
  type WatchdogPushPayload,
} from "./deliver-watchdog-push";
import type { CommitObservationResult, WatchdogRepository } from "./repository";

export type WatchdogTickPushSummary = {
  outage: { attempted: boolean; result?: string };
  recovery: { attempted: boolean; result?: string };
};

export type RunWatchdogTickResult = {
  primaryLastSeenAt: string | null;
  observation: CommitObservationResult;
  push: WatchdogTickPushSummary;
};

export type RunWatchdogTickInput = {
  now: Date;
  githubRunId?: string | null;
  githubRunAttempt?: string | null;
  adminUsername: string;
};

export type RunWatchdogTickDeps = {
  repo: WatchdogRepository;
  /** Must read only verified QStash primary `last_seen_at` (never generic dispatcher heartbeats). */
  loadPrimaryLastSeenAt: () => Promise<string | null>;
  buildOutagePayload?: (input: {
    incidentId: string;
    observation: CommitObservationResult;
  }) => WatchdogPushPayload;
  buildRecoveryPayload?: (input: {
    incidentId: string;
    observation: CommitObservationResult;
  }) => WatchdogPushPayload;
  deliverPushDeps?: DeliverWatchdogPushDeps;
};

export async function loadVerifiedPrimaryLastSeenAtFromPool(): Promise<string | null> {
  return withMarketingPoolTransaction((client) => loadVerifiedPrimaryLastSeenAt(client));
}

function defaultOutagePayload(input: {
  incidentId: string;
  adminUsername: string;
}): WatchdogPushPayload {
  return {
    type: "dispatcher_warning",
    severity: "error",
    title: "Primary QStash dispatcher stale",
    body: "Verified primary QStash heartbeat is stale. Review dispatcher watchdog incident.",
    destination: "/admin/marketing",
    relatedIncidentId: input.incidentId,
    adminUsername: input.adminUsername,
  };
}

function defaultRecoveryPayload(input: {
  incidentId: string;
  adminUsername: string;
}): WatchdogPushPayload {
  return {
    type: "dispatcher_warning",
    severity: "info",
    title: "Primary QStash dispatcher recovered",
    body: "Verified primary QStash heartbeat is healthy again.",
    destination: "/admin/marketing",
    relatedIncidentId: input.incidentId,
    adminUsername: input.adminUsername,
  };
}

export async function deliverWatchdogNotificationsAfterObservation(
  repo: WatchdogRepository,
  input: {
    now: Date;
    adminUsername: string;
    observation: CommitObservationResult;
    buildOutagePayload?: RunWatchdogTickDeps["buildOutagePayload"];
    buildRecoveryPayload?: RunWatchdogTickDeps["buildRecoveryPayload"];
    deliverPushDeps?: DeliverWatchdogPushDeps;
  },
): Promise<WatchdogTickPushSummary> {
  const summary: WatchdogTickPushSummary = {
    outage: { attempted: false },
    recovery: { attempted: false },
  };

  const outageIncidentId = input.observation.state.activeIncidentId;
  const shouldAttemptOutage =
    input.observation.notificationEligibility.outageNotificationEligible &&
    Boolean(outageIncidentId);

  if (shouldAttemptOutage && outageIncidentId) {
    summary.outage.attempted = true;
    const payload =
      input.buildOutagePayload?.({
        incidentId: outageIncidentId,
        observation: input.observation,
      }) ??
      defaultOutagePayload({
        incidentId: outageIncidentId,
        adminUsername: input.adminUsername,
      });
    const result = await deliverWatchdogOutagePush(
      repo,
      { incidentId: outageIncidentId, now: input.now, payload },
      input.deliverPushDeps,
    );
    summary.outage.result = result.status;
  }

  const recoveryIncidentId = input.observation.resolvedIncidentId;
  if (
    input.observation.notificationEligibility.recoveryNotificationEligible &&
    recoveryIncidentId
  ) {
    summary.recovery.attempted = true;
    const payload =
      input.buildRecoveryPayload?.({
        incidentId: recoveryIncidentId,
        observation: input.observation,
      }) ??
      defaultRecoveryPayload({
        incidentId: recoveryIncidentId,
        adminUsername: input.adminUsername,
      });
    const result = await deliverWatchdogRecoveryPush(
      repo,
      { incidentId: recoveryIncidentId, now: input.now, payload },
      input.deliverPushDeps,
    );
    summary.recovery.result = result.status;
  }

  return summary;
}

export async function runWatchdogTick(
  input: RunWatchdogTickInput,
  deps: RunWatchdogTickDeps,
): Promise<RunWatchdogTickResult> {
  const primaryLastSeenAt = await deps.loadPrimaryLastSeenAt();

  const observation = await deps.repo.commitObservation({
    now: input.now,
    primaryLastSeenAt,
    githubRunId: input.githubRunId ?? null,
    githubRunAttempt: input.githubRunAttempt ?? null,
  });

  const push = await deliverWatchdogNotificationsAfterObservation(deps.repo, {
    now: input.now,
    adminUsername: input.adminUsername,
    observation,
    buildOutagePayload: deps.buildOutagePayload,
    buildRecoveryPayload: deps.buildRecoveryPayload,
    deliverPushDeps: deps.deliverPushDeps,
  });

  return {
    primaryLastSeenAt,
    observation,
    push,
  };
}
