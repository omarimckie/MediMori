import { logMarketing } from "../logger";
import type { MarketingStore } from "../store";
import { sendMarketingAdminBroadcastNotification } from "./broadcast";
import { buildMorningMarketingBrief } from "./morning-brief";
import {
  classifyBroadcastDeliveryResult,
  isDeliveryClaimsSchemaUnavailableError,
} from "./morning-brief-delivery-classification";
import { isMorningBriefDeliveryEligible } from "./morning-brief-eligibility";
import {
  resolveMorningBriefDeliveryClaimRepository,
  type MorningBriefDeliveryClaimRepository,
} from "./morning-brief-delivery-claims";
import { getMorningBriefPreferences } from "./preferences";
import { getWebPushVapidPublicKey } from "./vapid";
import { listAllEnabledPushSubscriptions } from "./notifications-repository";

export const MORNING_BRIEF_PUSH_BODY_MAX_CHARS = 900;

export type MorningBriefDeliveryOutcome =
  | { status: "skipped"; reason: string }
  | { status: "duplicate"; dedupeKey: string; claimStatus: string }
  | { status: "delivered"; dedupeKey: string; notificationId: string; pushDelivered: number }
  | { status: "failed"; dedupeKey: string; notificationId?: string; reason: string }
  | { status: "ambiguous"; dedupeKey: string; reason: string };

export type RunMorningBriefDeliveryInput = {
  store: MarketingStore;
  now?: Date;
  claims?: MorningBriefDeliveryClaimRepository;
  buildBrief?: typeof buildMorningMarketingBrief;
};

function appendOperationalMetricsDisclaimer(body: string): string {
  return [
    body,
    "",
    "Note: Social engagement analytics (Meta/Pinterest Insights) are not included in this brief.",
  ].join("\n");
}

function truncatePushBody(body: string): string {
  if (body.length <= MORNING_BRIEF_PUSH_BODY_MAX_CHARS) {
    return body;
  }
  return `${body.slice(0, MORNING_BRIEF_PUSH_BODY_MAX_CHARS - 1)}…`;
}

async function acquireMorningBriefDeliveryClaim(
  claims: MorningBriefDeliveryClaimRepository,
  input: { dedupeKey: string; timezone: string; localDate: string },
): Promise<{ acquired: true } | { acquired: false; claimStatus: string }> {
  const existing = await claims.getClaim(input.dedupeKey);
  if (existing) {
    if (existing.status === "failed") {
      const reclaimed = await claims.reclaimFailedClaim(input.dedupeKey);
      if (reclaimed) {
        return { acquired: true };
      }
      const row = await claims.getClaim(input.dedupeKey);
      return { acquired: false, claimStatus: row?.status ?? "failed" };
    }
    return { acquired: false, claimStatus: existing.status };
  }

  const claimResult = await claims.tryClaim(input);
  if (claimResult === "claimed") {
    return { acquired: true };
  }
  const row = await claims.getClaim(input.dedupeKey);
  return { acquired: false, claimStatus: row?.status ?? "claimed" };
}

export async function runMorningBriefDeliveryIfDue(
  input: RunMorningBriefDeliveryInput,
): Promise<MorningBriefDeliveryOutcome> {
  try {
    return await runMorningBriefDeliveryIfDueCore(input);
  } catch (error) {
    if (isDeliveryClaimsSchemaUnavailableError(error)) {
      logMarketing({
        operation: "morning_brief_delivery",
        success: false,
        error: "delivery_claims_schema_unavailable",
      });
      return { status: "skipped", reason: "delivery_claims_schema_unavailable" };
    }
    throw error;
  }
}

async function runMorningBriefDeliveryIfDueCore(
  input: RunMorningBriefDeliveryInput,
): Promise<MorningBriefDeliveryOutcome> {
  const now = input.now ?? new Date();
  const claims = input.claims ?? resolveMorningBriefDeliveryClaimRepository();
  const buildBrief = input.buildBrief ?? buildMorningMarketingBrief;
  const prefs = await getMorningBriefPreferences(input.store);

  const eligibility = isMorningBriefDeliveryEligible(now, prefs);
  if (!eligibility.eligible) {
    return { status: "skipped", reason: eligibility.reason };
  }

  const lock = await acquireMorningBriefDeliveryClaim(claims, {
    dedupeKey: eligibility.dedupeKey,
    timezone: prefs.timezone,
    localDate: eligibility.localDate,
  });
  if (!lock.acquired) {
    return {
      status: "duplicate",
      dedupeKey: eligibility.dedupeKey,
      claimStatus: lock.claimStatus,
    };
  }

  if (!getWebPushVapidPublicKey()) {
    await claims.completeClaim({
      dedupeKey: eligibility.dedupeKey,
      status: "failed",
    });
    return { status: "failed", dedupeKey: eligibility.dedupeKey, reason: "vapid_not_configured" };
  }

  const subscriptions = await listAllEnabledPushSubscriptions();
  if (!subscriptions.length) {
    await claims.completeClaim({
      dedupeKey: eligibility.dedupeKey,
      status: "failed",
    });
    return {
      status: "failed",
      dedupeKey: eligibility.dedupeKey,
      reason: "no_enabled_push_subscriptions",
    };
  }

  let broadcastInvoked = false;
  try {
    const brief = await buildBrief(input.store, now);
    const payload = {
      ...brief.payload,
      body: truncatePushBody(appendOperationalMetricsDisclaimer(brief.payload.body)),
    };

    broadcastInvoked = true;
    const result = await sendMarketingAdminBroadcastNotification({
      ...payload,
      deliverPush: true,
    });

    const deliveryClass = classifyBroadcastDeliveryResult(result);
    if (deliveryClass === "confirmed_provider_acceptance") {
      const completed = await claims.completeClaim({
        dedupeKey: eligibility.dedupeKey,
        status: "delivered",
        notificationId: result.notification.id,
      });
      if (!completed) {
        logMarketing({
          operation: "morning_brief_delivery",
          success: false,
          error: "claim_finalize_race",
        });
        return {
          status: "ambiguous",
          dedupeKey: eligibility.dedupeKey,
          reason: "claim_finalize_race_after_provider_accept",
        };
      }
      logMarketing({
        operation: "morning_brief_delivery",
        success: true,
        durationMs: 0,
      });
      return {
        status: "delivered",
        dedupeKey: eligibility.dedupeKey,
        notificationId: result.notification.id,
        pushDelivered: result.pushDelivered,
      };
    }

    await claims.completeClaim({
      dedupeKey: eligibility.dedupeKey,
      status: "failed",
      notificationId: result.notification.id,
    });
    return {
      status: "failed",
      dedupeKey: eligibility.dedupeKey,
      notificationId: result.notification.id,
      reason: "push_not_delivered",
    };
  } catch (error) {
    logMarketing({
      operation: "morning_brief_delivery",
      success: false,
      error: error instanceof Error ? error.message : "morning_brief_delivery_failed",
    });
    if (!broadcastInvoked) {
      await claims.completeClaim({
        dedupeKey: eligibility.dedupeKey,
        status: "failed",
      });
      return {
        status: "failed",
        dedupeKey: eligibility.dedupeKey,
        reason: "brief_generation_failed",
      };
    }
    const completed = await claims.completeClaim({
      dedupeKey: eligibility.dedupeKey,
      status: "ambiguous",
    });
    if (!completed) {
      return {
        status: "ambiguous",
        dedupeKey: eligibility.dedupeKey,
        reason: "delivery_error_claim_not_open",
      };
    }
    return {
      status: "ambiguous",
      dedupeKey: eligibility.dedupeKey,
      reason: error instanceof Error ? error.message : "delivery_error",
    };
  }
}
