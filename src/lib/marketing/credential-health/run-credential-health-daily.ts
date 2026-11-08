import type { MarketingIncidentRepository } from "../incidents/repository";
import { getMarketingIncidentRepository } from "../incidents/runtime-repository";
import type { CredentialHealthHeartbeatStore } from "./heartbeat-store";
import { runCredentialMonitoringDailyIfEnabled } from "./daily";
import { runOpenAiCredentialMonitoringDailyIfEnabled } from "./daily-openai";
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

  const [openai, meta] = await Promise.all([
    runOpenAiCredentialMonitoringDailyIfEnabled(shared),
    runCredentialMonitoringDailyIfEnabled(shared),
  ]);

  return { openai, meta };
}
