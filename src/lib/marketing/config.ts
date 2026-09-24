import type { ChannelQuotas, Platform } from "./types";

export const DEFAULT_TIMEZONE = "America/New_York";

export const DEFAULT_CHANNEL_QUOTAS: ChannelQuotas = {
  instagram: 5,
  facebook: 5,
  pinterest: 3,
  email: 1,
  website: 1,
  google: 1,
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  pinterest: "Pinterest",
  email: "Email",
  website: "Website / SEO",
  google: "Google Business Profile",
};

/**
 * Mock mode is the default. Live publishing/AI/image spend only happen when
 * MARKETING_MOCK_MODE=false is set explicitly.
 */
export function isMockMode(): boolean {
  return process.env.MARKETING_MOCK_MODE !== "false";
}

export function getMarketingTimezone(): string {
  return process.env.MARKETING_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
}

export function getCronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

type EnvLike = Record<string, string | undefined>;

/** Vercel production only. Local `next build` / `next start` do not count. */
export function isProductionRuntime(env: EnvLike = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

export function allowMarketingDemoSeed(env: EnvLike = process.env): boolean {
  return !isProductionRuntime(env);
}

export type MarketingStoreMode = "memory" | "postgres";

export function resolveMarketingStoreMode(env: EnvLike = process.env): MarketingStoreMode {
  if (isProductionRuntime(env)) {
    if (env.MARKETING_STORE === "memory") {
      throw new Error("MARKETING_STORE=memory is not allowed when VERCEL_ENV=production.");
    }
    if (!env.DATABASE_URL?.trim()) {
      throw new Error("DATABASE_URL is required for Marketing Autopilot in production.");
    }
    return "postgres";
  }
  if (env.MARKETING_STORE === "memory") return "memory";
  return "postgres";
}

export function cronAuthDecision(input: {
  isProduction: boolean;
  cronSecret: string | null;
  authorizationHeader: string | null;
  isAdmin: boolean;
}): { ok: boolean; reason: string } {
  const header = input.authorizationHeader?.trim() ?? "";
  const secret = input.cronSecret;
  const bearerOk = Boolean(secret && header === `Bearer ${secret}`);

  if (bearerOk) return { ok: true, reason: "cron_secret" };
  if (input.isAdmin) return { ok: true, reason: "admin_session" };
  if (input.isProduction && !secret) {
    return { ok: false, reason: "production_cron_secret_missing" };
  }
  return { ok: false, reason: "unauthorized" };
}

export function getAiSimpleModel(): string {
  return process.env.MARKETING_AI_SIMPLE_MODEL?.trim() || "gpt-4.1-mini";
}

export function getAiComplexModel(): string {
  return process.env.MARKETING_AI_COMPLEX_MODEL?.trim() || "gpt-4.1";
}

export function getOpenAiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export function getBufferToken(): string | null {
  return process.env.BUFFER_ACCESS_TOKEN?.trim() || null;
}

export const DEFAULT_META_GRAPH_VERSION = "v22.0";

export function getMetaGraphVersion(env: EnvLike = process.env): string {
  const raw = env.META_GRAPH_API_VERSION?.trim() || DEFAULT_META_GRAPH_VERSION;
  return raw.startsWith("v") ? raw : `v${raw}`;
}

export type MetaInstagramCredentials = {
  userId: string;
  accessToken: string;
  graphVersion: string;
};

export type MetaFacebookCredentials = {
  pageId: string;
  pageAccessToken: string;
  graphVersion: string;
};

/** Server-side Instagram Graph credentials. Never return this object to the client. */
export function getMetaInstagramCredentials(
  env: EnvLike = process.env,
): MetaInstagramCredentials | null {
  const userId = env.META_INSTAGRAM_USER_ID?.trim();
  const accessToken = env.META_INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!userId || !accessToken) return null;
  return { userId, accessToken, graphVersion: getMetaGraphVersion(env) };
}

/** Server-side Facebook Page credentials. Never return this object to the client. */
export function getMetaFacebookCredentials(
  env: EnvLike = process.env,
): MetaFacebookCredentials | null {
  const pageId = env.META_FACEBOOK_PAGE_ID?.trim();
  const pageAccessToken = env.META_FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !pageAccessToken) return null;
  return { pageId, pageAccessToken, graphVersion: getMetaGraphVersion(env) };
}

export function parseChannelQuotas(
  value: unknown,
  fallback: ChannelQuotas = DEFAULT_CHANNEL_QUOTAS,
): ChannelQuotas {
  if (!value || typeof value !== "object") return { ...fallback };
  const input = value as Record<string, unknown>;
  const next = { ...fallback };
  for (const key of Object.keys(fallback) as Platform[]) {
    const raw = input[key];
    const num = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(num) && num >= 0 && num <= 30) {
      next[key] = Math.floor(num);
    }
  }
  return next;
}
