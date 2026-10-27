import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sanitizeEvidence } from "../incidents/sanitize";
import {
  classifyCredentialHealth,
  credentialAttemptFromInstagramGraphMe,
  credentialAttemptFromMetaDebugToken,
  credentialAttemptFromUnsupportedMethod,
  credentialFingerprintChanged,
  fingerprintMetaAccessToken,
  resetCredentialFingerprintKeyForTests,
  setCredentialFingerprintKeyForTests,
  buildCredentialHealthEvidence,
  buildCredentialHealthSnapshot,
  buildCredentialHealthHeartbeatMetadata,
  credentialHealthHeartbeatSource,
  snapshotIncidentEvidence,
  supportedProbeMethodForPlatform,
  validateCredentialFingerprintKey,
} from "./index";

const NOW = "2026-10-08T12:00:00.000Z";
const IN_3_DAYS = "2026-10-11T12:00:00.000Z";
const IN_30_DAYS = "2026-11-07T12:00:00.000Z";
const PAST = "2026-10-01T12:00:00.000Z";

describe("Phase III-B3-A credential health foundation", () => {
  beforeEach(() => {
    setCredentialFingerprintKeyForTests("b3a-test-fingerprint-key-32bytes!!");
  });

  afterEach(() => {
    resetCredentialFingerprintKeyForTests();
  });

  it("healthy credential with verified expiration beyond 7 days", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: {
        data: {
          is_valid: true,
          expires_at: Math.floor(Date.parse(IN_30_DAYS) / 1000),
          scopes: ["pages_manage_posts", "pages_show_list"],
        },
      },
    });
    const c = classifyCredentialHealth(attempt, { referenceNowIso: NOW });
    assert.equal(c.healthState, "healthy");
    assert.equal(c.validity, "valid");
    assert.equal(c.expirationKnowledge, "known");
    assert.equal(c.permissionCheck, "sufficient");
  });

  it("expiring_soon within 7 days", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: {
        data: {
          is_valid: true,
          expires_at: Math.floor(Date.parse(IN_3_DAYS) / 1000),
          scopes: ["pages_manage_posts"],
        },
      },
    });
    const c = classifyCredentialHealth(attempt, { referenceNowIso: NOW });
    assert.equal(c.healthState, "expiring_soon");
  });

  it("provider-confirmed non-expiring page token (expires_at 0)", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: {
        data: {
          is_valid: true,
          expires_at: 0,
          scopes: ["pages_manage_posts"],
        },
      },
    });
    const c = classifyCredentialHealth(attempt, { referenceNowIso: NOW });
    assert.equal(c.healthState, "healthy");
    assert.equal(c.validity, "valid");
    assert.equal(c.expirationKnowledge, "provider_non_expiring");
    assert.equal(c.nonExpiringTokenReported, true);
    assert.notEqual(c.healthState, "expired");
  });

  it("non-expiring token with unknown permissions stays unknown_expiration health", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: {
        data: {
          is_valid: true,
          expires_at: 0,
          scopes: [],
        },
      },
    });
    const c = classifyCredentialHealth(attempt, { referenceNowIso: NOW });
    assert.equal(c.expirationKnowledge, "provider_non_expiring");
    assert.equal(c.permissionCheck, "unknown");
    assert.equal(c.healthState, "unknown_expiration");
    assert.equal(c.validity, "valid");
  });

  it("unknown expiration for Instagram /me success without expiry metadata", () => {
    const attempt = credentialAttemptFromInstagramGraphMe({
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: { user_id: "17841400000000000" },
    });
    const c = classifyCredentialHealth(attempt, { referenceNowIso: NOW });
    assert.equal(c.healthState, "unknown_expiration");
    assert.equal(c.validity, "valid");
    assert.equal(c.expirationKnowledge, "unknown");
    assert.equal(c.permissionCheck, "unknown");
    assert.notEqual(c.permissionCheck, "sufficient");
    assert.equal(c.knownExpiresAtIso, null);
  });

  it("expired token from debug_token is_valid false", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: { data: { is_valid: false, expires_at: Math.floor(Date.parse(PAST) / 1000) } },
    });
    const c = classifyCredentialHealth(attempt, { referenceNowIso: NOW });
    assert.equal(c.healthState, "expired");
    assert.equal(c.validity, "invalid");
  });

  it("expired token from past known_expires_at while still marked valid", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: {
        data: {
          is_valid: true,
          expires_at: Math.floor(Date.parse(PAST) / 1000),
          scopes: ["pages_manage_posts"],
        },
      },
    });
    const c = classifyCredentialHealth(attempt, { referenceNowIso: NOW });
    assert.equal(c.healthState, "expired");
  });

  it("revoked_or_invalid for missing permissions on debug_token", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: {
        data: {
          is_valid: true,
          expires_at: Math.floor(Date.parse(IN_30_DAYS) / 1000),
          scopes: ["public_profile"],
        },
      },
    });
    const c = classifyCredentialHealth(attempt, { referenceNowIso: NOW });
    assert.equal(c.healthState, "revoked_or_invalid");
    assert.equal(c.errorClass, "meta_permissions");
  });

  it("missing credentials", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: false,
      httpStatus: 0,
      body: {},
    });
    const c = classifyCredentialHealth(attempt);
    assert.equal(c.healthState, "revoked_or_invalid");
    assert.equal(c.errorClass, "meta_credentials_missing");
  });

  it("transient timeout maps to validation_unavailable not revoked", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 0,
      body: {},
      transientFailure: true,
    });
    const c = classifyCredentialHealth(attempt);
    assert.equal(c.healthState, "validation_unavailable");
    assert.equal(c.validity, "unknown");
    assert.notEqual(c.healthState, "revoked_or_invalid");
  });

  it("rate limit maps to validation_unavailable", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 429,
      body: {},
    });
    const c = classifyCredentialHealth(attempt);
    assert.equal(c.healthState, "validation_unavailable");
    assert.equal(c.errorClass, "meta_rate_limited");
  });

  it("Meta 5xx maps to validation_unavailable", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 503,
      body: {},
    });
    const c = classifyCredentialHealth(attempt);
    assert.equal(c.healthState, "validation_unavailable");
  });

  it("unsupported introspection method", () => {
    const attempt = credentialAttemptFromUnsupportedMethod("instagram", NOW);
    const c = classifyCredentialHealth(attempt);
    assert.equal(c.healthState, "validation_unavailable");
    assert.equal(attempt.method, "unsupported");
  });

  it("Facebook and Instagram provider methods are isolated", () => {
    assert.equal(supportedProbeMethodForPlatform("facebook"), "meta_debug_token");
    assert.equal(supportedProbeMethodForPlatform("instagram"), "instagram_graph_me");
  });

  it("token replacement fingerprint detects change", () => {
    const a = fingerprintMetaAccessToken("facebook", "token-a");
    const b = fingerprintMetaAccessToken("facebook", "token-b");
    assert.ok(a && b);
    assert.ok(credentialFingerprintChanged(a, b));
    assert.equal(credentialFingerprintChanged(a, a), false);
  });

  it("platform isolation for fingerprints", () => {
    const fb = fingerprintMetaAccessToken("facebook", "same-token");
    const ig = fingerprintMetaAccessToken("instagram", "same-token");
    assert.ok(fb && ig);
    assert.notEqual(fb, ig);
  });

  it("missing fingerprint key returns null without throwing", () => {
    setCredentialFingerprintKeyForTests(null);
    assert.equal(fingerprintMetaAccessToken("facebook", "token"), null);
  });

  it("short fingerprint key is rejected", () => {
    setCredentialFingerprintKeyForTests("too-short");
    assert.equal(validateCredentialFingerprintKey("too-short").ok, false);
    assert.equal(fingerprintMetaAccessToken("facebook", "token"), null);
  });

  it("durable heartbeat metadata without credential_warning incident", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: {
        data: {
          is_valid: true,
          expires_at: Math.floor(Date.parse(IN_30_DAYS) / 1000),
          scopes: ["pages_manage_posts"],
        },
      },
    });
    const snap = buildCredentialHealthSnapshot({
      attempt,
      credentialFingerprint: "fp1",
      lastSuccessfulValidationAt: null,
      referenceNowIso: NOW,
    });
    const meta = buildCredentialHealthHeartbeatMetadata({
      snapshot: snap,
      prior: {
        lastAttemptedAt: null,
        lastSuccessfulValidationAt: null,
        consecutiveValidationFailures: 0,
        previousCredentialFingerprint: "fp0",
      },
    });
    assert.equal(credentialHealthHeartbeatSource("facebook"), "meta_credential_health:facebook");
    assert.equal(meta.validity, "valid");
    assert.equal(meta.consecutive_validation_failures, 0);
    assert.equal(meta.credential_replaced, true);
    assert.equal(JSON.stringify(meta).includes("fp0"), true);
    assert.equal("credential_fingerprint" in meta.evidence, false);
  });

  it("key rotation changes fingerprint for same token", () => {
    const t = "stable-token-value";
    setCredentialFingerprintKeyForTests("rotation-test-fingerprint-key-alpha-01!!");
    const first = fingerprintMetaAccessToken("instagram", t);
    setCredentialFingerprintKeyForTests("rotation-test-fingerprint-key-beta--02!!");
    const second = fingerprintMetaAccessToken("instagram", t);
    assert.ok(first && second);
    assert.notEqual(first, second);
  });

  it("secret sanitization in evidence", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: {
        data: {
          is_valid: true,
          expires_at: 0,
          scopes: ["pages_manage_posts"],
        },
      },
    });
    const classification = classifyCredentialHealth(attempt);
    const evidence = buildCredentialHealthEvidence(attempt, classification);
    const json = JSON.stringify(evidence);
    assert.doesNotMatch(json, /EAA[A-Za-z0-9]{10,}/);
    assert.doesNotMatch(json, /fingerprint/i);
    assert.doesNotMatch(json, /b3a-test-fingerprint-key/);
    const poisoned = sanitizeEvidence({
      ...evidence,
      sneaky: "access_token=EAAbadtokenvalue",
    }) as Record<string, unknown>;
    assert.equal(String(poisoned.sneaky), "[REDACTED]");
  });

  it("snapshot incident evidence excludes fingerprint", () => {
    const attempt = credentialAttemptFromInstagramGraphMe({
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: { user_id: "1" },
    });
    const fp = fingerprintMetaAccessToken("instagram", "secret-token-value");
    const evidence = snapshotIncidentEvidence({
      attempt,
      credentialFingerprint: fp,
      lastSuccessfulValidationAt: null,
    });
    assert.equal("credential_fingerprint" in evidence, false);
    assert.equal(JSON.stringify(evidence).includes("secret-token"), false);
  });

  it("buildCredentialHealthSnapshot tracks last successful validation", () => {
    const attempt = credentialAttemptFromMetaDebugToken({
      platform: "facebook",
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 200,
      body: {
        data: {
          is_valid: true,
          expires_at: Math.floor(Date.parse(IN_30_DAYS) / 1000),
          scopes: ["pages_manage_posts"],
        },
      },
    });
    const snap = buildCredentialHealthSnapshot({
      attempt,
      credentialFingerprint: "fp",
      lastSuccessfulValidationAt: null,
      referenceNowIso: NOW,
    });
    assert.equal(snap.lastSuccessfulValidationAt, NOW);
    assert.equal(snap.credentialFingerprint, "fp");
  });

  it("Instagram auth error from /me is expired not unknown_expiration", () => {
    const attempt = credentialAttemptFromInstagramGraphMe({
      attemptedAt: NOW,
      credentialsConfigured: true,
      httpStatus: 400,
      body: { error: { code: 190, message: "Invalid OAuth access token" } },
      metaErrorCode: 190,
    });
    const c = classifyCredentialHealth(attempt);
    assert.equal(c.healthState, "expired");
  });

  it("no publication or notification imports in foundation module", async () => {
    const fs = await import("node:fs");
    const paths = [
      "classify.ts",
      "snapshot.ts",
      "fingerprint.ts",
    ].map((f) => new URL(`./${f}`, import.meta.url));
    for (const url of paths) {
      const text = fs.readFileSync(url, "utf8");
      assert.doesNotMatch(text, /observePublicationFailureOutcomes/);
      assert.doesNotMatch(text, /notifyReliabilityPayload/);
      assert.doesNotMatch(text, /updatePublication/);
    }
  });
});
