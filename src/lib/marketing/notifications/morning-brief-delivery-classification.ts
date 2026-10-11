import type { SendMarketingAdminBroadcastResult } from "./broadcast";

/** No Web Push provider request was accepted (pre-send gates or broadcast finished with zero ok). */
export type MorningBriefDefinitiveZeroAcceptanceReason =
  | "vapid_not_configured"
  | "no_enabled_push_subscriptions"
  | "push_not_delivered"
  | "brief_generation_failed";

/**
 * A. Definitive pre-delivery failure — broadcast was not invoked or could not send.
 * B. Definitive zero-delivery — broadcast completed; pushDelivered === 0 (notification row may exist).
 * C. Ambiguous — a push may have been accepted before durable claim finalization.
 * D. Confirmed provider acceptance — pushDelivered > 0 (not guaranteed handset delivery).
 */
export function classifyBroadcastDeliveryResult(
  result: SendMarketingAdminBroadcastResult,
): "confirmed_provider_acceptance" | "definitive_zero_delivery" {
  return result.pushDelivered > 0
    ? "confirmed_provider_acceptance"
    : "definitive_zero_delivery";
}

export function isDeliveryClaimsSchemaUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  if (record.code === "42P01") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return message.includes("marketing_morning_brief_delivery_claims");
}
