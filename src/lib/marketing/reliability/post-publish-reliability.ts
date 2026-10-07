import { logMarketing } from "../logger";
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
  },
  deps: RunReliabilityAfterMarketingPublishDeps = {},
): Promise<ReliabilitySweepResult | null> {
  if (!input.authOk || input.authReason !== "cron_secret") {
    return null;
  }
  const runSweep = deps.runSweep ?? runMarketingReliabilitySweep;
  try {
    return await runSweep();
  } catch (error) {
    logMarketing({
      operation: "marketing_reliability_sweep",
      success: false,
      error: error instanceof Error ? error.message : "reliability_sweep_failed",
    });
    return null;
  }
}
