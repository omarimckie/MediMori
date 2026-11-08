import { hasMarketingBlobCredentials } from "../../marketing-blob";
import type { CredentialValidationAttempt } from "../types";

export type BlobListProbeResult = { ok: true } | { ok: false; authFailure?: boolean; transient?: boolean };

export type BlobListProbeFn = () => Promise<BlobListProbeResult>;

let blobListProbeForTests: BlobListProbeFn | null = null;

export function setBlobListProbeForTests(fn: BlobListProbeFn | null): void {
  blobListProbeForTests = fn;
}

async function defaultBlobListProbe(): Promise<BlobListProbeResult> {
  try {
    const { list } = await import("@vercel/blob");
    await list({ limit: 1 });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unauthorized") || message.includes("401") || message.includes("403")) {
      return { ok: false, authFailure: true };
    }
    if (message.includes("token") && message.includes("missing")) {
      return { ok: false, authFailure: true };
    }
    return { ok: false, transient: true };
  }
}

export async function runVercelBlobCredentialProbe(input: {
  attemptedAt: string;
  env?: Record<string, string | undefined>;
  listProbe?: BlobListProbeFn;
}): Promise<CredentialValidationAttempt> {
  const env = input.env ?? process.env;
  const configured = hasMarketingBlobCredentials(env);
  const base = {
    platform: "vercel_blob" as const,
    method: "vercel_blob_list" as const,
    attemptedAt: input.attemptedAt,
    permissionCheck: "not_checked" as const,
  };

  if (!configured) {
    return {
      ...base,
      monitoringAvailability: "not_configured",
      credentialsConfigured: false,
      errorClass: "vercel_blob_credentials_missing",
    };
  }

  const probe = input.listProbe ?? blobListProbeForTests ?? defaultBlobListProbe;
  const result = await probe();

  if (result.ok) {
    return {
      ...base,
      monitoringAvailability: "available",
      credentialsConfigured: true,
      tokenReportedValid: true,
    };
  }

  if (result.authFailure) {
    return {
      ...base,
      monitoringAvailability: "available",
      credentialsConfigured: true,
      tokenReportedValid: false,
      errorClass: "vercel_blob_auth_invalid",
    };
  }

  return {
    ...base,
    monitoringAvailability: "available",
    credentialsConfigured: true,
    transientFailure: true,
    errorClass: "vercel_blob_validation_transient",
  };
}
