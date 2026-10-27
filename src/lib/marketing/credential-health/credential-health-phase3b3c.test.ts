import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import { recordIncident } from "../incidents/record";
import {
  buildCredentialHealthDashboardView,
  serializeCredentialHealthDashboardForApi,
  createMemoryCredentialHealthHeartbeatStore,
  credentialWarningIncidentDedupeKey,
  defaultStoredCredentialHealthState,
  resetCredentialMonitoringEnabledAtForTests,
} from "./index";
import type { StoredCredentialHealthState } from "./heartbeat-store";

const ENABLED = "2026-10-01T00:00:00.000Z";
const NOW = "2026-10-08T14:00:00.000Z";

async function seedStored(
  store: ReturnType<typeof createMemoryCredentialHealthHeartbeatStore>,
  platform: "facebook" | "instagram",
  patch: Partial<StoredCredentialHealthState>,
) {
  const base = defaultStoredCredentialHealthState(platform);
  await store.saveMerged(
    platform,
    () => ({
      ...base,
      ...patch,
      platform,
      schema_version: 1,
      evidence: { ...base.evidence, ...(patch.evidence ?? {}) },
    }),
    { attemptedAtIso: patch.last_validation_attempt_at ?? NOW },
  );
}

describe("Phase III-B3-C credential health dashboard", () => {
  it("monitoring disabled shows not enabled without claiming healthy", async () => {
    resetCredentialMonitoringEnabledAtForTests();
    const view = await buildCredentialHealthDashboardView({
      env: {},
      nowIso: NOW,
      heartbeatStore: createMemoryCredentialHealthHeartbeatStore(),
      listIncidentsFn: async () => [],
    });
    assert.equal(view.monitoringEnabled, false);
    for (const row of view.platforms) {
      assert.equal(row.monitoringState, "disabled");
      assert.equal(row.validity, null);
      assert.match(row.healthStateLabel, /not enabled/i);
    }
  });

  it("enabled with no observations", async () => {
    const view = await buildCredentialHealthDashboardView({
      env: { MARKETING_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED },
      nowIso: NOW,
      heartbeatStore: createMemoryCredentialHealthHeartbeatStore(),
      listIncidentsFn: async () => [],
    });
    assert.equal(view.monitoringEnabled, true);
    assert.ok(view.platforms.every((p) => p.monitoringState === "no_observation"));
    assert.ok(view.platforms.every((p) => p.validity === "unknown"));
    assert.ok(view.platforms.every((p) => /not verified/i.test(p.healthStateLabel)));
  });

  it("healthy facebook observation", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    await seedStored(store, "facebook", {
      validity: "valid",
      health_state: "healthy",
      expiration_knowledge: "known",
      permission_check: "sufficient",
      last_successful_validation_at: NOW,
      last_validation_attempt_at: NOW,
      evidence: {
        platform: "facebook",
        health_state: "healthy",
        validity: "valid",
        expiration_knowledge: "known",
        validation_timestamp: NOW,
        known_expires_at: "2026-12-01T00:00:00.000Z",
        error_class: null,
        validation_method: "meta_debug_token",
        permission_check: "sufficient",
        evidence_confidence: "high",
        monitoring_availability: "available",
        non_expiring_token_reported: false,
      },
    });
    const view = await buildCredentialHealthDashboardView({
      env: { MARKETING_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED },
      nowIso: NOW,
      heartbeatStore: store,
      listIncidentsFn: async () => [],
    });
    const fb = view.platforms.find((p) => p.platform === "facebook")!;
    assert.equal(fb.monitoringState, "observed");
    assert.equal(fb.validity, "valid");
    assert.equal(fb.healthState, "healthy");
    assert.equal(fb.knownExpiresAt, "2026-12-01T00:00:00.000Z");
  });

  it("instagram valid with unknown expiration", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    await seedStored(store, "instagram", {
      validity: "valid",
      health_state: "unknown_expiration",
      expiration_knowledge: "unknown",
      permission_check: "unknown",
      last_successful_validation_at: NOW,
      last_validation_attempt_at: NOW,
      evidence: {
        platform: "instagram",
        health_state: "unknown_expiration",
        validity: "valid",
        expiration_knowledge: "unknown",
        validation_timestamp: NOW,
        known_expires_at: null,
        error_class: null,
        validation_method: "instagram_graph_me",
        permission_check: "unknown",
        evidence_confidence: "low",
        monitoring_availability: "available",
        non_expiring_token_reported: false,
      },
    });
    const view = await buildCredentialHealthDashboardView({
      env: { MARKETING_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED },
      nowIso: NOW,
      heartbeatStore: store,
      listIncidentsFn: async () => [],
    });
    const ig = view.platforms.find((p) => p.platform === "instagram")!;
    assert.equal(ig.expirationStatus, "unknown");
    assert.equal(ig.knownExpiresAt, null);
    assert.match(ig.expirationStatusLabel, /unknown/i);
  });

  it("expiring, invalid, and permission scenarios", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    await seedStored(store, "facebook", {
      validity: "valid",
      health_state: "expiring_soon",
      expiration_knowledge: "known",
      permission_check: "sufficient",
      last_validation_attempt_at: NOW,
      evidence: {
        platform: "facebook",
        health_state: "expiring_soon",
        validity: "valid",
        expiration_knowledge: "known",
        validation_timestamp: NOW,
        known_expires_at: "2026-10-10T00:00:00.000Z",
        error_class: null,
        validation_method: "meta_debug_token",
        permission_check: "sufficient",
        evidence_confidence: "high",
        monitoring_availability: "available",
        non_expiring_token_reported: false,
      },
    });
    await seedStored(store, "instagram", {
      validity: "invalid",
      health_state: "revoked_or_invalid",
      permission_check: "insufficient",
      last_validation_attempt_at: NOW,
      evidence: {
        platform: "instagram",
        health_state: "revoked_or_invalid",
        validity: "invalid",
        expiration_knowledge: "unknown",
        validation_timestamp: NOW,
        known_expires_at: null,
        error_class: "meta_permissions",
        validation_method: "meta_debug_token",
        permission_check: "insufficient",
        evidence_confidence: "medium",
        monitoring_availability: "available",
        non_expiring_token_reported: false,
      },
    });
    const view = await buildCredentialHealthDashboardView({
      env: { MARKETING_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED },
      nowIso: NOW,
      heartbeatStore: store,
      listIncidentsFn: async () => [],
    });
    const fb = view.platforms.find((p) => p.platform === "facebook")!;
    const ig = view.platforms.find((p) => p.platform === "instagram")!;
    assert.equal(fb.healthState, "expiring_soon");
    assert.equal(ig.validity, "invalid");
    assert.match(ig.permissionStatusLabel, /insufficient/i);
  });

  it("monitoring unavailable warning", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    await seedStored(store, "facebook", {
      validity: "unknown",
      health_state: "validation_unavailable",
      consecutive_validation_failures: 2,
      last_validation_attempt_at: NOW,
      evidence: {
        platform: "facebook",
        health_state: "validation_unavailable",
        validity: "unknown",
        expiration_knowledge: "unknown",
        validation_timestamp: NOW,
        known_expires_at: null,
        error_class: "meta_validation_transient",
        validation_method: "meta_debug_token",
        permission_check: "not_checked",
        evidence_confidence: "low",
        monitoring_availability: "unavailable",
        non_expiring_token_reported: false,
      },
    });
    const view = await buildCredentialHealthDashboardView({
      env: { MARKETING_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED },
      nowIso: NOW,
      heartbeatStore: store,
      listIncidentsFn: async () => [],
    });
    assert.equal(view.platforms[0].monitoringUnavailableWarning, true);
  });

  it("active credential incident link", async () => {
    const repo = createMemoryIncidentRepository();
    await recordIncident(repo, {
      incidentType: "credential_warning",
      status: "action_required",
      severity: "error",
      sourceOperation: "test",
      dedupeKey: credentialWarningIncidentDedupeKey("facebook"),
      errorClass: "meta_auth_expired",
      errorMessage: "Facebook token expired",
      retrySafety: "not_applicable",
      permittedActions: ["investigate_read_only"],
      platform: "facebook",
      provider: "meta",
    });
    const incidents = await repo.listIncidents();
    const view = await buildCredentialHealthDashboardView({
      env: { MARKETING_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED },
      nowIso: NOW,
      heartbeatStore: createMemoryCredentialHealthHeartbeatStore(),
      listIncidentsFn: async () => incidents,
    });
    const fb = view.platforms.find((p) => p.platform === "facebook")!;
    assert.ok(fb.activeIncident);
    assert.match(fb.activeIncident!.incidentUrl, /\/admin\/marketing\/incidents\//);
  });

  it("serialized API payload has no credential or fingerprint leakage", async () => {
    const store = createMemoryCredentialHealthHeartbeatStore();
    await seedStored(store, "facebook", {
      validity: "valid",
      health_state: "healthy",
      credential_fingerprint: "secret-fp-should-not-export",
      previous_credential_fingerprint: "prev-fp",
      last_validation_attempt_at: NOW,
      evidence: {
        platform: "facebook",
        health_state: "healthy",
        validity: "valid",
        expiration_knowledge: "known",
        validation_timestamp: NOW,
        known_expires_at: null,
        error_class: null,
        validation_method: "meta_debug_token",
        permission_check: "sufficient",
        evidence_confidence: "high",
        monitoring_availability: "available",
        non_expiring_token_reported: false,
      },
    });
    const view = await buildCredentialHealthDashboardView({
      env: { MARKETING_CREDENTIAL_MONITORING_ENABLED_AT: ENABLED },
      nowIso: NOW,
      heartbeatStore: store,
      listIncidentsFn: async () => [],
    });
    const json = JSON.stringify(serializeCredentialHealthDashboardForApi(view));
    assert.doesNotMatch(json, /fingerprint/i);
    assert.doesNotMatch(json, /access_token|app_secret|META_/i);
    assert.doesNotMatch(json, /secret-fp/);
  });

  it("admin API route requires marketing admin auth", () => {
    const source = readFileSync(
      "src/app/api/admin/marketing/credential-health/route.ts",
      "utf8",
    );
    assert.match(source, /requireMarketingAdmin/);
  });

  it("dashboard page is wired in marketing admin shell", () => {
    const shell = readFileSync("src/components/admin/marketing/MarketingShell.tsx", "utf8");
    assert.match(shell, /credential-health/);
    const page = readFileSync("src/app/admin/marketing/credential-health/page.tsx", "utf8");
    assert.match(page, /CredentialHealthClient/);
  });
});
