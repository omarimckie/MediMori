import { evaluatePublishingPermissionCheck } from "./permissions";
import type {
  CredentialMonitoringAvailability,
  CredentialValidationAttempt,
  MetaCredentialPlatform,
} from "./types";

function monitoringAvailability(
  credentialsConfigured: boolean,
): CredentialMonitoringAvailability {
  return credentialsConfigured ? "available" : "not_configured";
}

/** Subset of Meta `debug_token` `data` object (no secrets). */
export type MetaDebugTokenData = {
  is_valid?: boolean;
  expires_at?: number;
  data_access_expires_at?: number;
  scopes?: string[];
  type?: string;
  error?: { message?: string; code?: number; subcode?: number };
};

export type ParseDebugTokenInput = {
  platform: MetaCredentialPlatform;
  attemptedAt: string;
  credentialsConfigured: boolean;
  httpStatus: number;
  body: unknown;
  metaErrorCode?: number;
  metaErrorSubcode?: number;
  transientFailure?: boolean;
};

function unixToIso(seconds: number | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) {
    return null;
  }
  if (seconds === 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

/**
 * Pure parser for Facebook `debug_token` responses. Does not perform HTTP.
 */
export function credentialAttemptFromMetaDebugToken(
  input: ParseDebugTokenInput,
): CredentialValidationAttempt {
  const base = {
    platform: input.platform,
    method: "meta_debug_token" as const,
    attemptedAt: input.attemptedAt,
    monitoringAvailability: monitoringAvailability(input.credentialsConfigured),
    credentialsConfigured: input.credentialsConfigured,
    httpStatus: input.httpStatus,
    metaErrorCode: input.metaErrorCode,
    metaErrorSubcode: input.metaErrorSubcode,
    transientFailure: input.transientFailure,
  };

  if (!input.credentialsConfigured) {
    return {
      ...base,
      permissionCheck: "not_checked",
      errorClass: "meta_credentials_missing",
    };
  }

  if (input.transientFailure || input.httpStatus >= 500) {
    return {
      ...base,
      permissionCheck: "not_checked",
      errorClass: "meta_validation_transient",
      transientFailure: true,
    };
  }

  if (input.httpStatus === 429) {
    return {
      ...base,
      permissionCheck: "not_checked",
      errorClass: "meta_rate_limited",
      transientFailure: true,
    };
  }

  const parsed = input.body as { data?: MetaDebugTokenData };
  const data = parsed?.data;
  if (!data) {
    return {
      ...base,
      permissionCheck: "not_checked",
      errorClass: "meta_malformed_validation_response",
    };
  }

  const scopes = data.scopes ?? [];
  const permissionCheck = evaluatePublishingPermissionCheck(
    input.platform,
    scopes,
    "meta_debug_token",
  );
  const nonExpiring = data.expires_at === 0;
  const knownExpiresAtIso = nonExpiring ? null : unixToIso(data.expires_at);

  return {
    ...base,
    tokenReportedValid: data.is_valid === true,
    knownExpiresAtIso,
    nonExpiringTokenReported: nonExpiring,
    scopes,
    permissionCheck,
    errorClass: data.is_valid === false ? "meta_auth_expired" : undefined,
  };
}

export type ParseInstagramMeInput = {
  attemptedAt: string;
  credentialsConfigured: boolean;
  httpStatus: number;
  body: unknown;
  metaErrorCode?: number;
  transientFailure?: boolean;
};

/**
 * Pure parser for Instagram `GET /me` validation (read-only identity check).
 */
export function credentialAttemptFromInstagramGraphMe(
  input: ParseInstagramMeInput,
): CredentialValidationAttempt {
  const base = {
    platform: "instagram" as const,
    method: "instagram_graph_me" as const,
    attemptedAt: input.attemptedAt,
    monitoringAvailability: monitoringAvailability(input.credentialsConfigured),
    credentialsConfigured: input.credentialsConfigured,
    httpStatus: input.httpStatus,
    metaErrorCode: input.metaErrorCode,
    transientFailure: input.transientFailure,
  };

  if (!input.credentialsConfigured) {
    return {
      ...base,
      permissionCheck: "not_checked",
      errorClass: "meta_credentials_missing",
    };
  }

  if (input.transientFailure || input.httpStatus >= 500 || input.httpStatus === 429) {
    return {
      ...base,
      permissionCheck: "not_checked",
      errorClass: input.httpStatus === 429 ? "meta_rate_limited" : "meta_validation_transient",
      transientFailure: true,
    };
  }

  const row = input.body as { user_id?: string; id?: string; error?: { code?: number } };
  if (row?.error?.code === 190 || row?.error?.code === 102) {
    return {
      ...base,
      tokenReportedValid: false,
      permissionCheck: "unknown",
      errorClass: "meta_auth_expired",
    };
  }

  if (input.httpStatus >= 400) {
    return {
      ...base,
      tokenReportedValid: false,
      permissionCheck: "unknown",
      errorClass: "meta_permissions",
    };
  }

  const hasIdentity = Boolean(row?.user_id?.trim() || row?.id?.trim());
  return {
    ...base,
    tokenReportedValid: hasIdentity,
    permissionCheck: "unknown",
    knownExpiresAtIso: null,
    nonExpiringTokenReported: false,
  };
}

export function credentialAttemptFromUnsupportedMethod(
  platform: MetaCredentialPlatform,
  attemptedAt: string,
): CredentialValidationAttempt {
  return {
    platform,
    method: "unsupported",
    attemptedAt,
    monitoringAvailability: "unavailable",
    credentialsConfigured: true,
    unsupportedMethod: true,
    permissionCheck: "not_checked",
    errorClass: "meta_validation_method_unsupported",
  };
}
