import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { runReliabilityAfterMarketingPublish } from "../reliability/post-publish-reliability";
import type { ReliabilitySweepResult } from "../reliability/sweep";
import {
  createMemoryCredentialHealthHeartbeatStore,
  createUnsafeRaceCredentialHealthHeartbeatStore,
  runCredentialMonitoringDailyIfEnabled,
  setCredentialMonitoringEnabledAtForTests,
  resetCredentialMonitoringEnabledAtForTests,
  setCredentialFingerprintKeyForTests,
  resetCredentialFingerprintKeyForTests,
} from "./index";
import { credentialHealthHeartbeatSource } from "./observation-persistence";
import {
  defaultStoredCredentialHealthState,
  type StoredCredentialHealthState,
} from "./heartbeat-store";
import {
  resetCredentialHealthHeartbeatStoreForTests,
  setCredentialHealthHeartbeatStoreForTests,
} from "./heartbeat-store-runtime";
import type { MetaCredentialPlatform } from "./types";

const ENABLED = "2026-10-01T00:00:00.000Z";
const NOW = "2026-10-08T12:00:00.000Z";

const sweepOk = (): ReliabilitySweepResult => ({
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

const TEST_ENV: Record<string, string> = {
  META_FACEBOOK_PAGE_ID: "page",
  META_FACEBOOK_PAGE_ACCESS_TOKEN: "fb-page-token",
  META_INSTAGRAM_USER_ID: "ig-user",
  META_INSTAGRAM_ACCESS_TOKEN: "ig-token",
  META_APP_ID: "app-id",
  META_APP_SECRET: "app-secret-value-32chars-minimum!!",
};

function unavailableMerge(
  previous: StoredCredentialHealthState | null,
  platform: MetaCredentialPlatform,
  attemptedAt: string,
): StoredCredentialHealthState {
  const base = previous ?? defaultStoredCredentialHealthState(platform);
  return {
    ...base,
    platform,
    last_validation_attempt_at: attemptedAt,
    consecutive_validation_failures: (base.consecutive_validation_failures ?? 0) + 1,
    health_state: "validation_unavailable",
  };
}

describe("Phase III-B3-B reliability verification", () => {
  beforeEach(() => {
    setCredentialFingerprintKeyForTests("b3b-reliability-fingerprint-key-32b!");
    setCredentialMonitoringEnabledAtForTests(ENABLED);
  });

  afterEach(() => {
    resetCredentialFingerprintKeyForTests();
    resetCredentialMonitoringEnabledAtForTests();
    resetCredentialHealthHeartbeatStoreForTests();
  });

  it("concurrent saveMerged on locked memory store preserves failure-counter increments", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    const t1 = "2026-10-08T12:00:01.000Z";
    const t2 = "2026-10-08T12:00:02.000Z";
    await Promise.all([
      store.saveMerged(
        "facebook",
        (prev) => unavailableMerge(prev, "facebook", t1),
        { attemptedAtIso: t1 },
      ),
      store.saveMerged(
        "facebook",
        (prev) => unavailableMerge(prev, "facebook", t2),
        { attemptedAtIso: t2 },
      ),
    ]);
    const stored = await store.load("facebook");
    assert.equal(stored?.consecutive_validation_failures, 2);
  });

  it("unsafe race store loses increments when writers share a stale read", async () => {
    const store = createUnsafeRaceCredentialHealthHeartbeatStore();
    const t1 = "2026-10-08T12:00:01.000Z";
    const t2 = "2026-10-08T12:00:02.000Z";
    const stale = await store.load("facebook");
    const first = unavailableMerge(stale, "facebook", t1);
    const second = unavailableMerge(stale, "facebook", t2);
    await store.saveMerged("facebook", () => first, { attemptedAtIso: t1 });
    await store.saveMerged("facebook", () => second, { attemptedAtIso: t2 });
    const stored = await store.load("facebook");
    assert.equal(stored?.consecutive_validation_failures, 1);
  });

  it("stale attemptedAt does not overwrite newer observation", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    const newer = "2026-10-08T13:00:00.000Z";
    const older = "2026-10-08T12:00:00.000Z";
    await store.saveMerged(
      "facebook",
      (prev) => unavailableMerge(prev, "facebook", newer),
      { attemptedAtIso: newer },
    );
    const result = await store.saveMerged(
      "facebook",
      () => unavailableMerge(null, "facebook", older),
      { attemptedAtIso: older },
    );
    assert.equal(result.last_validation_attempt_at, newer);
  });

  it("claimProactiveDailyProbe dedupes overlapping cron invocations", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    const repo = createMemoryIncidentRepository();
    const fetch = async () => ({
      status: 200,
      json: async () => ({
        data: {
          is_valid: true,
          expires_at: Math.floor(Date.parse("2026-11-07T12:00:00.000Z") / 1000),
          scopes: ["pages_manage_posts", "pages_show_list"],
        },
      }),
    });
    const notifyDeps = {
      claimDedupe: async () => true,
      notify: async () => ({ notificationId: "n1" }),
      attachDedupe: async () => {},
      releaseDedupe: async () => {},
    };
    const [a, b] = await Promise.all([
      runCredentialMonitoringDailyIfEnabled({
        nowIso: NOW,
        env: TEST_ENV,
        fetch,
        heartbeatStore: store,
        incidentRepository: repo,
        notifyDeps,
      }),
      runCredentialMonitoringDailyIfEnabled({
        nowIso: NOW,
        env: TEST_ENV,
        fetch,
        heartbeatStore: store,
        incidentRepository: repo,
        notifyDeps,
      }),
    ]);
    const totalRuns = a.platforms.length + b.platforms.length;
    assert.equal(totalRuns, 2, "only one platform probe per overlapping invocation");
    const fb = await store.load("facebook");
    const ig = await store.load("instagram");
    assert.equal(fb?.last_proactive_daily_probe_day, "2026-10-08");
    assert.equal(ig?.last_proactive_daily_probe_day, "2026-10-08");
  });

  it("credential daily monitoring runs when reliability sweep throws", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    const result = await runReliabilityAfterMarketingPublish(
      {
        authOk: true,
        authReason: "cron_secret",
        publishCyclePublications: [],
      },
      {
        runSweep: async () => {
          throw new Error("sweep_failed");
        },
        runCredentialDaily: () =>
          runCredentialMonitoringDailyIfEnabled({
            nowIso: NOW,
            env: { ...TEST_ENV, MARKETING_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED },
            heartbeatStore: store,
            incidentRepository: createMemoryIncidentRepository(),
            fetch: async () => ({
              status: 200,
              json: async () => ({
                data: {
                  is_valid: true,
                  expires_at: 0,
                  scopes: ["pages_manage_posts"],
                },
              }),
            }),
          }),
      },
    );
    assert.equal(result, null);
    const fb = await store.load("facebook");
    const ig = await store.load("instagram");
    assert.equal(fb?.last_proactive_daily_probe_day, "2026-10-08");
    assert.equal(ig?.last_proactive_daily_probe_day, "2026-10-08");
  });

  it("post-publish reliability invokes daily monitoring after successful sweep", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    let sweepCalls = 0;
    const result = await runReliabilityAfterMarketingPublish(
      { authOk: true, authReason: "cron_secret", publishCyclePublications: [] },
      {
        runSweep: async () => {
          sweepCalls += 1;
          return sweepOk();
        },
        runCredentialDaily: () =>
          runCredentialMonitoringDailyIfEnabled({
            nowIso: NOW,
            env: { ...TEST_ENV, MARKETING_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED },
            heartbeatStore: store,
            incidentRepository: createMemoryIncidentRepository(),
            fetch: async () => ({
              status: 200,
              json: async () => ({ user_id: "1" }),
            }),
          }),
      },
    );
    assert.ok(result);
    assert.equal(sweepCalls, 1);
    const ig = await store.load("instagram");
    assert.equal(ig?.last_proactive_daily_probe_day, "2026-10-08");
  });

  it("facebook and instagram heartbeat rows use distinct sources", () => {
    assert.notEqual(
      credentialHealthHeartbeatSource("facebook"),
      credentialHealthHeartbeatSource("instagram"),
    );
  });
});
