import { createHmac, timingSafeEqual } from "node:crypto";
import { isMarketingPublicResourcePreviewPathname } from "./marketing-blob";

export const SMART_UPLOAD_INTENT_TTL_MS = 30 * 60 * 1000;

export type SmartUploadIntentPayload = {
  v: 2;
  kind: "smart_upload";
  username: string;
  pathname: string;
  iat: number;
  exp: number;
};

function getSigningSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not configured.");
  }
  return secret;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function signPayloadSegment(payloadSegment: string): string {
  return createHmac("sha256", getSigningSecret()).update(payloadSegment).digest("base64url");
}

function encodeIntentPayload(payload: SmartUploadIntentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeIntentPayload(segment: string): SmartUploadIntentPayload {
  const raw = Buffer.from(segment, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as SmartUploadIntentPayload;
  if (parsed.v !== 2 || parsed.kind !== "smart_upload") {
    throw new Error("Invalid upload intent version.");
  }
  if (
    typeof parsed.username !== "string" ||
    typeof parsed.pathname !== "string" ||
    typeof parsed.iat !== "number" ||
    typeof parsed.exp !== "number"
  ) {
    throw new Error("Invalid upload intent payload.");
  }
  return parsed;
}

export function issueSmartUploadIntent(input: {
  username: string;
  pathname: string;
}): { uploadIntent: string; expiresAt: number } {
  if (!isMarketingPublicResourcePreviewPathname(input.pathname)) {
    throw new Error("Invalid smart upload pathname.");
  }
  const iat = Date.now();
  const exp = iat + SMART_UPLOAD_INTENT_TTL_MS;
  const payload: SmartUploadIntentPayload = {
    v: 2,
    kind: "smart_upload",
    username: normalizeUsername(input.username),
    pathname: input.pathname,
    iat,
    exp,
  };
  const payloadSegment = encodeIntentPayload(payload);
  const uploadIntent = `${payloadSegment}.${signPayloadSegment(payloadSegment)}`;
  return { uploadIntent, expiresAt: exp };
}

export function parseSmartUploadIntent(uploadIntent: string): SmartUploadIntentPayload {
  const trimmed = uploadIntent.trim();
  const [payloadSegment, signature] = trimmed.split(".");
  if (!payloadSegment || !signature) {
    throw new Error("Invalid upload intent.");
  }
  const expected = signPayloadSegment(payloadSegment);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid upload intent signature.");
  }
  const payload = decodeIntentPayload(payloadSegment);
  if (payload.exp <= Date.now()) {
    throw new Error("Upload intent expired.");
  }
  return payload;
}

export function verifySmartUploadIntentForPathname(
  uploadIntent: string,
  actorUsername: string | null,
  pathname: string,
): SmartUploadIntentPayload {
  const payload = parseSmartUploadIntent(uploadIntent);
  if (!actorUsername) {
    throw new Error("Unauthorized.");
  }
  if (normalizeUsername(actorUsername) !== payload.username) {
    throw new Error("Upload intent does not match the current admin session.");
  }
  if (pathname !== payload.pathname) {
    throw new Error("Upload pathname does not match upload intent.");
  }
  if (!isMarketingPublicResourcePreviewPathname(pathname)) {
    throw new Error("Invalid smart upload pathname.");
  }
  return payload;
}
