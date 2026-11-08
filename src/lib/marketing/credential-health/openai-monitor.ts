import type { MarketingIncidentRepository } from "../incidents/repository";
import { fingerprintOpenAiApiKey } from "./fingerprint";
import type { CredentialHealthHeartbeatStore } from "./heartbeat-store";
import { resolveCredentialHealthHeartbeatStore } from "./heartbeat-store-runtime";
import {
  getCredentialFingerprintKeyEpoch,
  isOpenAiCredentialMonitoringEnabled,
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
import { runOpenAiCredentialProbe } from "./openai-probe";
import { buildCredentialHealthSnapshotForAttempt } from "./snapshot";
import type { CredentialProbeKind } from "./policy";
import {
  incidentSeverityForClassification,
  severityRank,
  shouldOpenCredentialWarningIncident,
} from "./policy";

export type RunOpenAiCredentialHealthMonitorInput = {
  attemptedAt: string;
  probeKind: CredentialProbeKind;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
  heartbeatStore?: CredentialHealthHeartbeatStore;
  incidentRepository?: MarketingIncidentRepository;
  notifyDeps?: CredentialNotifyDeps;
  referenceNowIso?: string;
  sourceOperation: string;
};

export type OpenAiCredentialHealthMonitorResult = {
  skipped: boolean;
  reason?: string;
  stored?: Awaited<ReturnType<CredentialHealthHeartbeatStore["saveMerged"]>>;
};

async function escalateSeverityIfNeeded(
  repository: MarketingIncidentRepository,
  attemptedAt: string,
  severity: "error" | "warning",
): Promise<void> {
  const open = await findOpenCredentialWarningIncident(repository, "openai");
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

export async function runOpenAiCredentialHealthMonitor(
  input: RunOpenAiCredentialHealthMonitorInput,
): Promise<OpenAiCredentialHealthMonitorResult> {
  const env = input.env ?? process.env;
  if (!isOpenAiCredentialMonitoringEnabled(env, input.attemptedAt)) {
    return { skipped: true, reason: "openai_monitoring_disabled" };
  }

  const store = resolveCredentialHealthHeartbeatStore(input.heartbeatStore);
  const attempt = await runOpenAiCredentialProbe({
    attemptedAt: input.attemptedAt,
    env,
    fetch: input.fetch,
  });

  const fingerprint = fingerprintOpenAiApiKey(env);
  const previous = await store.load("openai");
  const prior = priorFromStored(previous);
  const snapshot = buildCredentialHealthSnapshotForAttempt({
    attempt,
    credentialFingerprint: fingerprint,
    lastSuccessfulValidationAt: prior.lastSuccessfulValidationAt,
    referenceNowIso: input.referenceNowIso,
  });

  const fingerprintKeyEpoch = getCredentialFingerprintKeyEpoch(env);
  const proactiveDailyDay =
    input.probeKind === "proactive_daily" ? utcDayKey(input.attemptedAt) : null;

  const stored = await store.saveMerged(
    "openai",
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
      platform: "openai",
      classification: snapshot.classification,
      repository: input.incidentRepository,
      sourceOperation: input.sourceOperation,
    });

    const openIncident = await findOpenCredentialWarningIncident(
      input.incidentRepository,
      "openai",
    );

    const shouldOpen = shouldOpenCredentialWarningIncident(
      snapshot.classification,
      input.probeKind,
    );

    if (shouldOpen) {
      const severity = incidentSeverityForClassification(snapshot.classification);
      await escalateSeverityIfNeeded(
        input.incidentRepository,
        input.attemptedAt,
        severity,
      );
      const recordResult = await recordCredentialWarningIncident({
        platform: "openai",
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
      platform: "openai",
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
        "openai",
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
