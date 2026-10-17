import { Receiver, SignatureError } from "@upstash/qstash";
import * as jose from "jose";
import type { QstashSigningKeyConfig } from "./config";
import type { QstashVerifiedDeliveryIdentity, QstashVerifiedDeliveryInput } from "./types";

export { SignatureError };

export type VerifyQstashDeliveryOptions = {
  keys: QstashSigningKeyConfig;
  clockTolerance?: number;
};

/**
 * Verifies a QStash delivery with the official SDK, then reads JWT `jti` only
 * after cryptographic verification succeeds (second jwtVerify pass with signing keys).
 */
export async function verifyQstashDeliveryAndExtractJti(
  input: QstashVerifiedDeliveryInput,
  options: VerifyQstashDeliveryOptions,
): Promise<QstashVerifiedDeliveryIdentity> {
  const { keys, clockTolerance = 0 } = options;
  const receiver = new Receiver({
    currentSigningKey: keys.currentSigningKey,
    nextSigningKey: keys.nextSigningKey,
    devMode: false,
  });

  await receiver.verify({
    signature: input.signature,
    body: input.rawBody,
    url: keys.webhookUrl,
    clockTolerance,
  });

  const jti = await readAuthenticatedJtiAfterVerify({
    signature: input.signature,
    currentSigningKey: keys.currentSigningKey,
    nextSigningKey: keys.nextSigningKey,
    clockTolerance,
  });

  return { jti };
}

async function readAuthenticatedJtiAfterVerify(input: {
  signature: string;
  currentSigningKey: string;
  nextSigningKey: string;
  clockTolerance: number;
}): Promise<string> {
  let payload: jose.JWTPayload;
  try {
    payload = await verifyJwtWithKey(input.signature, input.currentSigningKey, input.clockTolerance);
  } catch {
    payload = await verifyJwtWithKey(input.signature, input.nextSigningKey, input.clockTolerance);
  }

  const jti = payload.jti;
  if (typeof jti !== "string" || jti.trim().length === 0) {
    throw new SignatureError("qstash_verified_jti_missing");
  }
  return jti;
}

async function verifyJwtWithKey(
  signature: string,
  key: string,
  clockTolerance: number,
): Promise<jose.JWTPayload> {
  const verified = await jose.jwtVerify(signature, new TextEncoder().encode(key), {
    issuer: "Upstash",
    clockTolerance,
  });
  return verified.payload;
}

export function readUpstashSignatureHeader(headers: Headers): string | null {
  const signature = headers.get("upstash-signature")?.trim();
  return signature ? signature : null;
}

/**
 * Optional diagnostic header — never used for authorization or replay eligibility.
 */
export function readUntrustedUpstashMessageId(headers: Headers): string | null {
  const messageId = headers.get("upstash-message-id")?.trim();
  return messageId ? messageId : null;
}
