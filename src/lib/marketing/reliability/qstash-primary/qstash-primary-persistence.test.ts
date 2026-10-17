import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFakeQstashPrimaryPgStore,
  recordOnFakeStore,
} from "./fake-pg-store";
import { loadVerifiedPrimaryLastSeenAt } from "./persistence";
import { createFakeQstashPrimaryPoolClient } from "./fake-pg-store";

describe("qstash primary persistence", () => {
  it("advances primary on first verified jti", async () => {
    const store = createFakeQstashPrimaryPgStore();
    const result = await recordOnFakeStore(store, { jti: "jwt_first" });
    assert.equal(result.outcome, "advanced");
    assert.equal(store.deliveries.size, 1);
    const lastSeen = await loadVerifiedPrimaryLastSeenAt(
      createFakeQstashPrimaryPoolClient(store),
    );
    assert.ok(lastSeen);
  });

  it("does not advance primary on duplicate jti", async () => {
    const store = createFakeQstashPrimaryPgStore();
    const first = await recordOnFakeStore(store, { jti: "jwt_dup" });
    const second = await recordOnFakeStore(store, {
      jti: "jwt_dup",
      untrustedMessageId: "different-header-id",
    });
    assert.equal(first.outcome, "advanced");
    assert.equal(second.outcome, "duplicate_jti");
    assert.equal(store.deliveries.size, 1);
    assert.equal(store.deliveries.get("jwt_dup")?.untrusted_message_id, null);
  });

  it("stores untrusted message id only on first insert", async () => {
    const store = createFakeQstashPrimaryPgStore();
    await recordOnFakeStore(store, {
      jti: "jwt_meta",
      untrustedMessageId: "msg-ops-1",
    });
    assert.equal(store.deliveries.get("jwt_meta")?.untrusted_message_id, "msg-ops-1");
  });

  it("allows distinct jti with identical untrusted message id strings", async () => {
    const store = createFakeQstashPrimaryPgStore();
    const a = await recordOnFakeStore(store, {
      jti: "jwt_a",
      untrustedMessageId: "same-header",
    });
    const b = await recordOnFakeStore(store, {
      jti: "jwt_b",
      untrustedMessageId: "same-header",
    });
    assert.equal(a.outcome, "advanced");
    assert.equal(b.outcome, "advanced");
    assert.equal(store.deliveries.size, 2);
  });

  it("handles concurrent duplicate jti without double advance", async () => {
    const store = createFakeQstashPrimaryPgStore();
    const results = await Promise.all([
      recordOnFakeStore(store, { jti: "jwt_race" }),
      recordOnFakeStore(store, { jti: "jwt_race" }),
    ]);
    const advanced = results.filter((row) => row.outcome === "advanced");
    const duplicate = results.filter((row) => row.outcome === "duplicate_jti");
    assert.equal(advanced.length, 1);
    assert.equal(duplicate.length, 1);
    assert.equal(store.deliveries.size, 1);
  });

  it("keeps primary last_seen_at monotonic across distinct jti", async () => {
    const store = createFakeQstashPrimaryPgStore();
    const first = await recordOnFakeStore(store, { jti: "jwt_1" });
    const second = await recordOnFakeStore(store, { jti: "jwt_2" });
    assert.equal(first.outcome, "advanced");
    assert.equal(second.outcome, "advanced");
    const lastSeen = await loadVerifiedPrimaryLastSeenAt(
      createFakeQstashPrimaryPoolClient(store),
    );
    assert.ok(lastSeen);
    assert.ok(Date.parse(second.lastSeenAt) >= Date.parse(first.lastSeenAt));
  });
});
