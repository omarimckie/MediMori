import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { runReliabilityAfterMarketingPublish } from "../reliability/post-publish-reliability";
import type { ReliabilitySweepResult } from "../reliability/sweep";
import {
  classifyCredentialHealth,
  createMemoryCredentialHealthHeartbeatStore,
  resetCredentialFingerprintKeyForTests,
  resetCredentialMonitoringEnabledAtForTests,
  runCredentialHealthMonitor,
  runCredentialMonitoringDailyIfEnabled,
  runCredentialProbe,
  runtimeCredentialProbeFetch,
  setCredentialFingerprintKeyForTests,
} from "./index";
import type { CredentialProbeFetch } from "./probes";

const NOW = "2026-10-08T12:00:00.000Z";
const ENABLED = "2026-10-01T00:00:00.000Z";

const TEST_ENV: Record<string, string> = {
  MARKETING_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED,
  META_FACEBOOK_PAGE_ID: "page",
  META_FACEBOOK_PAGE_ACCESS_TOKEN: "fb-page-token",
  META_INSTAGRAM_USER_ID: "ig-user",
  META_INSTAGRAM_ACCESS_TOKEN: "ig-token",
  META_APP_ID: "app-id",
  META_APP_SECRET: "app-secret-value-32chars-minimum!!",
};

function fbDebugBody() {
  return {
    data: {
      is_valid: true,
      expires_at: 0,
      scopes: ["pages_manage_posts", "pages_show_list"],
    },
  };
}

function mockFetch(handler: (url: string) => { status: number; body: unknown }): CredentialProbeFetch {
  return async (url) => ({
    status: handler(url).status,
    json: async () => handler(url).body,
  });
}

const sweepResult = (): ReliabilitySweepResult => ({
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

describe("Phase III-B3 HTTP probe wiring", () => {
  let repo: ReturnType<typeof createMemoryIncidentRepository>;
  let store: ReturnType<typeof createMemoryCredentialHealthHeartbeatStore>;

  beforeEach(() => {
    repo = createMemoryIncidentRepository();
    store = createMemoryCredentialHealthHeartbeatStore();
    setCredentialFingerprintKeyForTests("b3-http-probe-fingerprint-key-32b!");
  });

  afterEach(() => {
    resetCredentialFingerprintKeyForTests();
    resetCredentialMonitoringEnabledAtForTests();
  });

  it("monitoring disabled does not invoke HTTP fetch", async () => {
    let calls = 0;
    await runCredentialMonitoringDailyIfEnabled({
      nowIso: NOW,
      env: {},
      fetch: async () => {
        calls += 1;
        throw new Error("fetch should not run when monitoring is disabled");
      },
      heartbeatStore: store,
      incidentRepository: repo,
    });
    assert.equal(calls, 0);
    assert.equal((await store.load("facebook"))?.last_proactive_daily_probe_day ?? null, null);
  });

  it("post-publish reliability passes runtime fetch into credential daily", async () => {
    let receivedFetch: CredentialProbeFetch | undefined;
    await runReliabilityAfterMarketingPublish(
      { authOk: true, authReason: "cron_secret", publishCyclePublications: [] },
      {
        runSweep: async () => sweepResult(),
        runCredentialDaily: async (input = {}) => {
          receivedFetch = input.fetch;
          return { ran: false, platforms: [] };
        },
      },
    );
    assert.equal(receivedFetch, runtimeCredentialProbeFetch);
  });

  it("enabled daily path reaches Facebook debug_token and Instagram /me probes", async () => {
    const urls: string[] = [];
    const fetch = mockFetch((url) => {
      urls.push(url);
      if (url.includes("debug_token")) {
        return { status: 200, body: fbDebugBody() };
      }
      return { status: 200, body: { user_id: "ig-user" } };
    });

    const result = await runCredentialMonitoringDailyIfEnabled({
      nowIso: NOW,
      env: TEST_ENV,
      fetch,
      heartbeatStore: store,
      incidentRepository: repo,
    });

    assert.deepEqual(result.platforms.sort(), ["facebook", "instagram"]);
    assert.ok(urls.some((u) => u.includes("graph.facebook.com") && u.includes("debug_token")));
    assert.ok(urls.some((u) => u.includes("graph.instagram.com/me")));
    assert.equal(repo.listIncidents().length, 0);
  });

  it("missing fetch does not classify configured credentials as missing", async () => {
    const attempt = await runCredentialProbe({
      platform: "facebook",
      attemptedAt: NOW,
      env: TEST_ENV,
    });
    assert.equal(attempt.credentialsConfigured, true);
    assert.equal(attempt.errorClass, "meta_probe_fetch_not_configured");
    const classification = classifyCredentialHealth(attempt);
    assert.equal(classification.healthState, "validation_unavailable");
    assert.notEqual(classification.errorClass, "meta_credentials_missing");

    await runCredentialHealthMonitor({
      platform: "facebook",
      attemptedAt: NOW,
      probeKind: "proactive_daily",
      env: TEST_ENV,
      heartbeatStore: store,
      incidentRepository: repo,
      sourceOperation: "test_missing_fetch",
      runProbe: runCredentialProbe,
    });
    assert.equal(repo.listIncidents().length, 0);
  });
});
