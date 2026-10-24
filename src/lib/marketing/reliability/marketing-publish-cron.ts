import { logMarketing } from "../logger";
import {
  assertMarketingPreviewAllowsMutations,
  MarketingPreviewReadonlyError,
  MARKETING_PREVIEW_READONLY_MESSAGE,
} from "../preview-readonly";
import type { MarketingStore } from "../store";
import type { MarketingPublication } from "../types";
import {
  processVerifiedQstashDelivery,
  type ProcessVerifiedQstashDeliveryResult,
} from "./qstash-primary/process-verified-qstash-delivery";
import {
  readUntrustedUpstashMessageId,
  readUpstashSignatureHeader,
} from "./qstash-primary/verify";
import type { ReliabilitySweepResult } from "./sweep";

export const MAX_QSTASH_SIGNED_BODY_BYTES = 65536;

export type MarketingPublishCronAuth = { ok: boolean; reason: string };

export type MarketingPublishCronResult =
  | { ok: false; status: 401 | 403; body: { error: string } }
  | {
      ok: true;
      status: 200;
      body: {
        published: number;
        results: unknown[];
        reliability?: ReliabilitySweepResult;
      };
    };

export type BoundedBodyReadFailureCode =
  | "qstash_signed_body_too_large"
  | "qstash_signed_body_read_failed";

export type BoundedBodyReadResult =
  | { ok: true; rawBody: string }
  | { ok: false; code: BoundedBodyReadFailureCode };

export type MarketingPublishCronDeps = {
  authorize: (request: Request) => Promise<MarketingPublishCronAuth>;
  getStore: () => MarketingStore;
  publishDue: (store: MarketingStore) => Promise<unknown[]>;
  recordHeartbeat: (input: {
    request: Request;
    auth: MarketingPublishCronAuth;
    publishedCount: number;
  }) => Promise<unknown>;
  runReliabilityAfterMarketingPublish: (input: {
    authOk: boolean;
    authReason: string;
    publishCyclePublications?: MarketingPublication[];
  }) => Promise<ReliabilitySweepResult | null>;
  observeVerifiedQstashPrimaryHeartbeat?: (request: Request) => Promise<void>;
};

export async function readBoundedUtf8RequestBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedBodyReadResult> {
  const body = request.body;
  if (body == null) {
    return { ok: true, rawBody: "" };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore cancel errors
        }
        return { ok: false, code: "qstash_signed_body_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors
    }
    return { ok: false, code: "qstash_signed_body_read_failed" };
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let rawBody: string;
  try {
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    return { ok: false, code: "qstash_signed_body_read_failed" };
  }

  return { ok: true, rawBody };
}

function logQstashPrimaryHeartbeatOutcome(outcome: {
  status: string;
  code: string;
  success: boolean;
}) {
  try {
    logMarketing({
      operation: "qstash_primary_heartbeat",
      success: outcome.success,
      error: `${outcome.status}/${outcome.code}`,
    });
  } catch {
    // logging must not affect publishing
  }
}

function sanitizedOutcomeFromResult(
  result: ProcessVerifiedQstashDeliveryResult,
): { status: string; code: string; success: boolean } {
  switch (result.status) {
    case "recorded":
      return {
        status: "recorded",
        code: result.outcome,
        success: true,
      };
    case "verification_rejected":
      return {
        status: "verification_rejected",
        code: result.code,
        success: false,
      };
    case "configuration_unavailable":
      return {
        status: "configuration_unavailable",
        code: result.code,
        success: false,
      };
    case "persistence_failed":
      return {
        status: "persistence_failed",
        code: result.code,
        success: false,
      };
    case "internal_failure":
      return {
        status: "internal_failure",
        code: result.code,
        success: false,
      };
    default:
      return {
        status: "internal_failure",
        code: "qstash_processing_internal_failure",
        success: false,
      };
  }
}

export type ObserveVerifiedQstashPrimaryHeartbeatDeps = {
  processVerified: typeof processVerifiedQstashDelivery;
};

export async function observeVerifiedQstashPrimaryHeartbeat(
  request: Request,
  deps: ObserveVerifiedQstashPrimaryHeartbeatDeps = {
    processVerified: processVerifiedQstashDelivery,
  },
): Promise<void> {
  const signature = readUpstashSignatureHeader(request.headers);
  if (!signature) {
    return;
  }

  try {
    const bodyRead = await readBoundedUtf8RequestBody(
      request,
      MAX_QSTASH_SIGNED_BODY_BYTES,
    );
    if (!bodyRead.ok) {
      logQstashPrimaryHeartbeatOutcome({
        status: "skipped",
        code: bodyRead.code,
        success: false,
      });
      return;
    }

    const result = await deps.processVerified({
      signature,
      rawBody: bodyRead.rawBody,
      untrustedMessageId: readUntrustedUpstashMessageId(request.headers),
    });
    logQstashPrimaryHeartbeatOutcome(sanitizedOutcomeFromResult(result));
  } catch {
    logQstashPrimaryHeartbeatOutcome({
      status: "internal_failure",
      code: "qstash_processing_internal_failure",
      success: false,
    });
  }
}

export async function handleMarketingPublishCron(
  request: Request,
  deps: MarketingPublishCronDeps,
): Promise<MarketingPublishCronResult> {
  try {
    assertMarketingPreviewAllowsMutations();
  } catch (error) {
    if (error instanceof MarketingPreviewReadonlyError) {
      return { ok: false, status: 403, body: { error: MARKETING_PREVIEW_READONLY_MESSAGE } };
    }
    throw error;
  }

  const auth = await deps.authorize(request);
  if (!auth.ok) {
    return { ok: false, status: 401, body: { error: "Unauthorized." } };
  }

  const observe =
    deps.observeVerifiedQstashPrimaryHeartbeat ?? observeVerifiedQstashPrimaryHeartbeat;
  await observe(request);

  const results = await deps.publishDue(deps.getStore());
  const publishCyclePublications = results.filter(
    (row): row is MarketingPublication =>
      Boolean(row) && typeof row === "object" && typeof (row as MarketingPublication).id === "string",
  );
  await deps.recordHeartbeat({
    request,
    auth,
    publishedCount: results.length,
  });
  const reliability = await deps.runReliabilityAfterMarketingPublish({
    authOk: auth.ok,
    authReason: auth.reason,
    publishCyclePublications,
  });
  return {
    ok: true,
    status: 200,
    body: {
      published: results.length,
      results,
      ...(reliability ? { reliability } : {}),
    },
  };
}
