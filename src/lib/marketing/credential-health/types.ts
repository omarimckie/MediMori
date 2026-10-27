/** Meta platforms covered by Phase III-B3 credential health. */
export type MetaCredentialPlatform = "facebook" | "instagram";

export const CREDENTIAL_HEALTH_STATES = [
  "healthy",
  "expiring_soon",
  "expired",
  "revoked_or_invalid",
  "unknown_expiration",
  "validation_unavailable",
] as const;

export type CredentialHealthState = (typeof CREDENTIAL_HEALTH_STATES)[number];

export type CredentialValidity = "valid" | "invalid" | "unknown";

/**
 * Separates owner-facing health_state from how expiration was determined.
 * Unknown expiration must not be conflated with provider-reported non-expiring tokens.
 */
export type ExpirationKnowledge =
  | "known"
  | "unknown"
  | "provider_non_expiring";

export type PermissionCheckResult =
  | "sufficient"
  | "insufficient"
  | "unknown"
  | "not_checked";

export type EvidenceConfidence = "high" | "medium" | "low";

/**
 * Read-only validation methods (no publishing). Enabled only when provider
 * compatibility is established — see `provider-methods.ts`.
 */
export type CredentialValidationMethod =
  | "meta_debug_token"
  | "instagram_graph_me"
  | "unsupported"
  | "not_attempted";

export type CredentialMonitoringAvailability =
  | "available"
  | "unavailable"
  | "not_configured";

export type CredentialValidationAttempt = {
  platform: MetaCredentialPlatform;
  method: CredentialValidationMethod;
  /** ISO-8601 instant of this validation attempt. */
  attemptedAt: string;
  monitoringAvailability: CredentialMonitoringAvailability;
  /** Present when credentials are absent from configuration. */
  credentialsConfigured: boolean;
  httpStatus?: number;
  metaErrorCode?: number;
  metaErrorSubcode?: number;
  /** From introspection when available; never inferred from unknown expiry. */
  tokenReportedValid?: boolean;
  /** Verified expiration from provider metadata (ISO), if any. */
  knownExpiresAtIso?: string | null;
  /** True when provider reports non-expiring token (e.g. expires_at = 0). */
  nonExpiringTokenReported?: boolean;
  scopes?: string[];
  permissionCheck: PermissionCheckResult;
  errorClass?: string;
  transientFailure?: boolean;
  unsupportedMethod?: boolean;
};

export type CredentialHealthClassification = {
  healthState: CredentialHealthState;
  validity: CredentialValidity;
  expirationKnowledge: ExpirationKnowledge;
  permissionCheck: PermissionCheckResult;
  confidence: EvidenceConfidence;
  errorClass: string | null;
  knownExpiresAtIso: string | null;
  /** Provider reported non-expiring (e.g. expires_at=0); does not imply revocation immunity. */
  nonExpiringTokenReported: boolean;
};

export type CredentialHealthSnapshot = {
  platform: MetaCredentialPlatform;
  classification: CredentialHealthClassification;
  attemptedAt: string;
  lastSuccessfulValidationAt: string | null;
  validationMethod: CredentialValidationMethod;
  monitoringAvailability: CredentialMonitoringAvailability;
  /** Omitted from incident evidence — server-side only. */
  credentialFingerprint: string | null;
};

/** Prior observation fields for durable heartbeat metadata (B3-B); no raw tokens. */
export type CredentialHealthObservationPrior = {
  lastAttemptedAt: string | null;
  lastSuccessfulValidationAt: string | null;
  consecutiveValidationFailures: number;
  /** HMAC fingerprint only — server-side durable store, not incident evidence. */
  previousCredentialFingerprint: string | null;
};
