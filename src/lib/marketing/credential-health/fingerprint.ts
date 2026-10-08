import { createHmac, timingSafeEqual } from "node:crypto";
import type { MetaCredentialPlatform } from "./types";

/**
 * Dedicated keyed fingerprint secret (do not reuse access tokens or log this value).
 * Set in production only after owner-approved deployment.
 */
export const CREDENTIAL_FINGERPRINT_KEY_ENV = "MARKETING_CREDENTIAL_FINGERPRINT_KEY";

const FINGERPRINT_ALG = "sha256";
const FINGERPRINT_VERSION = "v1";

/** Minimum recommended key material length (characters) for production. */
export const CREDENTIAL_FINGERPRINT_MIN_KEY_LENGTH = 32;

let fingerprintKeyOverride: string | null | undefined;

export function setCredentialFingerprintKeyForTests(key: string | null): void {
  fingerprintKeyOverride = key;
}

export function resetCredentialFingerprintKeyForTests(): void {
  fingerprintKeyOverride = undefined;
}

export function validateCredentialFingerprintKey(
  raw: string | undefined | null,
): { ok: true } | { ok: false; reason: string } {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return { ok: false, reason: "MARKETING_CREDENTIAL_FINGERPRINT_KEY is unset" };
  }
  if (trimmed.length < CREDENTIAL_FINGERPRINT_MIN_KEY_LENGTH) {
    return {
      ok: false,
      reason: `key must be at least ${CREDENTIAL_FINGERPRINT_MIN_KEY_LENGTH} characters`,
    };
  }
  return { ok: true };
}

export function getCredentialFingerprintKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (fingerprintKeyOverride !== undefined) {
    return fingerprintKeyOverride;
  }
  const raw = env[CREDENTIAL_FINGERPRINT_KEY_ENV]?.trim();
  return raw || null;
}

/**
 * Keyed fingerprint for token replacement detection. Returns null when the
 * fingerprint key is unset (safe degradation — no throw, no log).
 *
 * Key rotation: changing `MARKETING_CREDENTIAL_FINGERPRINT_KEY` changes all
 * fingerprints; treat as a monitoring re-baseline, not as token rotation.
 */
export function fingerprintMetaAccessToken(
  platform: MetaCredentialPlatform,
  accessToken: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const key = getCredentialFingerprintKey(env);
  if (!key || !accessToken.trim()) {
    return null;
  }
  if (!validateCredentialFingerprintKey(key).ok) {
    return null;
  }
  const message = `${FINGERPRINT_VERSION}:${platform}:${accessToken}`;
  return createHmac(FINGERPRINT_ALG, key).update(message, "utf8").digest("base64url");
}

export function credentialFingerprintChanged(
  previous: string | null,
  current: string | null,
): boolean {
  if (previous == null || current == null) {
    return false;
  }
  if (previous.length !== current.length) {
    return true;
  }
  try {
    return !timingSafeEqual(Buffer.from(previous), Buffer.from(current));
  } catch {
    return previous !== current;
  }
}
