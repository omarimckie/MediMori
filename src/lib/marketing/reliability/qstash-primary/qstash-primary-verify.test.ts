import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { SignJWT } from "jose";
import { SignatureError } from "@upstash/qstash";
import {
  readUntrustedUpstashMessageId,
  readUpstashSignatureHeader,
  verifyQstashDeliveryAndExtractJti,
} from "./verify";
import { createTestUpstashSignature, TEST_WEBHOOK_URL } from "./test-fixtures";

const currentKey = "test-current-signing-key";
const nextKey = "test-next-signing-key";
const keys = {
  currentSigningKey: currentKey,
  nextSigningKey: nextKey,
  webhookUrl: TEST_WEBHOOK_URL,
};

async function createSignedJwtWithJtiClaim(input: {
  url: string;
  body: string;
  signingKey: string;
  jti?: unknown;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: "Upstash",
    sub: input.url,
    exp: now + 300,
    nbf: now,
    iat: now,
    body: createHash("sha256").update(input.body).digest("base64url"),
  };
  if (input.jti !== undefined) {
    payload.jti = input.jti;
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(new Uint8Array(Buffer.from(input.signingKey, "utf8")));
}

describe("qstash primary verify", () => {
  it("accepts valid signature with current signing key", async () => {
    const body = "{}";
    const { signature, jti } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
    });
    const result = await verifyQstashDeliveryAndExtractJti(
      { signature, rawBody: body },
      { keys },
    );
    assert.equal(result.jti, jti);
  });

  it("accepts valid signature with next signing key", async () => {
    const body = '{"hello":"world"}';
    const { signature, jti } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: nextKey,
    });
    const result = await verifyQstashDeliveryAndExtractJti(
      { signature, rawBody: body },
      { keys },
    );
    assert.equal(result.jti, jti);
  });

  it("rejects invalid signature", async () => {
    const body = "{}";
    await assert.rejects(
      () =>
        verifyQstashDeliveryAndExtractJti(
          { signature: "not-a-jwt", rawBody: body },
          { keys },
        ),
      SignatureError,
    );
  });

  it("rejects tampered body", async () => {
    const body = "{}";
    const { signature } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
    });
    await assert.rejects(
      () =>
        verifyQstashDeliveryAndExtractJti(
          { signature, rawBody: '{"tampered":true}' },
          { keys },
        ),
      (error: unknown) =>
        error instanceof SignatureError &&
        String((error as Error).message).includes("body hash"),
    );
  });

  it("rejects destination url mismatch", async () => {
    const body = "{}";
    const { signature } = await createTestUpstashSignature({
      url: "https://evil.example/api/cron/marketing-publish",
      body,
      signingKey: currentKey,
    });
    await assert.rejects(
      () =>
        verifyQstashDeliveryAndExtractJti({ signature, rawBody: body }, { keys }),
      (error: unknown) =>
        error instanceof SignatureError &&
        String((error as Error).message).includes("invalid subject"),
    );
  });

  it("rejects expired signature", async () => {
    const body = "{}";
    const { signature } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
      expiresInSeconds: -60,
    });
    await assert.rejects(
      () =>
        verifyQstashDeliveryAndExtractJti({ signature, rawBody: body }, { keys }),
      SignatureError,
    );
  });

  it("rejects future nbf without clock tolerance", async () => {
    const body = "{}";
    const { signature } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
      notBeforeOffsetSeconds: 120,
    });
    await assert.rejects(
      () =>
        verifyQstashDeliveryAndExtractJti({ signature, rawBody: body }, { keys }),
      SignatureError,
    );
  });

  it("extracts jti independent of untrusted message-id header", async () => {
    const body = "{}";
    const { signature, jti } = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
      jti: "jwt_fixed_identity",
    });
    const headers = new Headers({
      "upstash-signature": signature,
      "upstash-message-id": "forged-message-id",
    });
    assert.equal(readUpstashSignatureHeader(headers), signature);
    assert.equal(readUntrustedUpstashMessageId(headers), "forged-message-id");
    const verified = await verifyQstashDeliveryAndExtractJti(
      { signature, rawBody: body },
      { keys },
    );
    assert.equal(verified.jti, "jwt_fixed_identity");
    assert.notEqual(verified.jti, "forged-message-id");
  });

  it("rejects validly signed jwt with missing jti", async () => {
    const body = "{}";
    const signature = await createSignedJwtWithJtiClaim({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
    });
    await assert.rejects(
      () => verifyQstashDeliveryAndExtractJti({ signature, rawBody: body }, { keys }),
      (error: unknown) =>
        error instanceof SignatureError &&
        String((error as Error).message) === "qstash_verified_jti_missing",
    );
  });

  it("rejects validly signed jwt with whitespace-only jti", async () => {
    const body = "{}";
    const signature = await createSignedJwtWithJtiClaim({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
      jti: "   ",
    });
    await assert.rejects(
      () => verifyQstashDeliveryAndExtractJti({ signature, rawBody: body }, { keys }),
      (error: unknown) =>
        error instanceof SignatureError &&
        String((error as Error).message) === "qstash_verified_jti_missing",
    );
  });

  it("rejects validly signed jwt with non-string jti", async () => {
    const body = "{}";
    const signature = await createSignedJwtWithJtiClaim({
      url: TEST_WEBHOOK_URL,
      body,
      signingKey: currentKey,
      jti: 12345,
    });
    await assert.rejects(
      () => verifyQstashDeliveryAndExtractJti({ signature, rawBody: body }, { keys }),
      (error: unknown) =>
        error instanceof SignatureError &&
        String((error as Error).message) === "qstash_verified_jti_missing",
    );
  });

  it("distinct bodies with distinct jti both verify", async () => {
    const bodyA = "{}";
    const bodyB = '{"other":true}';
    const a = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body: bodyA,
      signingKey: currentKey,
    });
    const b = await createTestUpstashSignature({
      url: TEST_WEBHOOK_URL,
      body: bodyB,
      signingKey: currentKey,
    });
    assert.notEqual(a.jti, b.jti);
    await verifyQstashDeliveryAndExtractJti(
      { signature: a.signature, rawBody: bodyA },
      { keys },
    );
    await verifyQstashDeliveryAndExtractJti(
      { signature: b.signature, rawBody: bodyB },
      { keys },
    );
  });
});
