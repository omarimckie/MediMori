import type { CredentialValidationAttempt } from "../types";

export const NEON_PING_STATEMENT = "SELECT 1 AS credential_health_probe";

export type NeonPingFn = () => Promise<{ ok: true } | { ok: false; reason: "missing" | "auth" | "transient" }>;

let neonPingForTests: NeonPingFn | null = null;

export function setNeonPingProbeForTests(fn: NeonPingFn | null): void {
  neonPingForTests = fn;
}

function readDatabaseUrl(env: Record<string, string | undefined>): string | null {
  const raw = env.DATABASE_URL?.trim();
  return raw || null;
}

async function defaultNeonPing(): Promise<
  { ok: true } | { ok: false; reason: "missing" | "auth" | "transient" }
> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return { ok: false, reason: "missing" };
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(connectionString);
    await sql`SELECT 1 AS credential_health_probe`;
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      message.includes("password authentication failed") ||
      message.includes("role") && message.includes("does not exist") ||
      message.includes("authentication")
    ) {
      return { ok: false, reason: "auth" };
    }
    if (message.includes("not configured") || message.includes("database_url")) {
      return { ok: false, reason: "missing" };
    }
    return { ok: false, reason: "transient" };
  }
}

export async function runNeonPostgresCredentialProbe(input: {
  attemptedAt: string;
  env?: Record<string, string | undefined>;
  ping?: NeonPingFn;
}): Promise<CredentialValidationAttempt> {
  const env = input.env ?? process.env;
  const configured = Boolean(readDatabaseUrl(env));
  const base = {
    platform: "neon_postgres" as const,
    method: "neon_postgres_ping" as const,
    attemptedAt: input.attemptedAt,
    permissionCheck: "not_checked" as const,
  };

  if (!configured) {
    return {
      ...base,
      monitoringAvailability: "not_configured",
      credentialsConfigured: false,
      errorClass: "neon_postgres_credentials_missing",
    };
  }

  const ping = input.ping ?? neonPingForTests ?? defaultNeonPing;
  const result = await ping();

  if (result.ok) {
    return {
      ...base,
      monitoringAvailability: "available",
      credentialsConfigured: true,
      tokenReportedValid: true,
    };
  }

  if (result.reason === "missing") {
    return {
      ...base,
      monitoringAvailability: "not_configured",
      credentialsConfigured: false,
      errorClass: "neon_postgres_credentials_missing",
    };
  }

  if (result.reason === "auth") {
    return {
      ...base,
      monitoringAvailability: "available",
      credentialsConfigured: true,
      tokenReportedValid: false,
      errorClass: "neon_postgres_auth_invalid",
    };
  }

  return {
    ...base,
    monitoringAvailability: "available",
    credentialsConfigured: true,
    transientFailure: true,
    errorClass: "neon_postgres_validation_transient",
  };
}
