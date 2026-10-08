import type { MarketingIncidentRepository } from "../incidents/repository";
import { fingerprintMetaAccessToken } from "./fingerprint";
import type { CredentialHealthHeartbeatStore } from "./heartbeat-store";
import { resolveCredentialHealthHeartbeatStore } from "./heartbeat-store-runtime";
import {
  getCredentialFingerprintKeyEpoch,
  isCredentialMonitoringEnabled,
} from "./monitoring-config";
import { mergeCredentialHealthState, priorFromStored, utcDayKey } from "./merge-state";
import {
  recordCredentialWarningIncident,
  resolveCredentialWarningIfRecovered,
  findOpenCredentialWarningIncident,
} from "./incidents";
import type { CredentialNotifyDeps } from "./notify-credential";
import { notifyCredentialHealthOutcomes } from "./notify-credential";
import type { CredentialProbeFetch } from "./probes";
import { runCredentialProbe } from "./probes";
import { readAccessTokenForFingerprint } from "./probes";
import { buildCredentialHealthSnapshot } from "./snapshot";
import type { CredentialProbeKind } from "./policy";
import {
  incidentSeverityForClassification,
  severityRank,
  shouldOpenCredentialWarningIncident,
} from "./policy";
import type { CredentialValidationAttempt, MetaCredentialPlatform } from "./types";
import { credentialAttemptFromReactivePublishFailure } from "./reactive-attempt";

export type RunCredentialHealthMonitorInput = {
  platform: MetaCredentialPlatform;
  attemptedAt: string;
  probeKind: CredentialProbeKind;
  attempt?: CredentialValidationAttempt;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
  heartbeatStore?: CredentialHealthHeartbeatStore;
  incidentRepository?: MarketingIncidentRepository;
  notifyDeps?: CredentialNotifyDeps;
  referenceNowIso?: string;
  sourceOperation: string;
  runProbe?: typeof runCredentialProbe;
};

export type CredentialHealthMonitorResult = {
  skipped: boolean;
  reason?: string;
  stored?: Awaited<ReturnType<CredentialHealthHeartbeatStore["saveMerged"]>>;
};

async function escalateSeverityIfNeeded(
  repository: MarketingIncidentRepository,
  platform: MetaCredentialPlatform,
  attemptedAt: string,
  severity: "error" | "warning",
): Promise<void> {
  const open = await findOpenCredentialWarningIncident(repository, platform);
  if (!open) {
    return;
  }
  if (severityRank(severity) <= severityRank(open.severity)) {
    return;
  }
  await repository.updateIncident(open.id, open.incidentVersion, {
    severity,
    lastSeenAt: attemptedAt,
  });
}

export async function runCredentialHealthMonitor(
  input: RunCredentialHealthMonitorInput,
): Promise<CredentialHealthMonitorResult> {
  const env = input.env ?? process.env;
  if (!isCredentialMonitoringEnabled(env, input.attemptedAt)) {
    return { skipped: true, reason: "monitoring_disabled" };
  }

  const store = resolveCredentialHealthHeartbeatStore(input.heartbeatStore);
  const probeRunner = input.runProbe;
  let attempt = input.attempt;
  if (!attempt) {
    if (!probeRunner) {
      return { skipped: true, reason: "probe_runner_missing" };
    }
    attempt = await probeRunner({
      platform: input.platform,
      attemptedAt: input.attemptedAt,
      env,
      fetch: input.fetch,
    });
  }

  const token = readAccessTokenForFingerprint(input.platform, env);
  const fingerprint = fingerprintMetaAccessToken(input.platform, token ?? "", env);
  const previous = await store.load(input.platform);
  const prior = priorFromStored(previous);
  const snapshot = buildCredentialHealthSnapshot({
    attempt,
    credentialFingerprint: fingerprint,
    lastSuccessfulValidationAt: prior.lastSuccessfulValidationAt,
    referenceNowIso: input.referenceNowIso,
  });

  const fingerprintKeyEpoch = getCredentialFingerprintKeyEpoch(env);
  const proactiveDailyDay =
    input.probeKind === "proactive_daily" ? utcDayKey(input.attemptedAt) : null;

  const stored = await store.saveMerged(
    input.platform,
    (prev) =>
      mergeCredentialHealthState({
        snapshot,
        previous: prev,
        probeKind: input.probeKind,
        fingerprintKeyEpoch,
        proactiveDailyDay,
      }),
    { attemptedAtIso: input.attemptedAt },
  );

  let incidentOutcome: "created" | "reopened" | "occurrence" | null = null;
  let incidentRecord = null;

  if (input.incidentRepository) {
    await resolveCredentialWarningIfRecovered({
      platform: input.platform,
      classification: snapshot.classification,
      repository: input.incidentRepository,
      sourceOperation: input.sourceOperation,
    });

    const openIncident = await findOpenCredentialWarningIncident(
      input.incidentRepository,
      input.platform,
    );

    const shouldOpen = shouldOpenCredentialWarningIncident(
      snapshot.classification,
      input.probeKind,
    );

    if (shouldOpen) {
      const severity = incidentSeverityForClassification(snapshot.classification);
      await escalateSeverityIfNeeded(
        input.incidentRepository,
        input.platform,
        input.attemptedAt,
        severity,
      );
      const recordResult = await recordCredentialWarningIncident({
        platform: input.platform,
        classification: snapshot.classification,
        attempt,
        credentialFingerprint: null,
        lastSuccessfulValidationAt: stored.last_successful_validation_at,
        sourceOperation: input.sourceOperation,
        repository: input.incidentRepository,
        probeKind: input.probeKind,
      });
      if (recordResult) {
        incidentOutcome = recordResult.outcome;
        incidentRecord = recordResult.incident;
      }
    }

    const notifyResult = await notifyCredentialHealthOutcomes({
      platform: input.platform,
      classification: snapshot.classification,
      incident: incidentRecord ?? openIncident,
      incidentOutcome,
      consecutiveDailyUnavailable: stored.consecutive_validation_failures,
      monitoringUnavailablePushSent: stored.monitoring_unavailable_push_sent,
      immediateAuthFailure: input.probeKind === "reactive",
      deps: input.notifyDeps,
    });

    if (
      notifyResult.monitoringUnavailablePushSent !== stored.monitoring_unavailable_push_sent
    ) {
      await store.saveMerged(
        input.platform,
        (prev) =>
          prev
            ? {
                ...prev,
                monitoring_unavailable_push_sent: notifyResult.monitoringUnavailablePushSent,
              }
            : stored,
        { attemptedAtIso: input.attemptedAt },
      );
    }
  }

  return { skipped: false, stored };
}

export async function runReactiveCredentialHealthMonitor(input: {
  platform: MetaCredentialPlatform;
  errorClass: string;
  attemptedAt: string;
  env?: Record<string, string | undefined>;
  heartbeatStore?: CredentialHealthHeartbeatStore;
  incidentRepository?: MarketingIncidentRepository;
  notifyDeps?: CredentialNotifyDeps;
  sourceOperation: string;
  credentialsConfigured?: boolean;
}): Promise<CredentialHealthMonitorResult> {
  const attempt = credentialAttemptFromReactivePublishFailure({
    platform: input.platform,
    attemptedAt: input.attemptedAt,
    errorClass: input.errorClass,
    credentialsConfigured: input.credentialsConfigured,
  });
  return runCredentialHealthMonitor({
    platform: input.platform,
    attemptedAt: input.attemptedAt,
    probeKind: "reactive",
    attempt,
    env: input.env,
    heartbeatStore: input.heartbeatStore,
    incidentRepository: input.incidentRepository,
    notifyDeps: input.notifyDeps,
    sourceOperation: input.sourceOperation,
  });
}
