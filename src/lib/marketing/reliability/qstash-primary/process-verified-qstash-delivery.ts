import type { QstashSigningKeyConfig } from "./config";
import { resolveQstashSigningKeys } from "./config";
import {
  recordVerifiedPrimaryHeartbeatInLock,
  type RecordVerifiedPrimaryHeartbeatInput,
} from "./persistence";
import type {
  QstashVerifiedDeliveryInput,
  RecordVerifiedPrimaryHeartbeatResult,
} from "./types";
import { SignatureError, verifyQstashDeliveryAndExtractJti } from "./verify";

export type ProcessVerifiedQstashDeliveryInput = {
  signature: string;
  rawBody: string;
  untrustedMessageId?: string | null;
};

export type QstashVerificationRejectedCode =
  | "qstash_signature_invalid"
  | "qstash_signature_expired"
  | "qstash_signature_not_yet_valid"
  | "qstash_canonical_url_mismatch"
  | "qstash_verified_jti_missing"
  | "qstash_verification_rejected";

export type ProcessVerifiedQstashDeliveryResult =
  | {
      status: "recorded";
      outcome: "advanced" | "duplicate_jti";
      jti: string;
      lastSeenAt: string;
    }
  | {
      status: "verification_rejected";
      code: QstashVerificationRejectedCode;
    }
  | {
      status: "configuration_unavailable";
      code: "qstash_signing_config_missing";
    }
  | {
      status: "persistence_failed";
      code: "qstash_heartbeat_persistence_failed";
      jti: string;
    }
  | {
      status: "internal_failure";
      code: "qstash_processing_internal_failure";
    };

export type ProcessVerifiedQstashDeliveryDeps = {
  resolveSigningKeys: () => QstashSigningKeyConfig | null;
  verifyDelivery: (
    input: QstashVerifiedDeliveryInput,
    options: { keys: QstashSigningKeyConfig },
  ) => Promise<{ jti: string }>;
  persistVerifiedHeartbeat: (
    input: RecordVerifiedPrimaryHeartbeatInput,
  ) => Promise<RecordVerifiedPrimaryHeartbeatResult>;
};

const PERSISTENCE_FAILED_CODE = "qstash_heartbeat_persistence_failed";
const CONFIG_MISSING_CODE = "qstash_signing_config_missing";
const INTERNAL_FAILURE_CODE = "qstash_processing_internal_failure";

/**
 * Test-only factory. Production callers must use `processVerifiedQstashDelivery`.
 */
export function createProcessVerifiedQstashDeliveryForTests(
  deps: ProcessVerifiedQstashDeliveryDeps,
): (input: ProcessVerifiedQstashDeliveryInput) => Promise<ProcessVerifiedQstashDeliveryResult> {
  return (input) => runProcessVerifiedQstashDelivery(input, deps);
}

export async function processVerifiedQstashDelivery(
  input: ProcessVerifiedQstashDeliveryInput,
): Promise<ProcessVerifiedQstashDeliveryResult> {
  return runProcessVerifiedQstashDelivery(input, {
    resolveSigningKeys: () => resolveQstashSigningKeys(),
    verifyDelivery: verifyQstashDeliveryAndExtractJti,
    persistVerifiedHeartbeat: recordVerifiedPrimaryHeartbeatInLock,
  });
}

async function runProcessVerifiedQstashDelivery(
  input: ProcessVerifiedQstashDeliveryInput,
  deps: ProcessVerifiedQstashDeliveryDeps,
): Promise<ProcessVerifiedQstashDeliveryResult> {
  let keys: QstashSigningKeyConfig | null;
  try {
    keys = deps.resolveSigningKeys();
  } catch {
    return { status: "internal_failure", code: INTERNAL_FAILURE_CODE };
  }

  if (!keys) {
    return { status: "configuration_unavailable", code: CONFIG_MISSING_CODE };
  }

  let verifiedJti: string;
  try {
    const verified = await deps.verifyDelivery(
      {
        signature: input.signature,
        rawBody: input.rawBody,
      },
      { keys },
    );
    verifiedJti = verified.jti;
  } catch (error) {
    if (error instanceof SignatureError) {
      return {
        status: "verification_rejected",
        code: classifySignatureError(error),
      };
    }
    return { status: "internal_failure", code: INTERNAL_FAILURE_CODE };
  }

  try {
    const persisted = await deps.persistVerifiedHeartbeat({
      jti: verifiedJti,
      untrustedMessageId: input.untrustedMessageId,
    });
    return {
      status: "recorded",
      outcome: persisted.outcome,
      jti: persisted.jti,
      lastSeenAt: persisted.lastSeenAt,
    };
  } catch {
    return {
      status: "persistence_failed",
      code: PERSISTENCE_FAILED_CODE,
      jti: verifiedJti,
    };
  }
}

function classifySignatureError(error: SignatureError): QstashVerificationRejectedCode {
  const message = error.message;
  if (message === "qstash_verified_jti_missing") {
    return "qstash_verified_jti_missing";
  }
  if (message.startsWith("invalid subject:")) {
    return "qstash_canonical_url_mismatch";
  }
  if (message.includes("body hash does not match")) {
    return "qstash_signature_invalid";
  }
  if (message.includes('"exp"') && message.includes("timestamp check failed")) {
    return "qstash_signature_expired";
  }
  if (message.includes('"nbf"') && message.includes("timestamp check failed")) {
    return "qstash_signature_not_yet_valid";
  }
  return "qstash_verification_rejected";
}
