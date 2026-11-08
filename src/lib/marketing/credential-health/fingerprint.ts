import { createHmac, timingSafeEqual } from "node:crypto";
import { hasMarketingBlobCredentials } from "../marketing-blob";
import { getPinterestCredentials } from "../pinterest";
import { readOpenAiApiKey } from "./openai-probe";
import { readResendApiKey } from "./probes/resend-probe";
import { readStripeSecretKey } from "./probes/stripe-probe";
import type { IntegrationCredentialPlatform } from "./integration-platforms";
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
function hmacFingerprint(message: string, env: Record<string, string | undefined> = process.env): string | null {
  const key = getCredentialFingerprintKey(env);
  if (!key || !validateCredentialFingerprintKey(key).ok) {
    return null;
  }
  return createHmac(FINGERPRINT_ALG, key).update(message, "utf8").digest("base64url");
}

/** Host + database name only — never password or user. */
export function databaseUrlHostIdentity(
  connectionString: string,
): string | null {
  try {
    const normalized = connectionString.replace(/^postgres:\/\//i, "postgresql://");
    const parsed = new URL(normalized);
    const db = parsed.pathname.replace(/^\//, "") || "postgres";
    return `${parsed.hostname}:${db}`;
  } catch {
    return null;
  }
}

export function fingerprintIntegrationCredential(
  platform: IntegrationCredentialPlatform,
  env: Record<string, string | undefined> = process.env,
): string | null {
  let material: string | null = null;
  if (platform === "stripe") {
    material = readStripeSecretKey(env);
  } else if (platform === "resend") {
    material = readResendApiKey(env);
  } else if (platform === "vercel_blob") {
    const token = env.BLOB_READ_WRITE_TOKEN?.trim();
    const oidc = env.VERCEL_OIDC_TOKEN?.trim();
    const store = env.BLOB_STORE_ID?.trim();
    if (token) material = `token:${token}`;
    else if (oidc && store) material = `oidc:${store}:${oidc}`;
  } else if (platform === "neon_postgres") {
    const url = env.DATABASE_URL?.trim();
    material = url ? `neon:${databaseUrlHostIdentity(url) ?? "unknown-host"}` : null;
  } else if (platform === "pinterest") {
    const creds = getPinterestCredentials(env);
    material = creds
      ? `pinterest:${creds.clientId}:${creds.refreshToken}`
      : null;
  }
  if (!material) return null;
  return hmacFingerprint(`${FINGERPRINT_VERSION}:${platform}:${material}`, env);
}

export function fingerprintOpenAiApiKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const apiKey = readOpenAiApiKey(env);
  if (!apiKey) {
    return null;
  }
  const key = getCredentialFingerprintKey(env);
  if (!key || !validateCredentialFingerprintKey(key).ok) {
    return null;
  }
  const message = `${FINGERPRINT_VERSION}:openai:${apiKey}`;
  return createHmac(FINGERPRINT_ALG, key).update(message, "utf8").digest("base64url");
}

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
