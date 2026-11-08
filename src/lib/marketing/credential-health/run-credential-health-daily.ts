import type { MarketingIncidentRepository } from "../incidents/repository";
import { getMarketingIncidentRepository } from "../incidents/runtime-repository";
import type { CredentialHealthHeartbeatStore } from "./heartbeat-store";
import { runCredentialMonitoringDailyIfEnabled } from "./daily";
import { runOpenAiCredentialMonitoringDailyIfEnabled } from "./daily-openai";
import { runIntegrationCredentialMonitoringDailyIfEnabled } from "./daily-integrations";
import type { IntegrationCredentialPlatform } from "./integration-platforms";
import type { CredentialProbeFetch } from "./probes";
import type { CredentialNotifyDeps } from "./notify-credential";
import type { MetaCredentialPlatform } from "./types";

export type RunCredentialHealthDailyCronInput = {
  nowIso?: string;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
  heartbeatStore?: CredentialHealthHeartbeatStore;
  incidentRepository?: MarketingIncidentRepository;
  notifyDeps?: CredentialNotifyDeps;
};

export type CredentialHealthDailyCronResult = {
  openai: { ran: boolean };
  meta: { ran: boolean; platforms: MetaCredentialPlatform[] };
  integrations: { ran: boolean; platforms: IntegrationCredentialPlatform[] };
};

export async function runCredentialHealthDailyCron(
  input: RunCredentialHealthDailyCronInput = {},
): Promise<CredentialHealthDailyCronResult> {
  const repository = input.incidentRepository ?? getMarketingIncidentRepository();
  const shared = {
    nowIso: input.nowIso,
    env: input.env,
    fetch: input.fetch,
    heartbeatStore: input.heartbeatStore,
    incidentRepository: repository,
    notifyDeps: input.notifyDeps,
  };

  const [openai, meta, integrations] = await Promise.all([
    runOpenAiCredentialMonitoringDailyIfEnabled(shared),
    runCredentialMonitoringDailyIfEnabled(shared),
    runIntegrationCredentialMonitoringDailyIfEnabled(shared),
  ]);

  return { openai, meta, integrations };
}
