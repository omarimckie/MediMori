import { CAM_STAGING_NEON_ENDPOINT_ID } from "./cam-consumer-staging-acceptance-harness";
import { endpointMarkerInDatabaseUrl } from "./orchestration-env-safeguards";

export type ExternalConnectionGuardResult = { ok: true } | { ok: false; code: string; message: string };

/** Fail closed when live Cursor or staging orchestration credentials are present in test env. */
export function assertOfflineTestEnvironment(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ExternalConnectionGuardResult {
  if (env.CURSOR_API_KEY?.trim()) {
    return { ok: false, code: "cursor_api_key_set", message: "CURSOR_API_KEY must not be set for offline tests." };
  }
  const url = env.CAM_ORCHESTRATION_DATABASE_URL?.trim() ?? "";
  if (url) {
    if (url.includes(CAM_STAGING_NEON_ENDPOINT_ID)) {
      return {
        ok: false,
        code: "staging_database_url_set",
        message: "CAM_ORCHESTRATION_DATABASE_URL targets staging; unset for offline tests.",
      };
    }
    const denied = endpointMarkerInDatabaseUrl(url);
    if (denied) {
      return { ok: false, code: "denied_database_url", message: `Database URL contains denied marker ${denied}.` };
    }
  }
  return { ok: true };
}
