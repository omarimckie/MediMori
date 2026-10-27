import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MemoryMarketingStore } from "../memory-store";
import { runReliabilityAfterMarketingPublish } from "../reliability/post-publish-reliability";
import type { ReliabilitySweepResult } from "../reliability/sweep";
import {
  isMorningBriefDeliveryEligible,
  zonedLocalTime,
} from "./morning-brief-eligibility";
import {
  createMemoryMorningBriefDeliveryClaimRepository,
  resetMorningBriefDeliveryClaimsForTests,
} from "./morning-brief-delivery-claims";
import { runMorningBriefDeliveryIfDue } from "./morning-brief-delivery";
import { setMorningBriefPreferences } from "./preferences";
import {
  setSendMarketingAdminBroadcastForTests,
} from "./broadcast";
import { setListAllEnabledPushSubscriptionsForTests } from "./notifications-repository";
import { DEFAULT_MORNING_BRIEF_PREFERENCES } from "./types";

function prefs(overrides: Partial<typeof DEFAULT_MORNING_BRIEF_PREFERENCES> = {}) {
  return { ...DEFAULT_MORNING_BRIEF_PREFERENCES, morningBriefEnabled: true, ...overrides };
}

const emptySweepResult = (): ReliabilitySweepResult => ({
  overdueDetected: 0,
  stuckProcessingDetected: 0,
  notificationsCreated: 0,
  notificationsSkippedDuplicate: 0,
  dedupesCleaned: 0,
  reconcile: {
    examined: 0,
    autoResolved: 0,
    overdueAutoResolved: 0,
    stuckAutoResolved: 0,
    skippedUnsafe: 0,
    skippedMissingPublication: 0,
    skippedConflict: 0,
    skippedPolicy: 0,
    failed: 0,
  },
  partialPublicationFailureObserved: 0,
});

const fakePushSubscription = {
  id: "00000000-0000-4000-8000-000000000001",
  adminUsername: "owner",
  endpoint: "https://push.example/sub",
  p256dh: "key",
  auth: "auth",
  userAgent: null,
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastSuccessAt: null,
  lastFailureAt: null,
  failureCount: 0,
};

function enablePushTestHarness(): void {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "test-public";
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "test-private";
  setListAllEnabledPushSubscriptionsForTests(async () => [fakePushSubscription]);
}

function disablePushTestHarness(): void {
  setSendMarketingAdminBroadcastForTests(null);
  setListAllEnabledPushSubscriptionsForTests(null);
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
}

test("morning brief disabled skips delivery", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs({ morningBriefEnabled: false }));
  const outcome = await runMorningBriefDeliveryIfDue({
    store,
    now: new Date("2026-01-15T13:05:00.000Z"),
    claims: createMemoryMorningBriefDeliveryClaimRepository(),
  });
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "morning_brief_disabled");
});

test("morning brief enabled and 08:00 Eastern eligibility in winter (EST)", () => {
  const eligibility = isMorningBriefDeliveryEligible(
    new Date("2026-01-15T13:00:00.000Z"),
    prefs(),
  );
  assert.equal(eligibility.eligible, true);
  if (eligibility.eligible) {
    assert.equal(eligibility.localDate, "2026-01-15");
  }
  const before = isMorningBriefDeliveryEligible(new Date("2026-01-15T12:59:00.000Z"), prefs());
  assert.equal(before.eligible, false);
});

test("morning brief enabled and 08:00 Eastern eligibility in summer (EDT)", () => {
  const atEight = isMorningBriefDeliveryEligible(new Date("2026-07-15T12:00:00.000Z"), prefs());
  assert.equal(atEight.eligible, true);
  if (atEight.eligible) {
    assert.equal(atEight.localDate, "2026-07-15");
  }
});

test("spring DST transition uses America/New_York local calendar date", () => {
  const local = zonedLocalTime(new Date("2026-03-09T13:05:00.000Z"), "America/New_York");
  assert.equal(local.calendarDate, "2026-03-09");
  assert.ok(local.minutesSinceMidnight >= 8 * 60);
});

test("fall DST transition uses America/New_York local calendar date", () => {
  const local = zonedLocalTime(new Date("2026-11-02T13:05:00.000Z"), "America/New_York");
  assert.equal(local.calendarDate, "2026-11-02");
  assert.ok(local.minutesSinceMidnight >= 8 * 60);
});

test("duplicate invocation on same local day is idempotent", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const claims = createMemoryMorningBriefDeliveryClaimRepository();
  const now = new Date("2026-01-15T13:05:00.000Z");

  setSendMarketingAdminBroadcastForTests(async () => ({
    notification: {
      id: "n-1",
      type: "morning_brief",
      severity: "info",
      title: "t",
      body: "b",
      destination: "/admin/marketing",
      relatedContentId: null,
      relatedPublicationId: null,
      relatedIncidentId: null,
      deliveryStatus: "delivered",
      deliveryAttemptedAt: now.toISOString(),
      createdAt: now.toISOString(),
      readAt: null,
    },
    pushAttempted: 1,
    pushDelivered: 1,
  }));

  enablePushTestHarness();

  const first = await runMorningBriefDeliveryIfDue({ store, now, claims });
  const second = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(first.status, "delivered");
  assert.equal(second.status, "duplicate");

  disablePushTestHarness();
});

test("concurrent invocation attempts only claim once", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const claims = createMemoryMorningBriefDeliveryClaimRepository();
  const now = new Date("2026-02-10T13:10:00.000Z");

  setSendMarketingAdminBroadcastForTests(async () => ({
    notification: {
      id: "n-concurrent",
      type: "morning_brief",
      severity: "info",
      title: "t",
      body: "b",
      destination: "/admin/marketing",
      relatedContentId: null,
      relatedPublicationId: null,
      relatedIncidentId: null,
      deliveryStatus: "delivered",
      deliveryAttemptedAt: now.toISOString(),
      createdAt: now.toISOString(),
      readAt: null,
    },
    pushAttempted: 1,
    pushDelivered: 1,
  }));
  enablePushTestHarness();

  const outcomes = await Promise.all([
    runMorningBriefDeliveryIfDue({ store, now, claims }),
    runMorningBriefDeliveryIfDue({ store, now, claims }),
  ]);
  const delivered = outcomes.filter((row) => row.status === "delivered").length;
  const duplicate = outcomes.filter((row) => row.status === "duplicate").length;
  assert.equal(delivered, 1);
  assert.equal(duplicate, 1);

  disablePushTestHarness();
});

test("provider failure marks ambiguous and does not deliver twice same day", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const claims = createMemoryMorningBriefDeliveryClaimRepository();
  const now = new Date("2026-03-20T12:05:00.000Z");

  setSendMarketingAdminBroadcastForTests(async () => {
    throw new Error("push_provider_down");
  });
  enablePushTestHarness();

  const first = await runMorningBriefDeliveryIfDue({ store, now, claims });
  const retry = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(first.status, "ambiguous");
  assert.equal(retry.status, "duplicate");
  assert.equal(retry.claimStatus, "ambiguous");

  disablePushTestHarness();
});

test("next local calendar day is eligible again", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const claims = createMemoryMorningBriefDeliveryClaimRepository();

  setSendMarketingAdminBroadcastForTests(async () => ({
    notification: {
      id: "n-day2",
      type: "morning_brief",
      severity: "info",
      title: "t",
      body: "b",
      destination: "/admin/marketing",
      relatedContentId: null,
      relatedPublicationId: null,
      relatedIncidentId: null,
      deliveryStatus: "delivered",
      deliveryAttemptedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      readAt: null,
    },
    pushAttempted: 1,
    pushDelivered: 1,
  }));
  enablePushTestHarness();

  await runMorningBriefDeliveryIfDue({
    store,
    now: new Date("2026-04-01T12:05:00.000Z"),
    claims,
  });
  const nextDay = await runMorningBriefDeliveryIfDue({
    store,
    now: new Date("2026-04-02T12:05:00.000Z"),
    claims,
  });
  assert.equal(nextDay.status, "delivered");

  disablePushTestHarness();
});

test("missing push subscription fails then retries after definitive zero acceptance", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const claims = createMemoryMorningBriefDeliveryClaimRepository();
  const now = new Date("2026-05-01T12:05:00.000Z");
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "test-public";
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "test-private";
  setListAllEnabledPushSubscriptionsForTests(async () => []);

  const first = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(first.status, "failed");
  assert.equal(first.reason, "no_enabled_push_subscriptions");

  enablePushTestHarness();
  setSendMarketingAdminBroadcastForTests(async () => ({
    notification: {
      id: "n-retry",
      type: "morning_brief",
      severity: "info",
      title: "t",
      body: "b",
      destination: "/admin/marketing",
      relatedContentId: null,
      relatedPublicationId: null,
      relatedIncidentId: null,
      deliveryStatus: "delivered",
      deliveryAttemptedAt: now.toISOString(),
      createdAt: now.toISOString(),
      readAt: null,
    },
    pushAttempted: 1,
    pushDelivered: 1,
  }));
  const second = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(second.status, "delivered");

  disablePushTestHarness();
});

test("ambiguous claim blocks same-day retry", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const claims = createMemoryMorningBriefDeliveryClaimRepository();
  const now = new Date("2026-05-02T12:05:00.000Z");
  enablePushTestHarness();
  setSendMarketingAdminBroadcastForTests(async () => {
    throw new Error("push_provider_down");
  });
  const first = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(first.status, "ambiguous");
  const second = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(second.status, "duplicate");
  assert.equal(second.claimStatus, "ambiguous");
  disablePushTestHarness();
});

test("brief generation failure is failed and retryable same day", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const claims = createMemoryMorningBriefDeliveryClaimRepository();
  const now = new Date("2026-05-03T12:05:00.000Z");
  enablePushTestHarness();
  const first = await runMorningBriefDeliveryIfDue({
    store,
    now,
    claims,
    buildBrief: async () => {
      throw new Error("brief_down");
    },
  });
  assert.equal(first.status, "failed");
  assert.equal(first.reason, "brief_generation_failed");
  setSendMarketingAdminBroadcastForTests(async () => ({
    notification: {
      id: "n-brief-retry",
      type: "morning_brief",
      severity: "info",
      title: "t",
      body: "b",
      destination: "/admin/marketing",
      relatedContentId: null,
      relatedPublicationId: null,
      relatedIncidentId: null,
      deliveryStatus: "delivered",
      deliveryAttemptedAt: now.toISOString(),
      createdAt: now.toISOString(),
      readAt: null,
    },
    pushAttempted: 1,
    pushDelivered: 1,
  }));
  const second = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(second.status, "delivered");
  disablePushTestHarness();
});

test("delivery claims schema missing skips without throwing", async () => {
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const outcome = await runMorningBriefDeliveryIfDue({
    store,
    now: new Date("2026-05-04T12:05:00.000Z"),
    claims: {
      tryClaim: async () => {
        throw Object.assign(new Error('relation "marketing_morning_brief_delivery_claims" does not exist'), {
          code: "42P01",
        });
      },
      reclaimFailedClaim: async () => false,
      completeClaim: async () => false,
      getClaim: async () => null,
    },
  });
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "delivery_claims_schema_unavailable");
});

test("stuck claimed row blocks resend same local day after process failure", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const claims = createMemoryMorningBriefDeliveryClaimRepository();
  const now = new Date("2026-06-10T12:05:00.000Z");
  const eligibility = isMorningBriefDeliveryEligible(now, prefs());
  assert.equal(eligibility.eligible, true);
  if (!eligibility.eligible) return;
  await claims.tryClaim({
    dedupeKey: eligibility.dedupeKey,
    timezone: prefs().timezone,
    localDate: eligibility.localDate,
  });
  enablePushTestHarness();
  setSendMarketingAdminBroadcastForTests(async () => ({
    notification: {
      id: "should-not-run",
      type: "morning_brief",
      severity: "info",
      title: "t",
      body: "b",
      destination: "/admin/marketing",
      relatedContentId: null,
      relatedPublicationId: null,
      relatedIncidentId: null,
      deliveryStatus: "delivered",
      deliveryAttemptedAt: now.toISOString(),
      createdAt: now.toISOString(),
      readAt: null,
    },
    pushAttempted: 1,
    pushDelivered: 1,
  }));
  const outcome = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(outcome.status, "duplicate");
  assert.equal(outcome.claimStatus, "claimed");
  disablePushTestHarness();
});

test("provider accepts zero deliveries marks failed then allows same-day retry", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const claims = createMemoryMorningBriefDeliveryClaimRepository();
  const now = new Date("2026-08-10T12:05:00.000Z");
  enablePushTestHarness();
  setSendMarketingAdminBroadcastForTests(async () => ({
    notification: {
      id: "n-zero",
      type: "morning_brief",
      severity: "info",
      title: "t",
      body: "b",
      destination: "/admin/marketing",
      relatedContentId: null,
      relatedPublicationId: null,
      relatedIncidentId: null,
      deliveryStatus: "failed",
      deliveryAttemptedAt: now.toISOString(),
      createdAt: now.toISOString(),
      readAt: null,
    },
    pushAttempted: 1,
    pushDelivered: 0,
  }));
  const first = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(first.status, "failed");
  assert.equal(first.reason, "push_not_delivered");
  setSendMarketingAdminBroadcastForTests(async () => ({
    notification: {
      id: "n-zero-retry",
      type: "morning_brief",
      severity: "info",
      title: "t",
      body: "b",
      destination: "/admin/marketing",
      relatedContentId: null,
      relatedPublicationId: null,
      relatedIncidentId: null,
      deliveryStatus: "delivered",
      deliveryAttemptedAt: now.toISOString(),
      createdAt: now.toISOString(),
      readAt: null,
    },
    pushAttempted: 1,
    pushDelivered: 1,
  }));
  const second = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(second.status, "delivered");
  disablePushTestHarness();
});

test("morning brief enabled delivers with operational disclaimer in body", async () => {
  resetMorningBriefDeliveryClaimsForTests();
  const store = new MemoryMarketingStore();
  await setMorningBriefPreferences(store, prefs());
  const claims = createMemoryMorningBriefDeliveryClaimRepository();
  const now = new Date("2026-09-10T12:05:00.000Z");
  enablePushTestHarness();
  let capturedBody = "";
  setSendMarketingAdminBroadcastForTests(async (input) => {
    capturedBody = input.body;
    return {
      notification: {
        id: "n-body",
        type: "morning_brief",
        severity: "info",
        title: input.title,
        body: input.body,
        destination: "/admin/marketing",
        relatedContentId: null,
        relatedPublicationId: null,
        relatedIncidentId: null,
        deliveryStatus: "delivered",
        deliveryAttemptedAt: now.toISOString(),
        createdAt: now.toISOString(),
        readAt: null,
      },
      pushAttempted: 1,
      pushDelivered: 1,
    };
  });
  const outcome = await runMorningBriefDeliveryIfDue({ store, now, claims });
  assert.equal(outcome.status, "delivered");
  assert.match(capturedBody, /Social engagement analytics/);
  disablePushTestHarness();
});

test("cron unauthorized does not invoke morning brief hook", async () => {
  let morningCalls = 0;
  await runReliabilityAfterMarketingPublish(
    { authOk: false, authReason: "unauthorized", publishCyclePublications: [] },
    {
      runMorningBrief: async () => {
        morningCalls += 1;
        return { status: "skipped", reason: "test" };
      },
    },
  );
  assert.equal(morningCalls, 0);
});

test("morning brief delivery runs only on cron_secret publish tail", async () => {
  let morningCalls = 0;
  await runReliabilityAfterMarketingPublish(
    { authOk: true, authReason: "admin_session", publishCyclePublications: [] },
    {
      runSweep: async () => emptySweepResult(),
      runCredentialDaily: async () => ({ ran: false, platforms: [] }),
      runMorningBrief: async () => {
        morningCalls += 1;
        return { status: "skipped", reason: "test" };
      },
    },
  );
  assert.equal(morningCalls, 0);

  await runReliabilityAfterMarketingPublish(
    { authOk: true, authReason: "cron_secret", publishCyclePublications: [] },
    {
      runSweep: async () => emptySweepResult(),
      runCredentialDaily: async () => ({ ran: false, platforms: [] }),
      runMorningBrief: async () => {
        morningCalls += 1;
        return { status: "skipped", reason: "test" };
      },
    },
  );
  assert.equal(morningCalls, 1);
});

test("preferences save path unchanged", async () => {
  const store = new MemoryMarketingStore();
  const saved = await setMorningBriefPreferences(store, {
    morningBriefEnabled: true,
    morningBriefTime: "08:30",
    timezone: "America/New_York",
  });
  assert.equal(saved.morningBriefTime, "08:30");
  const loaded = await store.getSetting("marketing_morning_brief_preferences", null);
  assert.ok(loaded);
});

test("morning brief dedupe key is one global broadcast per timezone calendar day", () => {
  const eligibility = isMorningBriefDeliveryEligible(
    new Date("2026-01-15T13:05:00.000Z"),
    prefs(),
  );
  assert.equal(eligibility.eligible, true);
  if (eligibility.eligible) {
    assert.equal(eligibility.dedupeKey, "morning_brief:v1:America/New_York:2026-01-15");
  }
});

test("publishing pipeline frozen files were not modified for morning brief scheduler", () => {
  const frozen = [
    "src/lib/marketing/approval.ts",
    "src/app/api/cron/marketing-publish/route.ts",
    ".github/workflows/marketing-publish-dispatch.yml",
    "vercel.json",
  ];
  for (const file of frozen) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes("morning-brief-delivery"), false, file);
  }
});
