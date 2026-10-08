import { logMarketing } from "../logger";
import { getMarketingStore } from "../context";
import type { MarketingPublication } from "../types";
import {
  failedPublicationsFromPublishCycle,
  publishedPublicationsFromPublishCycle,
} from "../publication-incidents/partial-publication-failure";
import { runMarketingReliabilitySweep, type ReliabilitySweepResult } from "./sweep";

export type RunReliabilityAfterMarketingPublishDeps = {
  runSweep?: () => Promise<ReliabilitySweepResult>;
};

/**
 * Runs reliability detection + incident reconciliation on the marketing-publish clock.
 * Only invoked for bearer CRON_SECRET callers (scheduled QStash / Vercel fallback),
 * not admin-session "Publish due" clicks.
 */
export async function runReliabilityAfterMarketingPublish(
  input: {
    authOk: boolean;
    authReason: string;
    publishCyclePublications?: MarketingPublication[];
  },
  deps: RunReliabilityAfterMarketingPublishDeps = {},
): Promise<ReliabilitySweepResult | null> {
  if (!input.authOk || input.authReason !== "cron_secret") {
    return null;
  }
  const runSweep = deps.runSweep ?? runMarketingReliabilitySweep;
  const cycle = input.publishCyclePublications ?? [];
  const store = getMarketingStore();
  try {
    return await runSweep({
      partialPublicationFailureBackup: {
        failedInCycle: failedPublicationsFromPublishCycle(cycle),
        publishedInCycle: publishedPublicationsFromPublishCycle(cycle),
      },
      store,
    });
  } catch (error) {
    logMarketing({
      operation: "marketing_reliability_sweep",
      success: false,
      error: error instanceof Error ? error.message : "reliability_sweep_failed",
    });
    return null;
  }
}
