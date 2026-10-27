import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createMemoryIncidentRepository } from "../incidents/memory-repository";
import {
  credentialFailureNotifyDedupeKey,
  isVerifiedCredentialRecovery,
  notifyCredentialHealthOutcomes,
  resolveCredentialHealthHeartbeatStore,
  resetCredentialHealthHeartbeatStoreForTests,
  classifyCredentialHealth,
  credentialAttemptFromMetaDebugToken,
  credentialAttemptFromInstagramGraphMe,
  buildCredentialAuthFailurePayload,
} from "./index";
import type { CredentialHealthClassification } from "./types";
import type { MarketingIncidentRecord } from "../incidents/types";

function classification(patch: Partial<CredentialHealthClassification>): CredentialHealthClassification {
  return {
    healthState: "healthy",
    validity: "valid",
    expirationKnowledge: "known",
    permissionCheck: "sufficient",
    confidence: "high",
    errorClass: null,
    knownExpiresAtIso: null,
    nonExpiringTokenReported: false,
    ...patch,
  };
}

function openIncident(
  _repo: ReturnType<typeof createMemoryIncidentRepository>,
  patch: Partial<MarketingIncidentRecord> & { id: string },
): MarketingIncidentRecord {
  const { id, ...rest } = patch;
  return {
    id,
    schemaVersion: 1,
    incidentVersion: 1,
    incidentType: "credential_warning",
    status: "action_required",
    severity: "error",
    sourceSystem: "marketing_autopilot",
    sourceOperation: "test",
    occurredAt: "2026-10-08T12:00:00.000Z",
    detectedAt: "2026-10-08T12:00:00.000Z",
    contentId: null,
    publicationId: null,
    platform: "facebook",
    provider: "meta",
    batchId: null,
    finalizeKey: null,
    dedupeKey: "incident:credential_warning:v1:meta:facebook",
    occurrenceCount: 1,
    firstSeenAt: "2026-10-08T12:00:00.000Z",
    lastSeenAt: "2026-10-08T12:00:00.000Z",
    errorClass: "meta_auth_expired",
    sanitizedError: "expired",
    retrySafety: "not_applicable",
    permittedActions: ["investigate_read_only"],
    humanApprovalRequired: false,
    evidence: {},
    resolutionType: null,
    resolutionSummary: null,
    resolvedAt: null,
    agentWorkCorrelationId: "c1",
    agentWorkLastSubmittedAt: null,
    agentWorkLastSubmitError: null,
    createdAt: "2026-10-08T12:00:00.000Z",
    updatedAt: "2026-10-08T12:00:00.000Z",
    ...rest,
  };
}

describe("Phase III-B3-B closeout checks", () => {
  afterEach(() => {
    resetCredentialHealthHeartbeatStoreForTests();
    const url = process.env.DATABASE_URL;
    if (url === "postgresql://closeout-test") {
      delete process.env.DATABASE_URL;
    }
  });

  it("notification dedupe: repeated reactive failures notify once per open episode", async () => {
    const claimed = new Set<string>();
    const notifications: string[] = [];
    const deps = {
      claimDedupe: async ({ dedupeKey }: { dedupeKey: string }) => {
        if (claimed.has(dedupeKey)) return false;
        claimed.add(dedupeKey);
        return true;
      },
      notify: async (p: { title: string }) => {
        notifications.push(p.title);
        return { notificationId: "n1" };
      },
      attachDedupe: async () => {},
      releaseDedupe: async () => {},
    };
    const incident = openIncident(createMemoryIncidentRepository(), { id: "inc-1" });
    const c = classification({
      healthState: "expired",
      validity: "invalid",
      errorClass: "meta_auth_expired",
    });
    await notifyCredentialHealthOutcomes({
      platform: "facebook",
      classification: c,
      incident,
      incidentOutcome: "occurrence",
      consecutiveDailyUnavailable: 0,
      monitoringUnavailablePushSent: false,
      immediateAuthFailure: true,
      deps,
    });
    await notifyCredentialHealthOutcomes({
      platform: "facebook",
      classification: c,
      incident,
      incidentOutcome: "occurrence",
      consecutiveDailyUnavailable: 0,
      monitoringUnavailablePushSent: false,
      immediateAuthFailure: true,
      deps,
    });
    assert.equal(notifications.length, 1);
    assert.equal(
      credentialFailureNotifyDedupeKey("facebook", incident, "occurrence"),
      "credential_notify:v1:facebook:auth_failure:inc-1:open",
    );
  });

  it("notification dedupe: concurrent claims only deliver one push", async () => {
    const claimed = new Set<string>();
    let inFlight = 0;
    let maxInFlight = 0;
    const deps = {
      claimDedupe: async ({ dedupeKey }: { dedupeKey: string }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        if (claimed.has(dedupeKey)) {
          inFlight -= 1;
          return false;
        }
        claimed.add(dedupeKey);
        inFlight -= 1;
        return true;
      },
      notify: async () => ({ notificationId: "n1" }),
      attachDedupe: async () => {},
      releaseDedupe: async () => {},
    };
    const incident = openIncident(createMemoryIncidentRepository(), { id: "inc-2" });
    const c = classification({
      healthState: "revoked_or_invalid",
      validity: "invalid",
      errorClass: "meta_permissions",
      permissionCheck: "insufficient",
    });
    await Promise.all([
      notifyCredentialHealthOutcomes({
        platform: "instagram",
        classification: c,
        incident,
        incidentOutcome: "created",
        consecutiveDailyUnavailable: 0,
        monitoringUnavailablePushSent: false,
        deps,
      }),
      notifyCredentialHealthOutcomes({
        platform: "instagram",
        classification: c,
        incident,
        incidentOutcome: "created",
        consecutiveDailyUnavailable: 0,
        monitoringUnavailablePushSent: false,
        deps,
      }),
    ]);
    assert.equal(claimed.size, 1);
    assert.ok(maxInFlight >= 1);
  });

  it("notification dedupe: reopened incident after recovery uses a new episode key", () => {
    const base = openIncident(createMemoryIncidentRepository(), { id: "inc-3" });
    const created = credentialFailureNotifyDedupeKey("facebook", base, "created");
    const reopened = credentialFailureNotifyDedupeKey(
      "facebook",
      { ...base, occurrenceCount: 2 },
      "reopened",
    );
    assert.notEqual(created, reopened);
  });

  it("permission recovery: Facebook permissions need sufficient scopes", () => {
    const incident = openIncident(createMemoryIncidentRepository(), {
      id: "fb-perm",
      errorClass: "meta_permissions",
    });
    const igMeOnly = classifyCredentialHealth(
      credentialAttemptFromInstagramGraphMe({
        attemptedAt: "2026-10-08T12:00:00.000Z",
        credentialsConfigured: true,
        httpStatus: 200,
        body: { user_id: "1" },
      }),
    );
    assert.equal(isVerifiedCredentialRecovery(igMeOnly, incident), false);

    const fbUnknownScopes = classifyCredentialHealth(
      credentialAttemptFromMetaDebugToken({
        platform: "facebook",
        attemptedAt: "2026-10-08T12:00:00.000Z",
        credentialsConfigured: true,
        httpStatus: 200,
        body: {
          data: {
            is_valid: true,
            expires_at: Math.floor(Date.parse("2026-11-07T12:00:00.000Z") / 1000),
            scopes: ["read_insights"],
          },
        },
      }),
    );
    assert.equal(isVerifiedCredentialRecovery(fbUnknownScopes, incident), false);

    const fbSufficient = classifyCredentialHealth(
      credentialAttemptFromMetaDebugToken({
        platform: "facebook",
        attemptedAt: "2026-10-08T12:00:00.000Z",
        credentialsConfigured: true,
        httpStatus: 200,
        body: {
          data: {
            is_valid: true,
            expires_at: Math.floor(Date.parse("2026-11-07T12:00:00.000Z") / 1000),
            scopes: ["pages_manage_posts"],
          },
        },
      }),
    );
    assert.equal(isVerifiedCredentialRecovery(fbSufficient, incident), true);
  });

  it("permission recovery: Instagram /me alone cannot resolve meta_permissions", () => {
    const incident = openIncident(createMemoryIncidentRepository(), {
      id: "ig-perm",
      platform: "instagram",
      errorClass: "meta_permissions",
    });
    const igMe = classifyCredentialHealth(
      credentialAttemptFromInstagramGraphMe({
        attemptedAt: "2026-10-08T12:00:00.000Z",
        credentialsConfigured: true,
        httpStatus: 200,
        body: { user_id: "99" },
      }),
    );
    assert.equal(igMe.permissionCheck, "unknown");
    assert.equal(isVerifiedCredentialRecovery(igMe, incident), false);
  });

  it("reactive persistence resolves postgres backend when DATABASE_URL is set", async () => {
    process.env.DATABASE_URL = "postgresql://closeout-test";
    resetCredentialHealthHeartbeatStoreForTests();
    const store = resolveCredentialHealthHeartbeatStore();
    assert.equal(store.storeBackend, "postgres");
  });

  it("security: auth notification payload has no secrets or fingerprints", () => {
    const payload = buildCredentialAuthFailurePayload("facebook", "inc-1");
    const json = JSON.stringify(payload);
    assert.doesNotMatch(json, /access_token|app_secret|fingerprint|Bearer /i);
    assert.doesNotMatch(json, /META_/);
  });
});
