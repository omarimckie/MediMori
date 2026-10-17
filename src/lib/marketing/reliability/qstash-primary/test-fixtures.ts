import { createHash } from "node:crypto";
import { SignJWT } from "jose";

export const TEST_WEBHOOK_URL = "https://twilight-feather.com/api/cron/marketing-publish";

export async function createTestUpstashSignature(input: {
  url: string;
  body: string;
  signingKey: string;
  jti?: string;
  expiresInSeconds?: number;
  notBeforeOffsetSeconds?: number;
}): Promise<{ signature: string; jti: string }> {
  const now = Math.floor(Date.now() / 1000);
  const jti = input.jti ?? `jwt_test_${Math.random().toString(36).slice(2, 12)}`;
  const payload = {
    iss: "Upstash",
    sub: input.url,
    exp: now + (input.expiresInSeconds ?? 300),
    nbf: now + (input.notBeforeOffsetSeconds ?? 0),
    iat: now,
    jti,
    body: createHash("sha256").update(input.body).digest("base64url"),
  };

  const signature = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(new Uint8Array(Buffer.from(input.signingKey, "utf8")));

  return { signature, jti };
}
