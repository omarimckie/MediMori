import { credentialFingerprintChanged } from "./fingerprint";
import {
  buildCredentialHealthHeartbeatMetadata,
  type CredentialHealthHeartbeatMetadata,
} from "./observation-persistence";
import type { StoredCredentialHealthState } from "./heartbeat-store";
import {
  isSuccessfulValidationState,
  isTransientValidationUnavailable,
  type CredentialProbeKind,
} from "./policy";
import { buildCredentialHealthSnapshot } from "./snapshot";
import type { CredentialHealthObservationPrior, CredentialHealthSnapshot } from "./types";

export function priorFromStored(
  stored: StoredCredentialHealthState | null,
): CredentialHealthObservationPrior {
  return {
    lastAttemptedAt: stored?.last_validation_attempt_at ?? null,
    lastSuccessfulValidationAt: stored?.last_successful_validation_at ?? null,
    consecutiveValidationFailures: stored?.consecutive_validation_failures ?? 0,
    previousCredentialFingerprint: stored?.credential_fingerprint ?? null,
  };
}

export function utcDayKey(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

export type MergeCredentialHealthStateInput = {
  snapshot: CredentialHealthSnapshot;
  previous: StoredCredentialHealthState | null;
  probeKind: CredentialProbeKind;
  fingerprintKeyEpoch: string;
  proactiveDailyDay: string | null;
};

export function mergeCredentialHealthState(
  input: MergeCredentialHealthStateInput,
): StoredCredentialHealthState {
  const { snapshot, previous, probeKind, fingerprintKeyEpoch } = input;
  const c = snapshot.classification;
  const epochRotated =
    previous != null && previous.fingerprint_key_epoch !== fingerprintKeyEpoch;

  let priorFingerprint = previous?.credential_fingerprint ?? null;
  if (epochRotated) {
    priorFingerprint = null;
  }

  const prior = priorFromStored(
    epochRotated
      ? previous
        ? {
            ...previous,
            credential_fingerprint: null,
            previous_credential_fingerprint: null,
          }
        : null
      : previous,
  );

  const base = buildCredentialHealthHeartbeatMetadata({ snapshot, prior });

  let consecutiveDailyUnavailable = previous?.consecutive_validation_failures ?? 0;
  let monitoringUnavailablePushSent = previous?.monitoring_unavailable_push_sent ?? false;

  if (probeKind === "proactive_daily" && isTransientValidationUnavailable(c)) {
    consecutiveDailyUnavailable += 1;
  } else if (isSuccessfulValidationState(c.healthState) && c.validity === "valid") {
    consecutiveDailyUnavailable = 0;
    monitoringUnavailablePushSent = false;
  } else if (isConfirmedAuthClassification(c)) {
    consecutiveDailyUnavailable = previous?.consecutive_validation_failures ?? 0;
  }

  const credentialReplaced = epochRotated
    ? false
    : credentialFingerprintChanged(
        priorFingerprint,
        snapshot.credentialFingerprint,
      ) || base.credential_replaced;

  const merged: StoredCredentialHealthState = {
    ...base,
    consecutive_validation_failures: consecutiveDailyUnavailable,
    credential_replaced: credentialReplaced,
    credential_fingerprint: snapshot.credentialFingerprint,
    previous_credential_fingerprint: epochRotated
      ? null
      : priorFingerprint ?? base.previous_credential_fingerprint,
    monitoring_unavailable_push_sent: monitoringUnavailablePushSent,
    last_proactive_daily_probe_day:
      probeKind === "proactive_daily"
        ? input.proactiveDailyDay ?? utcDayKey(snapshot.attemptedAt)
        : previous?.last_proactive_daily_probe_day ?? null,
    fingerprint_key_epoch: fingerprintKeyEpoch,
    observation_sequence: previous?.observation_sequence ?? 0,
  };

  return merged;
}

function isConfirmedAuthClassification(
  c: CredentialHealthSnapshot["classification"],
): boolean {
  return (
    c.healthState === "expired" ||
    c.healthState === "revoked_or_invalid" ||
    c.permissionCheck === "insufficient" ||
    c.errorClass === "meta_credentials_missing"
  );
}

export function storedToClientSafeMetadata(
  stored: CredentialHealthHeartbeatMetadata | StoredCredentialHealthState,
): Omit<CredentialHealthHeartbeatMetadata, "credential_fingerprint" | "previous_credential_fingerprint"> {
  const { credential_fingerprint: _a, previous_credential_fingerprint: _b, ...rest } =
    stored as StoredCredentialHealthState;
  return rest;
}
