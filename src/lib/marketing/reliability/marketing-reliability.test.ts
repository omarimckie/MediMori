import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MemoryMarketingStore } from "../memory-store";
import type { MarketingPublication } from "../types";
import {
  PUBLICATION_OVERDUE_THRESHOLD_MS,
  PUBLICATION_STALE_PROCESSING_RECLAIM_MS,
  PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS,
} from "./constants";
import {
  filterOverduePublications,
  filterStuckProcessingPublications,
  isPublicationOverdue,
  isPublicationStuckProcessing,
} from "./detect";
import { resolveMarketingDispatcherSource } from "./dispatcher-source";
import {
  publicationAmbiguousProcessingDedupeKey,
  publicationOverdueDedupeKey,
} from "./dedupe-keys";
import { runReliabilityAlertPipeline } from "./sweep";

function samplePublication(
  patch: Partial<MarketingPublication> & { id: string },
): MarketingPublication {
  const now = new Date().toISOString();
  return {
    contentId: "content-1",
    campaignId: null,
    platform: "instagram",
    provider: "instagram",
    status: "scheduled",
    idempotencyKey: `pub:${patch.id}:instagram`,
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: now,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

test("overdue boundary: before 20 minutes no alert, at/after 20 minutes alerts", () => {
  const scheduledFor = new Date("2026-10-05T23:00:00.000Z");
  const pub = samplePublication({
    id: "pub-1",
    scheduledFor: scheduledFor.toISOString(),
    status: "scheduled",
  });

  const at19m = new Date(scheduledFor.getTime() + 19 * 60_000);
  assert.equal(isPublicationOverdue(pub, at19m), false);

  const at20m = new Date(scheduledFor.getTime() + 20 * 60_000);
  assert.equal(isPublicationOverdue(pub, at20m), true);

  const at25m = new Date(scheduledFor.getTime() + 25 * 60_000);
  assert.equal(isPublicationOverdue(pub, at25m), true);
});

test("stuck processing boundary: before 25 minutes no alert, at/after 25 minutes alerts", () => {
  const updatedAt = new Date("2026-10-05T23:00:00.000Z");
  const pub = samplePublication({
    id: "pub-2",
    status: "processing",
    updatedAt: updatedAt.toISOString(),
  });

  const at24m = new Date(updatedAt.getTime() + 24 * 60_000);
  assert.equal(isPublicationStuckProcessing(pub, at24m), false);

  const at25m = new Date(updatedAt.getTime() + 25 * 60_000);
  assert.equal(isPublicationStuckProcessing(pub, at25m), true);
});

test("different publications can each alert once", async () => {
  const claimed = new Set<string>();
  const notified: string[] = [];
  const now = new Date("2026-10-06T01:00:00.000Z");
  const overdue = filterOverduePublications(
    [
      samplePublication({
        id: "a",
        scheduledFor: new Date(now.getTime() - PUBLICATION_OVERDUE_THRESHOLD_MS).toISOString(),
      }),
      samplePublication({
        id: "b",
        scheduledFor: new Date(now.getTime() - PUBLICATION_OVERDUE_THRESHOLD_MS).toISOString(),
      }),
    ],
    now,
  );

  const result = await runReliabilityAlertPipeline(
    { overdue, stuck: [] },
    {
      claimDedupe: async ({ dedupeKey }) => {
        if (claimed.has(dedupeKey)) return false;
        claimed.add(dedupeKey);
        return true;
      },
      notify: async (payload) => {
        notified.push(payload.type);
        return { notificationId: crypto.randomUUID() };
      },
      attachDedupe: async () => {},
      releaseDedupe: async () => {},
    },
  );

  assert.equal(result.notificationsCreated, 2);
  assert.equal(notified.length, 2);
});

test("repeated overdue sweep does not duplicate notifications", async () => {
  const claimed = new Set<string>();
  let notifyCount = 0;
  const pub = samplePublication({
    id: "pub-dup",
    scheduledFor: new Date(Date.now() - PUBLICATION_OVERDUE_THRESHOLD_MS).toISOString(),
  });
  const deps = {
    claimDedupe: async ({ dedupeKey }: { dedupeKey: string }) => {
      if (claimed.has(dedupeKey)) return false;
      claimed.add(dedupeKey);
      return true;
    },
    notify: async () => {
      notifyCount += 1;
      return { notificationId: crypto.randomUUID() };
    },
    attachDedupe: async () => {},
    releaseDedupe: async () => {},
  };

  const first = await runReliabilityAlertPipeline({ overdue: [pub], stuck: [] }, deps);
  const second = await runReliabilityAlertPipeline({ overdue: [pub], stuck: [] }, deps);

  assert.equal(first.notificationsCreated, 1);
  assert.equal(second.notificationsSkippedDuplicate, 1);
  assert.equal(notifyCount, 1);
});

test("repeated stuck processing sweep does not duplicate ambiguous notifications", async () => {
  const claimed = new Set<string>();
  let notifyCount = 0;
  const pub = samplePublication({
    id: "pub-stuck",
    status: "processing",
    updatedAt: new Date(Date.now() - PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS).toISOString(),
  });
  const deps = {
    claimDedupe: async ({ dedupeKey }: { dedupeKey: string }) => {
      if (claimed.has(dedupeKey)) return false;
      claimed.add(dedupeKey);
      return true;
    },
    notify: async () => {
      notifyCount += 1;
      return { notificationId: crypto.randomUUID() };
    },
    attachDedupe: async () => {},
    releaseDedupe: async () => {},
  };

  await runReliabilityAlertPipeline({ overdue: [], stuck: [pub] }, deps);
  await runReliabilityAlertPipeline({ overdue: [], stuck: [pub] }, deps);
  assert.equal(notifyCount, 1);
});

test("reliability alert pipeline does not mutate publication store state", async () => {
  const store = new MemoryMarketingStore();
  const publication = await store.createPublication({
    id: "pub-store",
    contentId: "missing",
    campaignId: null,
    platform: "facebook",
    provider: "facebook_page",
    status: "scheduled",
    idempotencyKey: "k",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: new Date(Date.now() - PUBLICATION_OVERDUE_THRESHOLD_MS).toISOString(),
    publishedAt: null,
  });

  const before = JSON.stringify(await store.listPublications());
  await runReliabilityAlertPipeline(
    { overdue: [publication], stuck: [] },
    {
      claimDedupe: async () => true,
      notify: async () => ({ notificationId: crypto.randomUUID() }),
      attachDedupe: async () => {},
      releaseDedupe: async () => {},
    },
  );
  const after = JSON.stringify(await store.listPublications());
  assert.equal(before, after);
});

test("stale processing reclaim (15m) can occur before stuck alert (25m)", () => {
  assert.ok(PUBLICATION_STALE_PROCESSING_RECLAIM_MS < PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS);
});

test("dispatcher source resolution is conservative", () => {
  const bearer = { ok: true, reason: "cron_secret" };
  assert.equal(
    resolveMarketingDispatcherSource(
      new Request("https://example.com", {
        headers: { authorization: "Bearer secret" },
      }),
      bearer,
    ),
    "authenticated_cron",
  );
  assert.equal(
    resolveMarketingDispatcherSource(
      new Request("https://example.com", {
        headers: {
          authorization: "Bearer secret",
          "x-vercel-cron": "1",
        },
      }),
      bearer,
    ),
    "authenticated_cron",
  );
  assert.equal(
    resolveMarketingDispatcherSource(
      new Request("https://example.com", {
        headers: {
          authorization: "Bearer secret",
          "upstash-signature": "sig",
        },
      }),
      bearer,
    ),
    "authenticated_cron",
  );
  assert.equal(
    resolveMarketingDispatcherSource(new Request("https://example.com"), {
      ok: true,
      reason: "admin_session",
    }),
    "admin",
  );
  assert.equal(
    resolveMarketingDispatcherSource(new Request("https://example.com"), {
      ok: false,
      reason: "unauthorized",
    }),
    "unknown",
  );
});

test("dedupe keys are stable per publication", () => {
  assert.equal(publicationOverdueDedupeKey("id-1"), "publication_overdue:v1:id-1");
  assert.equal(
    publicationAmbiguousProcessingDedupeKey("id-1"),
    "publication_ambiguous:processing:v1:id-1",
  );
});

test("reliability modules do not invoke publish or Meta publishers", () => {
  const files = [
    "src/lib/marketing/reliability/sweep.ts",
    "src/app/api/cron/marketing-reliability/route.ts",
    "src/lib/marketing/reliability/repository.ts",
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(/\bpublishDue\b/.test(text), false, file);
    assert.equal(/\bpublishPublication\b/.test(text), false, file);
    assert.equal(/\bFacebookPagePublisher\b/.test(text), false, file);
    assert.equal(/\bInstagramPublisher\b/.test(text), false, file);
  }
});

test("marketing publish cron records heartbeat helper skips unauthorized writes", async () => {
  const { recordMarketingPublishDispatcherHeartbeat } = await import("../marketing-cron");
  const source = await recordMarketingPublishDispatcherHeartbeat({
    request: new Request("https://example.com"),
    auth: { ok: false, reason: "unauthorized" },
    publishedCount: 0,
  });
  assert.equal(source, "unknown");
});

test("broadcast notification module fans out via all subscriptions helper", () => {
  const text = readFileSync("src/lib/marketing/notifications/broadcast.ts", "utf8");
  assert.match(text, /listAllEnabledPushSubscriptions/);
  assert.match(text, /sendWebPushToSubscription/);
});
