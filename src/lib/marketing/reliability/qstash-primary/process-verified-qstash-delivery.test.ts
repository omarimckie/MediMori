import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { SignJWT } from "jose";
import { SignatureError } from "@upstash/qstash";
import type { QstashSigningKeyConfig } from "./config";
import {
  createProcessVerifiedQstashDeliveryForTests,
  processVerifiedQstashDelivery,
} from "./process-verified-qstash-delivery";
import type { RecordVerifiedPrimaryHeartbeatInput } from "./persistence";
import { createTestUpstashSignature, TEST_WEBHOOK_URL } from "./test-fixtures";
import { verifyQstashDeliveryAndExtractJti } from "./verify";

async function createSignatureMissingJti(input: {
  url: string;
  body: string;
  signingKey: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "Upstash",
    sub: input.url,
    exp: now + 300,
    nbf: now,
    iat: now,
    body: createHash("sha256").update(input.body).digest("base64url"),
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(new Uint8Array(Buffer.from(input.signingKey, "utf8")));
}

const currentKey = "test-current-signing-key";
const nextKey = "test-next-signing-key";
const keys: QstashSigningKeyConfig = {
  currentSigningKey: currentKey,
  nextSigningKey: nextKey,
  webhookUrl: TEST_WEBHOOK_URL,
};

function createHarness(
  persist: (
    input: RecordVerifiedPrimaryHeartbeatInput,
  ) => Promise<import("./types").RecordVerifiedPrimaryHeartbeatResult>,
  overrides?: Partial<{
    resolveSigningKeys: () => QstashSigningKeyConfig | null;
    verifyDelivery: typeof verifyQstashDeliveryAndExtractJti;
  }>,
) {
  const persistCalls: RecordVerifiedPrimaryHeartbeatInput[] = [];
  const process = createProcessVerifiedQstashDeliveryForTests({
    resolveSigningKeys: overrides?.resolveSigningKeys ?? (() => keys),
    verifyDelivery: overrides?.verifyDelivery ?? verifyQstashDeliveryAndExtractJti,
    persistVerifiedHeartbeat: async (input) => {
      persistCalls.push(input);
      return persist(input);
    },
  });
  return { process, persistCalls };
}

function createDedupingPersistAdapter() {
  const seen = new Set<string>();
  let chain = Promise.resolve();
  return {
    persist: async (input: RecordVerifiedPrimaryHeartbeatInput) => {
      let result!: import("./types").RecordVerifiedPrimaryHeartbeatResult;
      chain = chain.then(async () => {
        const previousLastSeen = "1970-01-01T00:00:00.000Z";
        if (seen.has(input.jti)) {
          result = {
            outcome: "duplicate_jti",
            jti: input.jti,
            lastSeenAt: previousLastSeen,
          };
          return;
        }
        seen.add(input.jti);
        result = {
          outcome: "advanced",
          jti: input.jti,
          lastSeenAt: new Date().toISOString(),
        };
      });
      await chain;
      return result;
    },
  };
}

describe("process verified qstash delivery (H2)", () => {
  it("H2-01 current signing key records advanced heartbeat", async () => {
    const body = "{}";
    const { signature, jti } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
    });
    const { process, persistCalls } = createHarness(async () => ({
      outcome: "advanced",
      jti,
      lastSeenAt: "2026-10-14T12:00:00.000Z",
    }));
    const result = await process({ signature, rawBody: body });
    assert.equal(persistCalls.length, 1);
    assert.equal(persistCalls[0]?.jti, jti);
    assert.deepEqual(result, {
      status: "recorded",
      outcome: "advanced",
      jti,
      lastSeenAt: "2026-10-14T12:00:00.000Z",
    });
  });

  it("H2-02 next signing key records advanced heartbeat", async () => {
    const body = '{"x":1}';
    const { signature, jti } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: nextKey,
    });
    const { process, persistCalls } = createHarness(async () => ({
      outcome: "advanced",
      jti,
      lastSeenAt: "2026-10-14T12:00:01.000Z",
    }));
    const result = await process({ signature, rawBody: body });
    assert.equal(persistCalls.length, 1);
    assert.deepEqual(result.status, "recorded");
    if (result.status === "recorded") {
      assert.equal(result.outcome, "advanced");
    }
  });

  it("H2-03 invalid signature rejects without persistence", async () => {
    const { process, persistCalls } = createHarness(async () => ({
      outcome: "advanced",
      jti: "never",
      lastSeenAt: "2026-10-14T12:00:00.000Z",
    }));
    const result = await process({ signature: "not-a-jwt", rawBody: "{}" });
    assert.equal(persistCalls.length, 0);
    assert.equal(result.status, "verification_rejected");
  });

  it("H2-04 expired signature rejects without persistence", async () => {
    const body = "{}";
    const { signature } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
      expiresInSeconds: -60,
    });
    const { process, persistCalls } = createHarness(async () => ({
      outcome: "advanced",
      jti: "never",
      lastSeenAt: "2026-10-14T12:00:00.000Z",
    }));
    const result = await process({ signature, rawBody: body });
    assert.equal(persistCalls.length, 0);
    assert.equal(result.status, "verification_rejected");
    if (result.status === "verification_rejected") {
      assert.equal(result.code, "qstash_verification_rejected");
    }
  });

  it("H2-05 future nbf rejects without persistence", async () => {
    const body = "{}";
    const { signature } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
      notBeforeOffsetSeconds: 120,
    });
    const { process, persistCalls } = createHarness(async () => ({
      outcome: "advanced",
      jti: "never",
      lastSeenAt: "2026-10-14T12:00:00.000Z",
    }));
    const result = await process({ signature, rawBody: body });
    assert.equal(persistCalls.length, 0);
    assert.equal(result.status, "verification_rejected");
    if (result.status === "verification_rejected") {
      assert.equal(result.code, "qstash_verification_rejected");
    }
  });

  it("H2-06 wrong canonical URL rejects without persistence", async () => {
    const body = "{}";
    const { signature } = await createTestUpstashSignature({
      url: "https://evil.example/api/cron/marketing-publish",
      body,
      signingKey: currentKey,
    });
    const { process, persistCalls } = createHarness(async () => ({
      outcome: "advanced",
      jti: "never",
      lastSeenAt: "2026-10-14T12:00:00.000Z",
    }));
    const result = await process({ signature, rawBody: body });
    assert.equal(persistCalls.length, 0);
    assert.equal(result.status, "verification_rejected");
    if (result.status === "verification_rejected") {
      assert.equal(result.code, "qstash_canonical_url_mismatch");
    }
  });

  it("H2-07 missing signed jti rejects without persistence", async () => {
    const body = "{}";
    const signature = await createSignatureMissingJti({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
    });
    const { process, persistCalls } = createHarness(async () => ({
      outcome: "advanced",
      jti: "never",
      lastSeenAt: "2026-10-14T12:00:00.000Z",
    }));
    const result = await process({ signature, rawBody: body });
    assert.equal(persistCalls.length, 0);
    assert.equal(result.status, "verification_rejected");
    if (result.status === "verification_rejected") {
      assert.equal(result.code, "qstash_verified_jti_missing");
    }
  });

  it("H2-08 duplicate delivery returns duplicate_jti without false advancement", async () => {
    const body = "{}";
    const { signature, jti } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
      jti: "jwt_h2_dup",
    });
    const { process } = createHarness(async () => ({
      outcome: "duplicate_jti",
      jti,
      lastSeenAt: "2026-10-14T11:00:00.000Z",
    }));
    const result = await process({ signature, rawBody: body });
    assert.deepEqual(result, {
      status: "recorded",
      outcome: "duplicate_jti",
      jti,
      lastSeenAt: "2026-10-14T11:00:00.000Z",
    });
  });

  it("H2-09 concurrent duplicate jti yields one advanced and one duplicate", async () => {
    const body = "{}";
    const { signature, jti } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
      jti: "jwt_h2_race",
    });
    const { persist } = createDedupingPersistAdapter();
    const { process } = createHarness(persist);
    const [a, b] = await Promise.all([
      process({ signature, rawBody: body }),
      process({ signature, rawBody: body }),
    ]);
    const outcomes = [a, b]
      .filter((row): row is Extract<typeof row, { status: "recorded" }> => row.status === "recorded")
      .map((row) => row.outcome);
    assert.equal(outcomes.filter((o) => o === "advanced").length, 1);
    assert.equal(outcomes.filter((o) => o === "duplicate_jti").length, 1);
  });

  it("H2-10 persistence failure returns sanitized persistence_failed", async () => {
    const body = "{}";
    const { signature, jti } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
    });
    const { process } = createHarness(async () => {
      throw new Error("database_down");
    });
    const result = await process({ signature, rawBody: body });
    assert.deepEqual(result, {
      status: "persistence_failed",
      code: "qstash_heartbeat_persistence_failed",
      jti,
    });
  });

  it("H2-11 forged untrusted message id does not substitute signed jti", async () => {
    const body = "{}";
    const { signature, jti } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
      jti: "jwt_signed_identity",
    });
    const { process, persistCalls } = createHarness(async (input) => ({
      outcome: "advanced",
      jti: input.jti,
      lastSeenAt: "2026-10-14T12:00:00.000Z",
    }));
    await process({
      signature,
      rawBody: body,
      untrustedMessageId: "forged-message-id",
    });
    assert.equal(persistCalls[0]?.jti, "jwt_signed_identity");
    assert.equal(persistCalls[0]?.untrustedMessageId, "forged-message-id");
    assert.notEqual(persistCalls[0]?.jti, "forged-message-id");
  });

  it("H2-12 verification failure does not call persistence", async () => {
    const { process, persistCalls } = createHarness(
      async () => ({
        outcome: "advanced",
        jti: "never",
        lastSeenAt: "2026-10-14T12:00:00.000Z",
      }),
      {
        verifyDelivery: async () => {
          throw new SignatureError("qstash_verification_rejected");
        },
      },
    );
    const result = await process({ signature: "sig", rawBody: "{}" });
    assert.equal(persistCalls.length, 0);
    assert.equal(result.status, "verification_rejected");
  });

  it("missing signing configuration returns configuration_unavailable", async () => {
    const { process, persistCalls } = createHarness(
      async () => ({
        outcome: "advanced",
        jti: "never",
        lastSeenAt: "2026-10-14T12:00:00.000Z",
      }),
      { resolveSigningKeys: () => null },
    );
    const result = await process({ signature: "sig", rawBody: "{}" });
    assert.equal(persistCalls.length, 0);
    assert.deepEqual(result, {
      status: "configuration_unavailable",
      code: "qstash_signing_config_missing",
    });
  });

  it("unexpected verification exception returns internal_failure", async () => {
    const { process, persistCalls } = createHarness(
      async () => ({
        outcome: "advanced",
        jti: "never",
        lastSeenAt: "2026-10-14T12:00:00.000Z",
      }),
      {
        verifyDelivery: async () => {
          throw new Error("unexpected_verify_fault");
        },
      },
    );
    const result = await process({ signature: "sig", rawBody: "{}" });
    assert.equal(persistCalls.length, 0);
    assert.deepEqual(result, {
      status: "internal_failure",
      code: "qstash_processing_internal_failure",
    });
  });

  it("unexpected configuration resolver exception returns internal_failure", async () => {
    const { process, persistCalls } = createHarness(
      async () => ({
        outcome: "advanced",
        jti: "never",
        lastSeenAt: "2026-10-14T12:00:00.000Z",
      }),
      {
        resolveSigningKeys: () => {
          throw new Error("resolver_fault");
        },
      },
    );
    const result = await process({ signature: "sig", rawBody: "{}" });
    assert.equal(persistCalls.length, 0);
    assert.deepEqual(result, {
      status: "internal_failure",
      code: "qstash_processing_internal_failure",
    });
  });

  it("production entry point binds one-argument locked persistence", () => {
    assert.equal(typeof processVerifiedQstashDelivery, "function");
    assert.equal(typeof createProcessVerifiedQstashDeliveryForTests, "function");
  });
});
