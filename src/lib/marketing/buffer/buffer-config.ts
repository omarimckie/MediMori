import { isMockMode } from "../config";

export const BUFFER_GRAPHQL_URL = "https://api.buffer.com";

export const MARKETING_BUFFER_TIKTOK_ENABLED_ENV = "MARKETING_BUFFER_TIKTOK_ENABLED";
export const MARKETING_BUFFER_TIKTOK_LIVE_ENV = "MARKETING_BUFFER_TIKTOK_LIVE";
export const BUFFER_TIKTOK_CHANNEL_ID_ENV = "BUFFER_TIKTOK_CHANNEL_ID";
export const BUFFER_ORGANIZATION_ID_ENV = "BUFFER_ORGANIZATION_ID";

export function isMarketingBufferTikTokFeatureEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[MARKETING_BUFFER_TIKTOK_ENABLED_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Hard gate for outbound Buffer GraphQL mutations. Default off; tests inject a mock client.
 * Production enablement requires owner to set both ENABLED and LIVE (separate authorization).
 */
export function isBufferTikTokLivePublishingAllowed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (isMockMode(env)) return false;
  if (!isMarketingBufferTikTokFeatureEnabled(env)) return false;
  const live = env[MARKETING_BUFFER_TIKTOK_LIVE_ENV]?.trim().toLowerCase();
  return live === "1" || live === "true" || live === "yes";
}

export function getBufferTikTokChannelId(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env[BUFFER_TIKTOK_CHANNEL_ID_ENV]?.trim() || null;
}

export function getBufferAccessToken(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.BUFFER_ACCESS_TOKEN?.trim() || null;
}