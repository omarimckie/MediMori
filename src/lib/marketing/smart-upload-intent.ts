import { createHmac, timingSafeEqual } from "node:crypto";
import { isMarketingPublicResourcePreviewPathname } from "./marketing-blob";

export const SMART_UPLOAD_INTENT_TTL_MS = 30 * 60 * 1000;

export const SMART_UPLOAD_INTENT_KIND_UPLOAD = "smart_upload";
export const SMART_UPLOAD_INTENT_KIND_PREVIEW_DERIVATIVE = "smart_upload_preview_derivative";

export type SmartUploadIntentPayload = {
  v: 2;
  kind: typeof SMART_UPLOAD_INTENT_KIND_UPLOAD;
  username: string;
  pathname: string;
  iat: number;
  exp: number;
};

export type SmartUploadPreviewDerivativeIntentPayload = {
  v: 2;
  kind: typeof SMART_UPLOAD_INTENT_KIND_PREVIEW_DERIVATIVE;
  username: string;
  /** Derivative blob pathname. */
  pathname: string;
  originalPathname: string;
  finalizeKey: string;
  strategy: "pad" | "crop";
  targetRatio: "4:5" | "1:1";
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

function encodePayloadSegment(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function verifySignature(uploadIntent: string): string {
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
  return payloadSegment;
}

function assertNotExpired(exp: number): void {
  if (exp <= Date.now()) {
    throw new Error("Upload intent expired.");
  }
}

function assertActorMatches(actorUsername: string | null, payloadUsername: string): void {
  if (!actorUsername) {
    throw new Error("Unauthorized.");
  }
  if (normalizeUsername(actorUsername) !== payloadUsername) {
    throw new Error("Upload intent does not match the current admin session.");
  }
}

function assertMarketingPublicPathname(pathname: string): void {
  if (!isMarketingPublicResourcePreviewPathname(pathname)) {
    throw new Error("Invalid smart upload pathname.");
  }
}

function decodeUploadIntentPayload(segment: string): SmartUploadIntentPayload {
  const raw = Buffer.from(segment, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as SmartUploadIntentPayload;
  if (parsed.v !== 2 || parsed.kind !== SMART_UPLOAD_INTENT_KIND_UPLOAD) {
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

function decodePreviewDerivativeIntentPayload(
  segment: string,
): SmartUploadPreviewDerivativeIntentPayload {
  const raw = Buffer.from(segment, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as SmartUploadPreviewDerivativeIntentPayload;
  if (parsed.v !== 2 || parsed.kind !== SMART_UPLOAD_INTENT_KIND_PREVIEW_DERIVATIVE) {
    throw new Error("Invalid preview derivative intent.");
  }
  if (
    typeof parsed.username !== "string" ||
    typeof parsed.pathname !== "string" ||
    typeof parsed.originalPathname !== "string" ||
    typeof parsed.finalizeKey !== "string" ||
    typeof parsed.strategy !== "string" ||
    typeof parsed.targetRatio !== "string" ||
    typeof parsed.iat !== "number" ||
    typeof parsed.exp !== "number"
  ) {
    throw new Error("Invalid preview derivative intent payload.");
  }
  return parsed;
}

export function issueSmartUploadIntent(input: {
  username: string;
  pathname: string;
}): { uploadIntent: string; expiresAt: number } {
  assertMarketingPublicPathname(input.pathname);
  const iat = Date.now();
  const exp = iat + SMART_UPLOAD_INTENT_TTL_MS;
  const payload: SmartUploadIntentPayload = {
    v: 2,
    kind: SMART_UPLOAD_INTENT_KIND_UPLOAD,
    username: normalizeUsername(input.username),
    pathname: input.pathname,
    iat,
    exp,
  };
  const payloadSegment = encodePayloadSegment(payload);
  const uploadIntent = `${payloadSegment}.${signPayloadSegment(payloadSegment)}`;
  return { uploadIntent, expiresAt: exp };
}

export function issueSmartUploadPreviewDerivativeIntent(input: {
  username: string;
  pathname: string;
  originalPathname: string;
  finalizeKey: string;
  strategy: "pad" | "crop";
  targetRatio: "4:5" | "1:1";
}): { uploadIntent: string; expiresAt: number } {
  assertMarketingPublicPathname(input.pathname);
  assertMarketingPublicPathname(input.originalPathname);
  if (input.pathname === input.originalPathname) {
    throw new Error("Preview derivative pathname must differ from the original pathname.");
  }
  const trimmedKey = input.finalizeKey.trim();
  if (!trimmedKey) {
    throw new Error("finalizeKey is required for preview derivative intent.");
  }
  const iat = Date.now();
  const exp = iat + SMART_UPLOAD_INTENT_TTL_MS;
  const payload: SmartUploadPreviewDerivativeIntentPayload = {
    v: 2,
    kind: SMART_UPLOAD_INTENT_KIND_PREVIEW_DERIVATIVE,
    username: normalizeUsername(input.username),
    pathname: input.pathname,
    originalPathname: input.originalPathname,
    finalizeKey: trimmedKey,
    strategy: input.strategy,
    targetRatio: input.targetRatio,
    iat,
    exp,
  };
  const payloadSegment = encodePayloadSegment(payload);
  const uploadIntent = `${payloadSegment}.${signPayloadSegment(payloadSegment)}`;
  return { uploadIntent, expiresAt: exp };
}

export function parseSmartUploadIntent(uploadIntent: string): SmartUploadIntentPayload {
  const payloadSegment = verifySignature(uploadIntent);
  const payload = decodeUploadIntentPayload(payloadSegment);
  assertNotExpired(payload.exp);
  return payload;
}

export function parseSmartUploadPreviewDerivativeIntent(
  uploadIntent: string,
): SmartUploadPreviewDerivativeIntentPayload {
  const payloadSegment = verifySignature(uploadIntent);
  const payload = decodePreviewDerivativeIntentPayload(payloadSegment);
  assertNotExpired(payload.exp);
  return payload;
}

export function verifySmartUploadIntentForPathname(
  uploadIntent: string,
  actorUsername: string | null,
  pathname: string,
): SmartUploadIntentPayload {
  const payload = parseSmartUploadIntent(uploadIntent);
  assertActorMatches(actorUsername, payload.username);
  if (pathname !== payload.pathname) {
    throw new Error("Upload pathname does not match upload intent.");
  }
  assertMarketingPublicPathname(pathname);
  return payload;
}

export function verifySmartUploadPreviewDerivativeIntentForPathname(
  uploadIntent: string,
  actorUsername: string | null,
  pathname: string,
): SmartUploadPreviewDerivativeIntentPayload {
  const payload = parseSmartUploadPreviewDerivativeIntent(uploadIntent);
  assertActorMatches(actorUsername, payload.username);
  if (pathname !== payload.pathname) {
    throw new Error("Preview derivative pathname does not match upload intent.");
  }
  assertMarketingPublicPathname(pathname);
  return payload;
}

export function verifySmartUploadPreviewDerivativeIntentForFinalize(
  uploadIntent: string,
  actorUsername: string | null,
  input: {
    derivativePathname: string;
    originalPathname: string;
    finalizeKey: string;
    strategy: "pad" | "crop";
    targetRatio: "4:5" | "1:1";
  },
): SmartUploadPreviewDerivativeIntentPayload {
  const payload = verifySmartUploadPreviewDerivativeIntentForPathname(
    uploadIntent,
    actorUsername,
    input.derivativePathname,
  );
  if (payload.originalPathname !== input.originalPathname) {
    throw new Error("Preview derivative intent does not match the original pathname.");
  }
  if (payload.finalizeKey !== input.finalizeKey.trim()) {
    throw new Error("Preview derivative intent does not match finalizeKey.");
  }
  if (payload.strategy !== input.strategy) {
    throw new Error("Preview derivative intent does not match fix strategy.");
  }
  if (payload.targetRatio !== input.targetRatio) {
    throw new Error("Preview derivative intent does not match fix target ratio.");
  }
  return payload;
}
