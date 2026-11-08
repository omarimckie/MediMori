import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { buildCredentialHealthDashboardView } from "./admin-dashboard";
import {
  classifyOpenAiCredentialHealth,
  createMemoryCredentialHealthHeartbeatStore,
  credentialFailureNotifyDedupeKey,
  credentialMonitoringUnavailableNotifyDedupeKey,
  defaultStoredCredentialHealthState,
  fingerprintOpenAiApiKey,
  isCredentialHealthObservationStale,
  notifyCredentialHealthOutcomes,
  parseOpenAiAuthErrorFromBody,
  resetCredentialFingerprintKeyForTests,
  resetOpenAiCredentialMonitoringEnabledAtForTests,
  runOpenAiCredentialHealthMonitor,
  runOpenAiCredentialMonitoringDailyIfEnabled,
  runOpenAiCredentialProbe,
  setCredentialFingerprintKeyForTests,
  setOpenAiCredentialMonitoringEnabledAtForTests,
  type CredentialProbeFetch,
} from "./index";

const ENABLED = "2026-10-01T00:00:00.000Z";
const NOW = "2026-10-08T12:00:00.000Z";
const FINGERPRINT_KEY = "openai-credential-fingerprint-key-32b!";
const API_KEY = "sk-test-openai-credential-probe-key";

function mockFetch(
  status: number,
  body: unknown,
  transient = false,
): CredentialProbeFetch {
  return async () => {
    if (transient) {
      throw new Error("network");
    }
    return {
      status,
      json: async () => body,
    };
  };
}

describe("OpenAI credential health (Phase 1)", () => {
  beforeEach(() => {
    setCredentialFingerprintKeyForTests(FINGERPRINT_KEY);
    setOpenAiCredentialMonitoringEnabledAtForTests(ENABLED);
  });

  afterEach(() => {
    resetCredentialFingerprintKeyForTests();
    resetOpenAiCredentialMonitoringEnabledAtForTests();
  });

  it("classifies expired API keys from OpenAI error codes", () => {
    const parsed = parseOpenAiAuthErrorFromBody(401, {
      error: { code: "expired_secret_key", message: "Your API key has expired." },
    });
    assert.equal(parsed.errorClass, "openai_auth_expired");
    const attempt = {
      platform: "openai" as const,
      method: "openai_models_list" as const,
      attemptedAt: NOW,
      monitoringAvailability: "available" as const,
      credentialsConfigured: true,
      tokenReportedValid: false,
      errorClass: parsed.errorClass,
      permissionCheck: "not_checked" as const,
      httpStatus: 401,
    };
    const classification = classifyOpenAiCredentialHealth(attempt);
    assert.equal(classification.healthState, "expired");
    assert.equal(classification.validity, "invalid");
    assert.equal(classification.expirationKnowledge, "unknown");
  });

  it("classifies invalid API keys (401) without claiming known expiration", async () => {
    const attempt = await runOpenAiCredentialProbe({
      attemptedAt: NOW,
      env: { OPENAI_API_KEY: API_KEY },
      fetch: mockFetch(401, {
        error: { code: "invalid_api_key", message: "Incorrect API key provided" },
      }),
    });
    const classification = classifyOpenAiCredentialHealth(attempt);
    assert.equal(classification.healthState, "revoked_or_invalid");
    assert.equal(classification.validity, "invalid");
    assert.equal(classification.knownExpiresAtIso, null);
  });

  it("treats provider outages as validation_unavailable", async () => {
    const attempt = await runOpenAiCredentialProbe({
      attemptedAt: NOW,
      env: { OPENAI_API_KEY: API_KEY },
      fetch: mockFetch(503, { error: { message: "slow down" } }),
    });
    const classification = classifyOpenAiCredentialHealth(attempt);
    assert.equal(classification.healthState, "validation_unavailable");
    assert.equal(classification.validity, "unknown");
    assert.equal(classification.errorClass, "openai_validation_transient");
  });

  it("records healthy auth with unknown expiration when models list succeeds", async () => {
    const attempt = await runOpenAiCredentialProbe({
      attemptedAt: NOW,
      env: { OPENAI_API_KEY: API_KEY },
      fetch: mockFetch(200, { data: [{ id: "gpt-4o-mini" }] }),
    });
    const classification = classifyOpenAiCredentialHealth(attempt);
    assert.equal(classification.validity, "valid");
    assert.equal(classification.healthState, "unknown_expiration");
    assert.equal(classification.expirationKnowledge, "unknown");
  });

  it("does not persist or fingerprint when monitoring disabled", async () => {
    setOpenAiCredentialMonitoringEnabledAtForTests(null);
    const store = createMemoryCredentialHealthHeartbeatStore();
    const result = await runOpenAiCredentialHealthMonitor({
      attemptedAt: NOW,
      probeKind: "proactive_daily",
      env: { OPENAI_API_KEY: API_KEY },
      fetch: mockFetch(200, { data: [] }),
      heartbeatStore: store,
      sourceOperation: "test",
    });
    assert.equal(result.skipped, true);
    assert.equal(await store.load("openai"), null);
  });

  it("dedupes duplicate auth-failure phone notifications for one incident episode", async () => {
    const repository = createMemoryIncidentRepository();
    const store = createMemoryCredentialHealthHeartbeatStore();
    const claimed = new Set<string>();
    const notifyDeps = {
      claimDedupe: async (input: { dedupeKey: string }) => {
        if (claimed.has(input.dedupeKey)) return false;
        claimed.add(input.dedupeKey);
        return true;
      },
      notify: async () => ({ notificationId: "n1", pushDelivered: 1 }),
      attachDedupe: async () => undefined,
      releaseDedupe: async () => undefined,
    };

    const env = { OPENAI_API_KEY: API_KEY };
    const fetch = mockFetch(401, {
      error: { code: "expired_secret_key", message: "expired" },
    });

    const first = await runOpenAiCredentialHealthMonitor({
      attemptedAt: NOW,
      probeKind: "proactive_daily",
      env,
      fetch,
      heartbeatStore: store,
      incidentRepository: repository,
      notifyDeps,
      sourceOperation: "test",
    });
    assert.equal(first.skipped, false);
    const incident = await repository.findByDedupeKey(
      "incident:credential_warning:v1:openai:api_key",
    );
    assert.ok(incident);

    const second = await runOpenAiCredentialHealthMonitor({
      attemptedAt: "2026-10-08T12:05:00.000Z",
      probeKind: "proactive_daily",
      env,
      fetch,
      heartbeatStore: store,
      incidentRepository: repository,
      notifyDeps,
      sourceOperation: "test",
    });
    assert.equal(second.skipped, false);
    const dedupeKey = credentialFailureNotifyDedupeKey(
      "openai",
      incident!,
      "occurrence",
    );
    const duplicate = await notifyCredentialHealthOutcomes({
      platform: "openai",
      classification: classifyOpenAiCredentialHealth(
        await runOpenAiCredentialProbe({
          attemptedAt: "2026-10-08T12:05:00.000Z",
          env,
          fetch,
        }),
      ),
      incident,
      incidentOutcome: "occurrence",
      consecutiveDailyUnavailable: 0,
      monitoringUnavailablePushSent: false,
      deps: notifyDeps,
    });
    assert.equal(duplicate.monitoringUnavailablePushSent, false);
    assert.equal(claimed.size, 1);
  });

  it("sends monitoring-unavailable push only after consecutive daily failures", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    await store.saveMerged(
      "openai",
      (prev) => {
        const base = prev ?? defaultStoredCredentialHealthState("openai");
        return {
          ...base,
          consecutive_validation_failures: 2,
          monitoring_unavailable_push_sent: false,
        };
      },
      { attemptedAtIso: NOW },
    );

    const claimed: string[] = [];
    await notifyCredentialHealthOutcomes({
      platform: "openai",
      classification: classifyOpenAiCredentialHealth({
        platform: "openai",
        method: "openai_models_list",
        attemptedAt: NOW,
        monitoringAvailability: "available",
        credentialsConfigured: true,
        permissionCheck: "not_checked",
        transientFailure: true,
        errorClass: "openai_validation_transient",
      }),
      incident: null,
      incidentOutcome: null,
      consecutiveDailyUnavailable: 2,
      monitoringUnavailablePushSent: false,
      deps: {
        claimDedupe: async (input) => {
          claimed.push(input.dedupeKey);
          return true;
        },
        notify: async () => ({ notificationId: "n-unavail" }),
        attachDedupe: async () => undefined,
        releaseDedupe: async () => undefined,
      },
    });
    assert.deepEqual(claimed, [
      credentialMonitoringUnavailableNotifyDedupeKey("openai"),
    ]);
  });

  it("marks dashboard observations stale when last attempt is too old", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    const oldAttempt = "2026-10-05T12:00:00.000Z";
    await store.saveMerged(
      "openai",
      () => ({
        ...defaultStoredCredentialHealthState("openai"),
        last_validation_attempt_at: oldAttempt,
        last_successful_validation_at: oldAttempt,
        validity: "valid",
        health_state: "unknown_expiration",
      }),
      { attemptedAtIso: oldAttempt },
    );
    const view = await buildCredentialHealthDashboardView({
      env: {
        OPENAI_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED,
      },
      heartbeatStore: store,
      nowIso: NOW,
      listIncidentsFn: async () => [],
    });
    const openai = view.platforms.find((row) => row.platform === "openai");
    assert.ok(openai);
    assert.equal(openai.observationStale, true);
    assert.equal(
      isCredentialHealthObservationStale(oldAttempt, NOW),
      true,
    );
  });

  it("claims only one proactive daily OpenAI probe per UTC day", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    const repository = createMemoryIncidentRepository();
    const env = { OPENAI_API_KEY: API_KEY };
    const fetch = mockFetch(200, { data: [] });
    const first = await runOpenAiCredentialMonitoringDailyIfEnabled({
      nowIso: NOW,
      env,
      fetch,
      heartbeatStore: store,
      incidentRepository: repository,
    });
    const second = await runOpenAiCredentialMonitoringDailyIfEnabled({
      nowIso: "2026-10-08T12:30:00.000Z",
      env,
      fetch,
      heartbeatStore: store,
      incidentRepository: repository,
    });
    assert.equal(first.ran, true);
    assert.equal(second.ran, false);
  });

  it("fingerprints API key without exposing secret material", () => {
    const fp = fingerprintOpenAiApiKey({ OPENAI_API_KEY: API_KEY });
    assert.ok(fp);
    assert.doesNotMatch(fp!, /sk-test/);
    assert.notEqual(fp, API_KEY);
  });

  it("never echoes API key material in probe error redaction path", async () => {
    const attempt = await runOpenAiCredentialProbe({
      attemptedAt: NOW,
      env: { OPENAI_API_KEY: API_KEY },
      fetch: mockFetch(401, {
        error: {
          code: "invalid_api_key",
          message: `Wrong key ${API_KEY}`,
        },
      }),
    });
    assert.equal(attempt.errorClass, "openai_auth_invalid");
    const serialized = JSON.stringify(attempt);
    assert.doesNotMatch(serialized, /sk-test-openai/);
  });
});
