import { createHmac, timingSafeEqual } from "node:crypto";
import {
  isMarketingPrivateResourceFilePathname,
  isMarketingPublicResourcePreviewPathname,
} from "./marketing-blob";

/** Interactive admin upload window (preview + file + metadata). */
export const RESOURCE_UPLOAD_INTENT_TTL_MS = 30 * 60 * 1000;

export type ResourceUploadIntentPayload = {
  v: 1;
  username: string;
  previewPathname: string;
  filePathname: string;
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

function encodeIntentPayload(payload: ResourceUploadIntentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeIntentPayload(segment: string): ResourceUploadIntentPayload {
  const raw = Buffer.from(segment, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as ResourceUploadIntentPayload;
  if (parsed.v !== 1) {
    throw new Error("Invalid upload intent version.");
  }
  if (
    typeof parsed.username !== "string" ||
    typeof parsed.previewPathname !== "string" ||
    typeof parsed.filePathname !== "string" ||
    typeof parsed.iat !== "number" ||
    typeof parsed.exp !== "number"
  ) {
    throw new Error("Invalid upload intent payload.");
  }
  return parsed;
}

export function issueResourceUploadIntent(input: {
  username: string;
  previewPathname: string;
  filePathname: string;
}): { uploadIntent: string; expiresAt: number } {
  if (!isMarketingPublicResourcePreviewPathname(input.previewPathname)) {
    throw new Error("Invalid preview pathname.");
  }
  if (!isMarketingPrivateResourceFilePathname(input.filePathname)) {
    throw new Error("Invalid file pathname.");
  }
  const iat = Date.now();
  const exp = iat + RESOURCE_UPLOAD_INTENT_TTL_MS;
  const payload: ResourceUploadIntentPayload = {
    v: 1,
    username: normalizeUsername(input.username),
    previewPathname: input.previewPathname,
    filePathname: input.filePathname,
    iat,
    exp,
  };
  const payloadSegment = encodeIntentPayload(payload);
  const uploadIntent = `${payloadSegment}.${signPayloadSegment(payloadSegment)}`;
  return { uploadIntent, expiresAt: exp };
}

export function parseResourceUploadIntent(uploadIntent: string): ResourceUploadIntentPayload {
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

function assertActorMatchesIntent(actorUsername: string | null, payload: ResourceUploadIntentPayload): void {
  if (!actorUsername) {
    throw new Error("Unauthorized.");
  }
  if (normalizeUsername(actorUsername) !== payload.username) {
    throw new Error("Upload intent does not match the current admin session.");
  }
}

export function verifyResourceUploadIntentForBlobToken(
  uploadIntent: string,
  actorUsername: string | null,
  pathname: string,
  role: "preview" | "file",
): ResourceUploadIntentPayload {
  const payload = parseResourceUploadIntent(uploadIntent);
  assertActorMatchesIntent(actorUsername, payload);
  const expectedPath = role === "preview" ? payload.previewPathname : payload.filePathname;
  if (pathname !== expectedPath) {
    throw new Error("Upload pathname does not match upload intent.");
  }
  return payload;
}

export function verifyResourceUploadIntentForRegistration(
  uploadIntent: string,
  actorUsername: string | null,
  previewPathname: string,
  filePathname: string,
): ResourceUploadIntentPayload {
  const payload = parseResourceUploadIntent(uploadIntent);
  assertActorMatchesIntent(actorUsername, payload);
  if (previewPathname !== payload.previewPathname) {
    throw new Error("Preview pathname does not match upload intent.");
  }
  if (filePathname !== payload.filePathname) {
    throw new Error("File pathname does not match upload intent.");
  }
  return payload;
}

export function verifyResourceUploadIntentForCleanup(
  uploadIntent: string,
  actorUsername: string | null,
): { previewPathname: string; filePathname: string } {
  const payload = parseResourceUploadIntent(uploadIntent);
  assertActorMatchesIntent(actorUsername, payload);
  return {
    previewPathname: payload.previewPathname,
    filePathname: payload.filePathname,
  };
}
