/** Non-Meta integrations monitored in Phase 2 (plus OpenAI from Phase 1). */
export const INTEGRATION_CREDENTIAL_PLATFORMS = [
  "pinterest",
  "stripe",
  "resend",
  "vercel_blob",
  "neon_postgres",
] as const;

export type IntegrationCredentialPlatform = (typeof INTEGRATION_CREDENTIAL_PLATFORMS)[number];

export function isIntegrationCredentialPlatform(
  platform: string,
): platform is IntegrationCredentialPlatform {
  return (INTEGRATION_CREDENTIAL_PLATFORMS as readonly string[]).includes(platform);
}

export type IntegrationProviderSlug =
  | "pinterest"
  | "stripe"
  | "resend"
  | "vercel_blob"
  | "neon_postgres";

export function integrationProviderSlug(
  platform: IntegrationCredentialPlatform,
): IntegrationProviderSlug {
  return platform;
}
