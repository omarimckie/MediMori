import type { IntegrationCredentialPlatform } from "./integration-platforms";
import { runNeonPostgresCredentialProbe } from "./probes/neon-probe";
import { runPinterestCredentialProbe } from "./probes/pinterest-probe";
import { runResendCredentialProbe } from "./probes/resend-probe";
import { runStripeCredentialProbe } from "./probes/stripe-probe";
import { runVercelBlobCredentialProbe } from "./probes/blob-probe";
import type { CredentialProbeFetch } from "./probes";
import type { CredentialHealthPlatform, CredentialValidationAttempt } from "./types";
import {
  fingerprintIntegrationCredential,
} from "./fingerprint";

export type IntegrationProbeContext = {
  attemptedAt: string;
  env?: Record<string, string | undefined>;
  fetch?: CredentialProbeFetch;
};

export type RegisteredIntegrationProvider = {
  platform: IntegrationCredentialPlatform;
  label: string;
  description: string;
  runProbe: (ctx: IntegrationProbeContext) => Promise<CredentialValidationAttempt>;
  fingerprint: (env?: Record<string, string | undefined>) => string | null;
  /** When true, auth incidents are not opened (configured but validity unknown). */
  suppressAuthIncidents?: boolean;
};

export const INTEGRATION_CREDENTIAL_REGISTRY: RegisteredIntegrationProvider[] = [
  {
    platform: "stripe",
    label: "Stripe",
    description: "Checkout and payments (read-only balance probe).",
    runProbe: (ctx) => runStripeCredentialProbe(ctx),
    fingerprint: (env) => fingerprintIntegrationCredential("stripe", env),
  },
  {
    platform: "resend",
    label: "Resend",
    description: "Transactional email (read-only API key metadata).",
    runProbe: (ctx) => runResendCredentialProbe(ctx),
    fingerprint: (env) => fingerprintIntegrationCredential("resend", env),
  },
  {
    platform: "vercel_blob",
    label: "Vercel Blob",
    description: "Marketing uploads and eBook storage.",
    runProbe: (ctx) => runVercelBlobCredentialProbe(ctx),
    fingerprint: (env) => fingerprintIntegrationCredential("vercel_blob", env),
  },
  {
    platform: "neon_postgres",
    label: "Neon Postgres",
    description: "Primary application database (bounded SELECT 1).",
    runProbe: (ctx) => runNeonPostgresCredentialProbe(ctx),
    fingerprint: (env) => fingerprintIntegrationCredential("neon_postgres", env),
  },
  {
    platform: "pinterest",
    label: "Pinterest",
    description: "Pin publishing (refresh-only OAuth — safe auth probe unavailable).",
    runProbe: (ctx) => runPinterestCredentialProbe(ctx),
    fingerprint: (env) => fingerprintIntegrationCredential("pinterest", env),
    suppressAuthIncidents: true,
  },
];

export function registryEntryForPlatform(
  platform: CredentialHealthPlatform,
): RegisteredIntegrationProvider | null {
  return INTEGRATION_CREDENTIAL_REGISTRY.find((row) => row.platform === platform) ?? null;
}

export async function runRegistryProbeForPlatform(
  platform: IntegrationCredentialPlatform,
  ctx: IntegrationProbeContext,
): Promise<CredentialValidationAttempt> {
  const entry = registryEntryForPlatform(platform);
  if (!entry) {
    throw new Error(`No credential probe registered for ${platform}`);
  }
  return entry.runProbe(ctx);
}
