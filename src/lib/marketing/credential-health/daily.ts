import type { MarketingIncidentRepository } from "../incidents/repository";
import { getMarketingIncidentRepository } from "../incidents/runtime-repository";
import type { CredentialHealthHeartbeatStore } from "./heartbeat-store";
import { resolveCredentialHealthHeartbeatStore } from "./heartbeat-store-runtime";
import { isCredentialMonitoringEnabled } from "./monitoring-config";
import { runCredentialHealthMonitor } from "./monitor";
import type { CredentialProbeFetch } from "./probes";
import { runCredentialProbe } from "./probes";
import type { CredentialNotifyDeps } from "./notify-credential";
import { utcDayKey } from "./merge-state";
import type { MetaCredentialPlatform } from "./types";

const PLATFORMS: MetaCredentialPlatform[] = ["facebook", "instagram"];

export type RunCredentialMonitoringDailyInput = {
  nowIso?: string;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
  heartbeatStore?: CredentialHealthHeartbeatStore;
  incidentRepository?: MarketingIncidentRepository;
  notifyDeps?: CredentialNotifyDeps;
};

export async function runCredentialMonitoringDailyIfEnabled(
  input: RunCredentialMonitoringDailyInput = {},
): Promise<{ ran: boolean; platforms: MetaCredentialPlatform[] }> {
  const env = input.env ?? process.env;
  const nowIso = input.nowIso ?? new Date().toISOString();
  if (!isCredentialMonitoringEnabled(env, nowIso)) {
    return { ran: false, platforms: [] };
  }

  const store = resolveCredentialHealthHeartbeatStore(input.heartbeatStore);
  const repository = input.incidentRepository ?? getMarketingIncidentRepository();
  const day = utcDayKey(nowIso);
  const ranPlatforms: MetaCredentialPlatform[] = [];

  for (const platform of PLATFORMS) {
    const claimed = await store.claimProactiveDailyProbe(platform, day, nowIso);
    if (!claimed) {
      continue;
    }
    await runCredentialHealthMonitor({
      platform,
      attemptedAt: nowIso,
      probeKind: "proactive_daily",
      env,
      fetch: input.fetch,
      heartbeatStore: store,
      incidentRepository: repository,
      notifyDeps: input.notifyDeps,
      sourceOperation: "credential_health_daily_probe",
      runProbe: runCredentialProbe,
    });
    ranPlatforms.push(platform);
  }

  return { ran: ranPlatforms.length > 0, platforms: ranPlatforms };
}
