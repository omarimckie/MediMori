import type { CredentialHealthEvidence } from "./evidence";
import { buildCredentialHealthEvidence } from "./evidence";
import type {
  CredentialHealthObservationPrior,
  CredentialHealthSnapshot,
  CredentialValidationAttempt,
  MetaCredentialPlatform,
} from "./types";
import { classifyCredentialHealth } from "./classify";
import { credentialFingerprintChanged } from "./fingerprint";

/**
 * Durable observation row key in `marketing_dispatcher_heartbeats` (existing table).
 * Does not write to the database in B3-A — serializer only (Decision 6 pattern).
 */
export function credentialHealthHeartbeatSource(
  platform: MetaCredentialPlatform,
): string {
  return `meta_credential_health:${platform}`;
}

export type CredentialHealthHeartbeatMetadata = {
  schema_version: 1;
  platform: MetaCredentialPlatform;
  last_validation_attempt_at: string;
  last_successful_validation_at: string | null;
  validity: string;
  expiration_knowledge: string;
  permission_check: string;
  health_state: string;
  consecutive_validation_failures: number;
  credential_replaced: boolean;
  /** HMAC fingerprint for replacement detection — server-side metadata only. */
  credential_fingerprint: string | null;
  previous_credential_fingerprint: string | null;
  evidence: CredentialHealthEvidence;
};

export type BuildHeartbeatMetadataInput = {
  snapshot: CredentialHealthSnapshot;
  prior: CredentialHealthObservationPrior;
};

/**
 * Builds JSON-safe heartbeat metadata without creating a `credential_warning` incident.
 * Healthy observations can be retained via upsert to `marketing_dispatcher_heartbeats`.
 */
export function buildCredentialHealthHeartbeatMetadata(
  input: BuildHeartbeatMetadataInput,
): CredentialHealthHeartbeatMetadata {
  const { snapshot, prior } = input;
  const c = snapshot.classification;
  const attempt: CredentialValidationAttempt = {
    platform: snapshot.platform,
    method: snapshot.validationMethod,
    attemptedAt: snapshot.attemptedAt,
    monitoringAvailability: snapshot.monitoringAvailability,
    credentialsConfigured: true,
    permissionCheck: c.permissionCheck,
    knownExpiresAtIso: c.knownExpiresAtIso,
    nonExpiringTokenReported: c.nonExpiringTokenReported,
    tokenReportedValid:
      c.validity === "valid" ? true : c.validity === "invalid" ? false : undefined,
  };
  const evidence = buildCredentialHealthEvidence(attempt, c);

  const validationFailed =
    c.validity === "invalid" ||
    c.healthState === "validation_unavailable" ||
    c.healthState === "expired" ||
    c.healthState === "revoked_or_invalid";

  const consecutiveValidationFailures = validationFailed
    ? prior.consecutiveValidationFailures + 1
    : 0;

  const credentialReplaced = credentialFingerprintChanged(
    prior.previousCredentialFingerprint,
    snapshot.credentialFingerprint,
  );

  return {
    schema_version: 1,
    platform: snapshot.platform,
    last_validation_attempt_at: snapshot.attemptedAt,
    last_successful_validation_at: snapshot.lastSuccessfulValidationAt,
    validity: c.validity,
    expiration_knowledge: c.expirationKnowledge,
    permission_check: c.permissionCheck,
    health_state: c.healthState,
    consecutive_validation_failures: consecutiveValidationFailures,
    credential_replaced: credentialReplaced,
    credential_fingerprint: snapshot.credentialFingerprint,
    previous_credential_fingerprint: prior.previousCredentialFingerprint,
    evidence,
  };
}

/** Re-classify attempt for observation-only replay (pure). */
export function classifyAttemptForObservation(
  attempt: CredentialValidationAttempt,
  referenceNowIso?: string,
) {
  return classifyCredentialHealth(attempt, { referenceNowIso });
}
