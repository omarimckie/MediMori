import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { observePublicationFailureOutcomes } from "../publication-incidents/observe-failure-outcomes";
import { evaluatePublicationFailedCapture } from "../publication-incidents/publication-failed-eligibility";
import {
  createMemoryCredentialHealthHeartbeatStore,
  resetCredentialMonitoringEnabledAtForTests,
  resetCredentialFingerprintKeyForTests,
  runCredentialHealthMonitor,
  runCredentialMonitoringDailyIfEnabled,
  runCredentialProbe,
  setCredentialFingerprintKeyForTests,
  setCredentialMonitoringEnabledAtForTests,
  storedToClientSafeMetadata,
  credentialAttemptFromReactivePublishFailure,
  credentialAttemptFromMetaDebugToken,
  classifyCredentialHealth,
} from "./index";
import type { CredentialProbeFetch } from "./probes";
import type { MarketingPublication } from "../types";

const NOW = "2026-10-08T12:00:00.000Z";
const ENABLED = "2026-10-01T00:00:00.000Z";
const IN_3_DAYS = "2026-10-11T12:00:00.000Z";
const IN_30_DAYS = "2026-11-07T12:00:00.000Z";
const PAST = "2026-10-01T12:00:00.000Z";

const TEST_ENV: Record<string, string> = {
  META_FACEBOOK_PAGE_ID: "page",
  META_FACEBOOK_PAGE_ACCESS_TOKEN: "fb-page-token",
  META_INSTAGRAM_USER_ID: "ig-user",
  META_INSTAGRAM_ACCESS_TOKEN: "ig-token",
  META_APP_ID: "app-id",
  META_APP_SECRET: "app-secret-value-32chars-minimum!!",
};

function mockFetch(handler: (url: string) => { status: number; body: unknown }): CredentialProbeFetch {
  return async (url) => ({
    status: handler(url).status,
    json: async () => handler(url).body,
  });
}

function basePublication(
  patch: Partial<MarketingPublication> & { id: string },
): MarketingPublication {
  const now = new Date().toISOString();
  return {
    contentId: "content-1",
    campaignId: null,
    platform: "instagram",
    provider: "instagram",
    status: "failed",
    idempotencyKey: `key:${patch.id}`,
    externalId: null,
    url: null,
    attemptCount: 1,
    lastError: "meta_http_error: permanent failure",
    scheduledFor: null,
    publishedAt: null,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function fbDebugBody(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      is_valid: true,
      expires_at: Math.floor(Date.parse(IN_30_DAYS) / 1000),
      scopes: ["pages_manage_posts", "pages_show_list"],
      ...overrides,
    },
  };
}

describe("Phase III-B3-B credential monitoring", () => {
  let repo: ReturnType<typeof createMemoryIncidentRepository>;
  let store: ReturnType<typeof createMemoryCredentialHealthHeartbeatStore>;
  const notifications: string[] = [];
  const notifyDeps = {
    claimDedupe: async () => true,
    notify: async (payload: { title: string }) => {
      notifications.push(payload.title);
      return { notificationId: "n1" };
    },
    attachDedupe: async () => {},
    releaseDedupe: async () => {},
  };

  beforeEach(() => {
    repo = createMemoryIncidentRepository();
    store = createMemoryCredentialHealthHeartbeatStore();
    notifications.length = 0;
    setCredentialFingerprintKeyForTests("b3b-test-fingerprint-key-32bytes!!");
    setCredentialMonitoringEnabledAtForTests(ENABLED);
  });

  afterEach(() => {
    resetCredentialFingerprintKeyForTests();
    resetCredentialMonitoringEnabledAtForTests();
  });

  async function runFb(
    fetch: CredentialProbeFetch,
    probeKind: "proactive_daily" | "reactive" = "proactive_daily",
    options: {
      repo?: ReturnType<typeof createMemoryIncidentRepository>;
      store?: ReturnType<typeof createMemoryCredentialHealthHeartbeatStore>;
      attemptedAt?: string;
    } = {},
  ) {
    return runCredentialHealthMonitor({
      platform: "facebook",
      attemptedAt: options.attemptedAt ?? NOW,
      probeKind,
      env: TEST_ENV,
      fetch,
      heartbeatStore: options.store ?? store,
      incidentRepository: options.repo ?? repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
  }

  it("disabled feature gate skips probes and incidents", async () => {
    setCredentialMonitoringEnabledAtForTests(null);
    const result = await runFb(mockFetch(() => ({ status: 200, body: fbDebugBody() })));
    assert.equal(result.skipped, true);
    assert.equal(repo.listIncidents().length, 0);
  });

  it("facebook valid token with verified expiration beyond 7 days", async () => {
    await runFb(mockFetch(() => ({ status: 200, body: fbDebugBody() })));
    const stored = await store.load("facebook");
    assert.equal(stored?.health_state, "healthy");
    assert.equal(repo.listIncidents().length, 0);
  });

  it("instagram valid token with unknown expiration", async () => {
    await runCredentialHealthMonitor({
      platform: "instagram",
      attemptedAt: NOW,
      probeKind: "proactive_daily",
      env: TEST_ENV,
      fetch: mockFetch(() => ({ status: 200, body: { user_id: "123" } })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    const stored = await store.load("instagram");
    assert.equal(stored?.health_state, "unknown_expiration");
    assert.equal(stored?.expiration_knowledge, "unknown");
  });

  it("verified expiry within seven days opens warning incident", async () => {
    await runFb(
      mockFetch(() => ({
        status: 200,
        body: fbDebugBody({
          expires_at: Math.floor(Date.parse(IN_3_DAYS) / 1000),
        }),
      })),
    );
    const incidents = repo.listIncidents();
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].incidentType, "credential_warning");
    assert.equal(incidents[0].severity, "warning");
    assert.ok(notifications.some((t) => t.includes("expiring")));
  });

  it("confirmed expired and revoked tokens", async () => {
    await runFb(
      mockFetch(() => ({
        status: 200,
        body: fbDebugBody({ is_valid: false, expires_at: Math.floor(Date.parse(PAST) / 1000) }),
      })),
    );
    assert.equal(repo.listIncidents()[0]?.errorClass, "meta_auth_expired");
    await runCredentialHealthMonitor({
      platform: "instagram",
      attemptedAt: NOW,
      probeKind: "proactive_daily",
      env: TEST_ENV,
      fetch: mockFetch(() => ({
        status: 400,
        body: { error: { code: 190 } },
      })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    const igIncident = repo.listIncidents().find((i) => i.platform === "instagram");
    assert.equal(igIncident?.errorClass, "meta_auth_expired");
  });

  it("missing credentials, insufficient permissions, and malformed response", async () => {
    const envMissing = { ...TEST_ENV, META_FACEBOOK_PAGE_ACCESS_TOKEN: "" };
    await runCredentialHealthMonitor({
      platform: "facebook",
      attemptedAt: NOW,
      probeKind: "proactive_daily",
      env: envMissing,
      fetch: mockFetch(() => ({ status: 200, body: fbDebugBody() })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    assert.equal(repo.listIncidents()[0]?.errorClass, "meta_credentials_missing");

    const permRepo = createMemoryIncidentRepository();
    const permStore = createMemoryCredentialHealthHeartbeatStore();
    await runFb(
      mockFetch(() => ({
        status: 200,
        body: fbDebugBody({ scopes: ["read_insights"] }),
      })),
      "proactive_daily",
      { repo: permRepo, store: permStore },
    );
    assert.ok(
      permRepo.listIncidents().some((i) => i.errorClass === "meta_permissions"),
    );

    const malformedStore = createMemoryCredentialHealthHeartbeatStore();
    await runFb(mockFetch(() => ({ status: 200, body: {} })), "proactive_daily", {
      store: malformedStore,
      repo: permRepo,
      attemptedAt: "2026-10-08T13:00:00.000Z",
    });
    const stored = await malformedStore.load("facebook");
    assert.equal(stored?.health_state, "validation_unavailable");
  });

  it("timeout rate limit and meta 5xx are unavailable without incident", async () => {
    await runFb(mockFetch(() => ({ status: 503, body: { error: { code: 2 } } })));
    let stored = await store.load("facebook");
    assert.equal(stored?.consecutive_validation_failures, 1);
    assert.equal(repo.listIncidents().length, 0);

    await runCredentialHealthMonitor({
      platform: "facebook",
      attemptedAt: "2026-10-09T12:00:00.000Z",
      probeKind: "proactive_daily",
      env: TEST_ENV,
      fetch: mockFetch(() => ({ status: 429, body: {} })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    stored = await store.load("facebook");
    assert.equal(stored?.consecutive_validation_failures, 2);
    assert.ok(notifications.some((t) => t.includes("Unable to verify")));

    await runCredentialHealthMonitor({
      platform: "facebook",
      attemptedAt: "2026-10-10T12:00:00.000Z",
      probeKind: "proactive_daily",
      env: TEST_ENV,
      fetch: mockFetch(() => ({ status: 429, body: {} })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    assert.equal(
      notifications.filter((t) => t.includes("Unable to verify")).length,
      1,
    );
  });

  it("successful validation clears unavailable state", async () => {
    await runFb(mockFetch(() => ({ status: 503, body: {} })));
    await runCredentialHealthMonitor({
      platform: "facebook",
      attemptedAt: "2026-10-09T12:00:00.000Z",
      probeKind: "proactive_daily",
      env: TEST_ENV,
      fetch: mockFetch(() => ({ status: 503, body: {} })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    await runCredentialHealthMonitor({
      platform: "facebook",
      attemptedAt: "2026-10-10T12:00:00.000Z",
      probeKind: "proactive_daily",
      env: TEST_ENV,
      fetch: mockFetch(() => ({ status: 200, body: fbDebugBody() })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    const stored = await store.load("facebook");
    assert.equal(stored?.consecutive_validation_failures, 0);
    assert.equal(stored?.monitoring_unavailable_push_sent, false);
  });

  it("reactive authentication failure and B1 publication_failed exclusion", async () => {
    const publication = basePublication({
      id: "pub-1",
      platform: "facebook",
      provider: "meta",
      lastError: "meta_auth_expired: token",
      attemptCount: 3,
    });
    const capture = evaluatePublicationFailedCapture(publication);
    assert.equal(capture.capture, false);
    if (!capture.capture) {
      assert.equal(capture.reason, "credential_class");
    }
    await observePublicationFailureOutcomes(publication, {
      sourceOperation: "test_reactive",
      repository: repo,
      credentialNotifyDeps: notifyDeps,
      credentialHeartbeatStore: store,
    });
    assert.equal(repo.listIncidents().length, 1);
    assert.ok(notifications.length >= 1);
  });

  it("incident deduplication escalation recovery and platform isolation", async () => {
    await runFb(
      mockFetch(() => ({
        status: 200,
        body: fbDebugBody({ is_valid: false }),
      })),
    );
    const first = repo.listIncidents().length;
    await runFb(
      mockFetch(() => ({
        status: 200,
        body: fbDebugBody({ is_valid: false }),
      })),
    );
    assert.equal(repo.listIncidents().length, first);
    await runCredentialHealthMonitor({
      platform: "instagram",
      attemptedAt: NOW,
      probeKind: "proactive_daily",
      env: TEST_ENV,
      fetch: mockFetch(() => ({ status: 200, body: { user_id: "1" } })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    assert.ok(repo.listIncidents().some((i) => i.platform === "instagram") === false);

    await runFb(mockFetch(() => ({ status: 200, body: fbDebugBody() })));
    const resolved = repo.listIncidents().find((i) => i.platform === "facebook");
    assert.equal(resolved?.status, "resolved");
  });

  it("instagram permission incident not resolved by /me alone", async () => {
    await runCredentialHealthMonitor({
      platform: "instagram",
      attemptedAt: NOW,
      probeKind: "reactive",
      env: TEST_ENV,
      attempt: credentialAttemptFromReactivePublishFailure({
        platform: "instagram",
        attemptedAt: NOW,
        errorClass: "meta_permissions",
      }),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
    });
    await runCredentialHealthMonitor({
      platform: "instagram",
      attemptedAt: NOW,
      probeKind: "proactive_daily",
      env: TEST_ENV,
      fetch: mockFetch(() => ({ status: 200, body: { user_id: "1" } })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    const open = repo.listIncidents().find((i) => i.platform === "instagram");
    assert.notEqual(open?.status, "resolved");
  });

  it("credential replacement and fingerprint key rotation", async () => {
    await runFb(mockFetch(() => ({ status: 200, body: fbDebugBody() })));
    const env2 = { ...TEST_ENV, META_FACEBOOK_PAGE_ACCESS_TOKEN: "fb-page-token-rotated" };
    await runCredentialHealthMonitor({
      platform: "facebook",
      attemptedAt: "2026-10-09T12:00:00.000Z",
      probeKind: "proactive_daily",
      env: env2,
      fetch: mockFetch(() => ({ status: 200, body: fbDebugBody() })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    const stored = await store.load("facebook");
    assert.equal(stored?.credential_replaced, true);

    const envEpoch = {
      ...env2,
      MARKETING_CREDENTIAL_FINGERPRINT_KEY_EPOCH: "2",
    };
    await runCredentialHealthMonitor({
      platform: "facebook",
      attemptedAt: "2026-10-10T12:00:00.000Z",
      probeKind: "proactive_daily",
      env: envEpoch,
      fetch: mockFetch(() => ({ status: 200, body: fbDebugBody() })),
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
      sourceOperation: "test",
      runProbe: runCredentialProbe,
    });
    const afterEpoch = await store.load("facebook");
    assert.equal(afterEpoch?.fingerprint_key_epoch, "2");
    assert.equal(afterEpoch?.credential_replaced, false);
  });

  it("concurrent monitoring preserves newer observations", async () => {
    await Promise.all([
      runCredentialHealthMonitor({
        platform: "facebook",
        attemptedAt: "2026-10-08T12:00:01.000Z",
        probeKind: "proactive_daily",
        env: TEST_ENV,
        fetch: mockFetch(() => ({ status: 200, body: fbDebugBody() })),
        heartbeatStore: store,
        incidentRepository: repo,
        notifyDeps,
        sourceOperation: "test",
        runProbe: runCredentialProbe,
      }),
      runCredentialHealthMonitor({
        platform: "facebook",
        attemptedAt: "2026-10-08T12:00:00.000Z",
        probeKind: "proactive_daily",
        env: TEST_ENV,
        fetch: mockFetch(() => ({
          status: 200,
          body: fbDebugBody({ is_valid: false }),
        })),
        heartbeatStore: store,
        incidentRepository: repo,
        notifyDeps,
        sourceOperation: "test",
        runProbe: runCredentialProbe,
      }),
    ]);
    const stored = await store.load("facebook");
    assert.equal(stored?.health_state, "healthy");
  });

  it("daily scheduling runs at most once per platform per utc day", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: fbDebugBody() }));
    const first = await runCredentialMonitoringDailyIfEnabled({
      nowIso: NOW,
      env: TEST_ENV,
      fetch,
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
    });
    assert.deepEqual(first.platforms.sort(), ["facebook", "instagram"]);
    const second = await runCredentialMonitoringDailyIfEnabled({
      nowIso: NOW,
      env: TEST_ENV,
      fetch,
      heartbeatStore: store,
      incidentRepository: repo,
      notifyDeps,
    });
    assert.equal(second.platforms.length, 0);
  });

  it("client payloads omit fingerprint fields", async () => {
    await runFb(mockFetch(() => ({ status: 200, body: fbDebugBody() })));
    const stored = await store.load("facebook");
    assert.ok(stored?.credential_fingerprint);
    const safe = storedToClientSafeMetadata(stored!);
    assert.equal("credential_fingerprint" in safe, false);
    assert.equal("previous_credential_fingerprint" in safe, false);
    const incident = repo.listIncidents()[0];
    if (incident?.evidence) {
      assert.equal("credential_fingerprint" in incident.evidence, false);
    }
  });

  it("non-expiring token classification", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: fbDebugBody({ expires_at: 0, scopes: ["pages_manage_posts"] }),
    });
    const c = classifyCredentialHealth(attempt, { referenceNowIso: NOW });
    assert.equal(c.expirationKnowledge, "provider_non_expiring");
    assert.equal(c.healthState, "healthy");
  });
});
