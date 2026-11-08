import type { MarketingIncidentRepository } from "../incidents/repository";
import { getMarketingIncidentRepository } from "../incidents/runtime-repository";
import type { CredentialHealthHeartbeatStore } from "./heartbeat-store";
import { resolveCredentialHealthHeartbeatStore } from "./heartbeat-store-runtime";
import { isOpenAiCredentialMonitoringEnabled } from "./monitoring-config";
import { runOpenAiCredentialHealthMonitor } from "./openai-monitor";
import type { CredentialProbeFetch } from "./probes";
import type { CredentialNotifyDeps } from "./notify-credential";
import { utcDayKey } from "./merge-state";

export type RunOpenAiCredentialMonitoringDailyInput = {
  nowIso?: string;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
  heartbeatStore?: CredentialHealthHeartbeatStore;
  incidentRepository?: MarketingIncidentRepository;
  notifyDeps?: CredentialNotifyDeps;
};

export async function runOpenAiCredentialMonitoringDailyIfEnabled(
  input: RunOpenAiCredentialMonitoringDailyInput = {},
): Promise<{ ran: boolean }> {
  const env = input.env ?? process.env;
  const nowIso = input.nowIso ?? new Date().toISOString();
  if (!isOpenAiCredentialMonitoringEnabled(env, nowIso)) {
    return { ran: false };
  }

  const store = resolveCredentialHealthHeartbeatStore(input.heartbeatStore);
  const repository = input.incidentRepository ?? getMarketingIncidentRepository();
  const day = utcDayKey(nowIso);
  const claimed = await store.claimProactiveDailyProbe("openai", day, nowIso);
  if (!claimed) {
    return { ran: false };
  }

  await runOpenAiCredentialHealthMonitor({
    attemptedAt: nowIso,
    probeKind: "proactive_daily",
    env,
    fetch: input.fetch,
    heartbeatStore: store,
    incidentRepository: repository,
    notifyDeps: input.notifyDeps,
    sourceOperation: "openai_credential_health_daily_probe",
  });

  return { ran: true };
}
