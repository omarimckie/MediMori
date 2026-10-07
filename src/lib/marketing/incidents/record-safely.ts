import { logMarketing } from "../logger";
import { getMarketingIncidentRepository } from "./runtime-repository";
import { recordIncident } from "./record";
import type { MarketingIncidentRepository } from "./repository";
import type { MarketingIncidentRecord } from "./types";
import type { RecordIncidentInput, RecordIncidentOptions } from "./record-types";
import { sanitizeErrorMessage } from "./sanitize";

export type RecordMarketingIncidentSafelyOptions = RecordIncidentOptions & {
  repository?: MarketingIncidentRepository;
};

/**
 * Observability-only: never throws; does not affect publication/retry/notification authority.
 */
export async function recordMarketingIncidentSafely(
  input: RecordIncidentInput,
  options: RecordMarketingIncidentSafelyOptions = {},
): Promise<MarketingIncidentRecord | null> {
  const repository = options.repository ?? getMarketingIncidentRepository();
  try {
    const result = await recordIncident(repository, input, options);
    return result.incident;
  } catch (error) {
    const message = error instanceof Error ? error.message : "incident_record_failed";
    logMarketing({
      operation: "marketing_incident_record",
      contentId: input.contentId ?? null,
      success: false,
      error: sanitizeErrorMessage(message),
    });
    return null;
  }
}
