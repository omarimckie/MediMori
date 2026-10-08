import type { MarketingPublication } from "../types";
import type { MarketingIncidentRepository } from "../incidents/repository";
import { getMarketingIncidentRepository } from "../incidents/runtime-repository";
import { logMarketing } from "../logger";
import { sanitizeErrorMessage } from "../incidents/sanitize";
import {
  isCredentialClassPublicationError,
  evaluatePublicationFailedCapture,
} from "../publication-incidents/publication-failed-eligibility";
import { parsePublicationErrorClass } from "../publication-incidents/evidence";
import { isCredentialMonitoringEnabled } from "./monitoring-config";
import { runReactiveCredentialHealthMonitor } from "./monitor";
import type { MetaCredentialPlatform } from "./types";
import type { CredentialNotifyDeps } from "./notify-credential";
import type { CredentialHealthHeartbeatStore } from "./heartbeat-store";

function metaPlatformFromPublication(
  publication: MarketingPublication,
): MetaCredentialPlatform | null {
  if (publication.platform === "facebook" || publication.platform === "instagram") {
    return publication.platform;
  }
  return null;
}

/**
 * Reactive credential monitoring from authoritative publish failures.
 * Does not alter publication_failed capture, retries, or B1/B2 behavior.
 */
export async function observeReactiveCredentialFailure(
  publication: MarketingPublication,
  input: {
    sourceOperation: string;
    repository?: MarketingIncidentRepository;
    notifyDeps?: CredentialNotifyDeps;
    heartbeatStore?: CredentialHealthHeartbeatStore;
    env?: Record<string, string | undefined>;
    nowIso?: string;
  },
): Promise<void> {
  if (publication.status !== "failed") {
    return;
  }
  const decision = evaluatePublicationFailedCapture(publication);
  if (decision.capture || decision.reason !== "credential_class") {
    return;
  }
  const platform = metaPlatformFromPublication(publication);
  if (!platform) {
    return;
  }
  const env = input.env ?? process.env;
  const nowIso = input.nowIso ?? new Date().toISOString();
  if (!isCredentialMonitoringEnabled(env, nowIso)) {
    return;
  }
  const errorClass = parsePublicationErrorClass(publication.lastError);
  if (!isCredentialClassPublicationError(errorClass)) {
    return;
  }
  try {
    await runReactiveCredentialHealthMonitor({
      platform,
      errorClass,
      attemptedAt: nowIso,
      env,
      heartbeatStore: input.heartbeatStore,
      incidentRepository: input.repository ?? getMarketingIncidentRepository(),
      notifyDeps: input.notifyDeps,
      sourceOperation: input.sourceOperation,
    });
  } catch (error) {
    logMarketing({
      operation: "credential_health_reactive",
      contentId: publication.contentId,
      success: false,
      error: sanitizeErrorMessage(
        error instanceof Error ? error.message : "reactive_credential_failed",
      ),
    });
  }
}
