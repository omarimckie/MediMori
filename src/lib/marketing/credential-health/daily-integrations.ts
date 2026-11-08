import type { MarketingIncidentRepository } from "../incidents/repository";
import { getMarketingIncidentRepository } from "../incidents/runtime-repository";
import type { CredentialHealthHeartbeatStore } from "./heartbeat-store";
import { resolveCredentialHealthHeartbeatStore } from "./heartbeat-store-runtime";
import { isIntegrationCredentialMonitoringEnabled } from "./monitoring-config";
import { runIntegrationCredentialHealthMonitor } from "./integration-monitor";
import type { CredentialProbeFetch } from "./probes";
import type { CredentialNotifyDeps } from "./notify-credential";
import { utcDayKey } from "./merge-state";
import {
  INTEGRATION_CREDENTIAL_PLATFORMS,
  type IntegrationCredentialPlatform,
} from "./integration-platforms";

export type RunIntegrationCredentialMonitoringDailyInput = {
  nowIso?: string;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
  heartbeatStore?: CredentialHealthHeartbeatStore;
  incidentRepository?: MarketingIncidentRepository;
  notifyDeps?: CredentialNotifyDeps;
};

export async function runIntegrationCredentialMonitoringDailyIfEnabled(
  input: RunIntegrationCredentialMonitoringDailyInput = {},
): Promise<{ ran: boolean; platforms: IntegrationCredentialPlatform[] }> {
  const env = input.env ?? process.env;
  const nowIso = input.nowIso ?? new Date().toISOString();
  if (!isIntegrationCredentialMonitoringEnabled(env, nowIso)) {
    return { ran: false, platforms: [] };
  }

  const store = resolveCredentialHealthHeartbeatStore(input.heartbeatStore);
  const repository = input.incidentRepository ?? getMarketingIncidentRepository();
  const day = utcDayKey(nowIso);
  const ranPlatforms: IntegrationCredentialPlatform[] = [];

  for (const platform of INTEGRATION_CREDENTIAL_PLATFORMS) {
    const claimed = await store.claimProactiveDailyProbe(platform, day, nowIso);
    if (!claimed) {
      continue;
    }
    await runIntegrationCredentialHealthMonitor({
      platform,
      attemptedAt: nowIso,
      probeKind: "proactive_daily",
      env,
      fetch: input.fetch,
      heartbeatStore: store,
      incidentRepository: repository,
      notifyDeps: input.notifyDeps,
      sourceOperation: `integration_credential_health_daily_probe:${platform}`,
    });
    ranPlatforms.push(platform);
  }

  return { ran: ranPlatforms.length > 0, platforms: ranPlatforms };
}
