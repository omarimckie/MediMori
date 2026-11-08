import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import {
  buildCredentialHealthDashboardView,
  classifyIntegrationCredentialHealth,
  createMemoryCredentialHealthHeartbeatStore,
  credentialFailureNotifyDedupeKey,
  defaultStoredCredentialHealthState,
  fingerprintIntegrationCredential,
  isCredentialHealthObservationStale,
  notifyCredentialHealthOutcomes,
  parseResendAuthFromResponse,
  parseStripeAuthFromResponse,
  resetCredentialFingerprintKeyForTests,
  resetIntegrationCredentialMonitoringEnabledAtForTests,
  runIntegrationCredentialHealthMonitor,
  runIntegrationCredentialMonitoringDailyIfEnabled,
  runNeonPostgresCredentialProbe,
  runPinterestCredentialProbe,
  runResendCredentialProbe,
  runStripeCredentialProbe,
  runVercelBlobCredentialProbe,
  setBlobListProbeForTests,
  setCredentialFingerprintKeyForTests,
  setIntegrationCredentialMonitoringEnabledAtForTests,
  setNeonPingProbeForTests,
  type CredentialProbeFetch,
} from "./index";

const ENABLED = "2026-10-01T00:00:00.000Z";
const NOW = "2026-10-08T12:00:00.000Z";
const FINGERPRINT_KEY = "integration-credential-fingerprint-key-32!";
const STRIPE_KEY = "sk_test_credential_health";
const RESEND_KEY = "re_credential_health_test";

function mockFetch(status: number): CredentialProbeFetch {
  return async () => ({
    status,
    json: async () => ({}),
  });
}

describe("Integration credential health (Phase 2)", () => {
  beforeEach(() => {
    setCredentialFingerprintKeyForTests(FINGERPRINT_KEY);
    setIntegrationCredentialMonitoringEnabledAtForTests(ENABLED);
  });

  afterEach(() => {
    resetCredentialFingerprintKeyForTests();
    resetIntegrationCredentialMonitoringEnabledAtForTests();
    setBlobListProbeForTests(null);
    setNeonPingProbeForTests(null);
  });

  it("Stripe: valid balance probe", async () => {
    const attempt = await runStripeCredentialProbe({
      attemptedAt: NOW,
      env: { STRIPE_SECRET_KEY: STRIPE_KEY },
      fetch: mockFetch(200),
    });
    const c = classifyIntegrationCredentialHealth(attempt);
    assert.equal(c.validity, "valid");
    assert.equal(c.healthState, "unknown_expiration");
  });

  it("Stripe: invalid vs outage", async () => {
    const invalid = classifyIntegrationCredentialHealth(
      await runStripeCredentialProbe({
        attemptedAt: NOW,
        env: { STRIPE_SECRET_KEY: STRIPE_KEY },
        fetch: mockFetch(401),
      }),
    );
    assert.equal(invalid.validity, "invalid");
    assert.equal(invalid.errorClass, "stripe_auth_invalid");

    const outage = classifyIntegrationCredentialHealth(
      await runStripeCredentialProbe({
        attemptedAt: NOW,
        env: { STRIPE_SECRET_KEY: STRIPE_KEY },
        fetch: mockFetch(503),
      }),
    );
    assert.equal(outage.healthState, "validation_unavailable");
    assert.equal(outage.errorClass, "stripe_validation_transient");
  });

  it("Resend: auth parsing", () => {
    assert.equal(parseResendAuthFromResponse(200).tokenReportedValid, true);
    assert.equal(parseResendAuthFromResponse(401).errorClass, "resend_auth_invalid");
    assert.equal(parseStripeAuthFromResponse(503).errorClass, "stripe_validation_transient");
  });

  it("Pinterest: configured but no safe probe reports unknown", async () => {
    const attempt = await runPinterestCredentialProbe({
      attemptedAt: NOW,
      env: {
        PINTEREST_CLIENT_ID: "id",
        PINTEREST_CLIENT_SECRET: "secret-value-32chars-minimum!!",
        PINTEREST_REFRESH_TOKEN: "refresh",
        PINTEREST_BOARD_ID: "board",
      },
    });
    const c = classifyIntegrationCredentialHealth(attempt);
    assert.equal(c.validity, "unknown");
    assert.equal(c.errorClass, "pinterest_no_safe_probe");
  });

  it("Blob: list probe success and auth failure", async () => {
    setBlobListProbeForTests(async () => ({ ok: true }));
    const ok = await runVercelBlobCredentialProbe({
      attemptedAt: NOW,
      env: { BLOB_READ_WRITE_TOKEN: "rw_token" },
    });
    assert.equal(classifyIntegrationCredentialHealth(ok).validity, "valid");

    setBlobListProbeForTests(async () => ({ ok: false, authFailure: true }));
    const bad = await runVercelBlobCredentialProbe({
      attemptedAt: NOW,
      env: { BLOB_READ_WRITE_TOKEN: "rw_token" },
    });
    assert.equal(classifyIntegrationCredentialHealth(bad).errorClass, "vercel_blob_auth_invalid");
  });

  it("Neon: connectivity probe via injectable ping", async () => {
    setNeonPingProbeForTests(async () => ({ ok: true }));
    const ok = await runNeonPostgresCredentialProbe({
      attemptedAt: NOW,
      env: { DATABASE_URL: "postgresql://u:p@ep-test.neon.tech/main" },
    });
    assert.equal(classifyIntegrationCredentialHealth(ok).validity, "valid");

    setNeonPingProbeForTests(async () => ({ ok: false, reason: "transient" }));
    const outage = await runNeonPostgresCredentialProbe({
      attemptedAt: NOW,
      env: { DATABASE_URL: "postgresql://u:p@ep-test.neon.tech/main" },
    });
    assert.equal(classifyIntegrationCredentialHealth(outage).errorClass, "neon_postgres_validation_transient");
  });

  it("dedupes Stripe auth-failure notifications", async () => {
    const repository = createMemoryIncidentRepository();
    const store = createMemoryCredentialHealthHeartbeatStore();
    const claimed = new Set<string>();
    const notifyDeps = {
      claimDedupe: async (input: { dedupeKey: string }) => {
        if (claimed.has(input.dedupeKey)) return false;
        claimed.add(input.dedupeKey);
        return true;
      },
      notify: async () => ({ notificationId: "n-stripe", pushDelivered: 1 }),
      attachDedupe: async () => undefined,
      releaseDedupe: async () => undefined,
    };

    await runIntegrationCredentialHealthMonitor({
      platform: "stripe",
      attemptedAt: NOW,
      probeKind: "proactive_daily",
      env: { STRIPE_SECRET_KEY: STRIPE_KEY },
      fetch: mockFetch(401),
      heartbeatStore: store,
      incidentRepository: repository,
      notifyDeps,
      sourceOperation: "test",
    });
    const incident = await repository.findByDedupeKey(
      "incident:credential_warning:v1:stripe:credential",
    );
    assert.ok(incident);
    await notifyCredentialHealthOutcomes({
      platform: "stripe",
      classification: classifyIntegrationCredentialHealth(
        await runStripeCredentialProbe({
          attemptedAt: NOW,
          env: { STRIPE_SECRET_KEY: STRIPE_KEY },
          fetch: mockFetch(401),
        }),
      ),
      incident,
      incidentOutcome: "occurrence",
      consecutiveDailyUnavailable: 0,
      monitoringUnavailablePushSent: false,
      deps: notifyDeps,
    });
    assert.equal(claimed.size, 1);
    const dedupeKey = credentialFailureNotifyDedupeKey("stripe", incident!, "created");
    assert.ok(claimed.has(dedupeKey));
  });

  it("Pinterest does not open auth incident when only safe probe is unavailable", async () => {
    const repository = createMemoryIncidentRepository();
    const store = createMemoryCredentialHealthHeartbeatStore();
    await runIntegrationCredentialHealthMonitor({
      platform: "pinterest",
      attemptedAt: NOW,
      probeKind: "proactive_daily",
      env: {
        PINTEREST_CLIENT_ID: "id",
        PINTEREST_CLIENT_SECRET: "secret-value-32chars-minimum!!",
        PINTEREST_REFRESH_TOKEN: "refresh",
        PINTEREST_BOARD_ID: "board",
      },
      heartbeatStore: store,
      incidentRepository: repository,
      sourceOperation: "test",
    });
    const incident = await repository.findByDedupeKey(
      "incident:credential_warning:v1:pinterest:credential",
    );
    assert.equal(incident, null);
  });

  it("daily claim runs once per UTC day per integration", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    const repository = createMemoryIncidentRepository();
    const env = { STRIPE_SECRET_KEY: STRIPE_KEY };
    const notifyDeps = {
      claimDedupe: async () => true,
      notify: async () => ({ notificationId: "n", pushDelivered: 0 }),
      attachDedupe: async () => undefined,
      releaseDedupe: async () => undefined,
    };
    const first = await runIntegrationCredentialMonitoringDailyIfEnabled({
      nowIso: NOW,
      env,
      fetch: mockFetch(200),
      heartbeatStore: store,
      incidentRepository: repository,
      notifyDeps,
    });
    const second = await runIntegrationCredentialMonitoringDailyIfEnabled({
      nowIso: "2026-10-08T14:00:00.000Z",
      env,
      fetch: mockFetch(200),
      heartbeatStore: store,
      incidentRepository: repository,
      notifyDeps,
    });
    assert.ok(first.platforms.includes("stripe"));
    assert.equal(second.ran, false);
  });

  it("fingerprints integration secrets without echoing material", () => {
    const fp = fingerprintIntegrationCredential("stripe", { STRIPE_SECRET_KEY: STRIPE_KEY });
    assert.ok(fp);
    assert.doesNotMatch(fp!, /sk_test/);
  });

  it("dashboard marks stale Stripe observations", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    const old = "2026-10-05T12:00:00.000Z";
    await store.saveMerged(
      "stripe",
      () => ({
        ...defaultStoredCredentialHealthState("stripe"),
        last_validation_attempt_at: old,
        validity: "valid",
        health_state: "unknown_expiration",
      }),
      { attemptedAtIso: old },
    );
    const view = await buildCredentialHealthDashboardView({
      env: { MARKETING_INTEGRATION_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED },
      heartbeatStore: store,
      nowIso: NOW,
      listIncidentsFn: async () => [],
    });
    const stripe = view.platforms.find((p) => p.platform === "stripe");
    assert.ok(stripe?.platformDescription);
    assert.equal(stripe?.observationStale, isCredentialHealthObservationStale(old, NOW));
  });

  it("Resend missing key does not imply healthy from env presence alone", async () => {
    const attempt = await runResendCredentialProbe({ attemptedAt: NOW, env: {} });
    const c = classifyIntegrationCredentialHealth(attempt);
    assert.equal(c.validity, "invalid");
    assert.equal(c.errorClass, "resend_credentials_missing");
    assert.notEqual(c.healthState, "healthy");
  });
});
