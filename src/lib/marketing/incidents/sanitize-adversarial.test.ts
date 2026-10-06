import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_EVIDENCE_ARRAY_LENGTH,
  MAX_EVIDENCE_JSON_BYTES,
  REDACTED_PLACEHOLDER,
  sanitizeErrorMessage,
  sanitizeEvidence,
} from "./sanitize";

describe("incident sanitization adversarial", () => {
  it("redacts Authorization Bearer header forms", () => {
    const out = sanitizeErrorMessage("Authorization: Bearer abc.def.ghi");
    assert.match(out, /REDACTED/);
    assert.doesNotMatch(out, /abc\.def\.ghi/);
  });

  it("redacts lowercase authorization", () => {
    const out = sanitizeEvidence({ authorization: "Bearer secret-token" });
    assert.equal(out.authorization, REDACTED_PLACEHOLDER);
  });

  it("redacts nested headers objects", () => {
    const out = sanitizeEvidence({
      request: { headers: { Authorization: "Bearer nested" } },
    });
    const headers = out.request as Record<string, unknown>;
    const nested = headers.headers as Record<string, unknown>;
    assert.equal(nested.Authorization, REDACTED_PLACEHOLDER);
  });

  it("redacts access_token query-string-like values", () => {
    const out = sanitizeErrorMessage("failed access_token=EAABsbCS1iHgBO7ZAZDZD");
    assert.match(out, /REDACTED/);
  });

  it("redacts Meta long-lived token-like strings", () => {
    const out = sanitizeErrorMessage("EAA" + "x".repeat(40));
    assert.match(out, /REDACTED/);
  });

  it("redacts CRON_SECRET assignments", () => {
    const out = sanitizeErrorMessage("config CRON_SECRET=super-secret-value");
    assert.match(out, /REDACTED/);
  });

  it("redacts PEM-like private key material", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----";
    const out = sanitizeErrorMessage(pem);
    assert.match(out, /REDACTED/);
  });

  it("redacts cookie and session patterns in strings", () => {
    const out = sanitizeErrorMessage("Cookie: session=abc123; path=/");
    assert.match(out, /REDACTED/);
  });

  it("redacts sensitive keys regardless of capitalization", () => {
    const out = sanitizeEvidence({ API_KEY: "plain", vapidPrivateKey: "x" });
    assert.equal(out.API_KEY, REDACTED_PLACEHOLDER);
    assert.equal(out.vapidPrivateKey, REDACTED_PLACEHOLDER);
  });

  it("bounds deeply nested evidence", () => {
    const deep: Record<string, unknown> = {};
    let cursor: Record<string, unknown> = deep;
    for (let i = 0; i < 30; i += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    const out = sanitizeEvidence(deep);
    const size = new TextEncoder().encode(JSON.stringify(out)).length;
    assert.ok(size < MAX_EVIDENCE_JSON_BYTES + 500);
  });

  it("bounds very large arrays", () => {
    const out = sanitizeEvidence({ items: Array.from({ length: 500 }, (_, i) => i) });
    const items = out.items as unknown[];
    assert.ok(items.length <= MAX_EVIDENCE_ARRAY_LENGTH);
  });

  it("handles circular evidence safely", () => {
    const root: Record<string, unknown> = {};
    root.self = root;
    const out = sanitizeEvidence(root);
    assert.ok(out.self === REDACTED_PLACEHOLDER || typeof out.self === "object");
    const size = new TextEncoder().encode(JSON.stringify(out)).length;
    assert.ok(size < MAX_EVIDENCE_JSON_BYTES + 200);
  });
});
