import { buildManagerStatus } from "./consolidate";
import {
  CENTRAL_AGENT_MANAGER_MOCK_STATUS_CACHE_TTL_MS,
  CENTRAL_AGENT_MANAGER_STATUS_CACHE_MAX_ENTRIES,
} from "./mock/constants";
import { isMockSatelliteHarnessEnabled } from "./mock/enabled";
import type { ManagerStatusPayload } from "./types";

export type ManagerStatusWithRetrieval = ManagerStatusPayload & {
  retrieval: "fresh" | "cached";
  cachedAt: string | null;
  mockDemonstration: boolean;
  cacheTtlMs: number | null;
};

type CacheEntry = {
  expiresAt: number;
  cachedAt: string;
  payload: ManagerStatusPayload;
  configKey: string;
};

const cacheStore = new Map<string, CacheEntry>();

export function statusCacheConfigKey(): string {
  return [
    isMockSatelliteHarnessEnabled() ? "mock" : "live",
    process.env.ENGINEERING_CONTROL_PLANE_ENABLED === "true" ? "eng-on" : "eng-off",
    process.env.CENTRAL_AGENT_MANAGER_MEDIMORI_SOURCE?.trim() ?? "medimori-default",
  ].join("|");
}

function cacheKey(ownerUsername: string, configKey: string): string {
  return `${ownerUsername.trim().toLowerCase()}|${configKey}`;
}

function pruneCacheIfNeeded() {
  if (cacheStore.size <= CENTRAL_AGENT_MANAGER_STATUS_CACHE_MAX_ENTRIES) return;
  const oldest = [...cacheStore.entries()].sort(
    (a, b) => Date.parse(a[1].cachedAt) - Date.parse(b[1].cachedAt),
  );
  while (cacheStore.size > CENTRAL_AGENT_MANAGER_STATUS_CACHE_MAX_ENTRIES) {
    const entry = oldest.shift();
    if (entry) cacheStore.delete(entry[0]);
  }
}

export function clearStatusCacheForTests() {
  cacheStore.clear();
}

export async function buildManagerStatusWithCache(input: {
  ownerUsername: string;
  refresh: boolean;
  now?: Date;
}): Promise<ManagerStatusWithRetrieval> {
  const mockDemonstration = isMockSatelliteHarnessEnabled();
  const cacheTtlMs = mockDemonstration ? CENTRAL_AGENT_MANAGER_MOCK_STATUS_CACHE_TTL_MS : null;
  const configKey = statusCacheConfigKey();
  const key = cacheKey(input.ownerUsername, configKey);
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  if (mockDemonstration && cacheTtlMs && !input.refresh) {
    const hit = cacheStore.get(key);
    if (hit && hit.expiresAt > nowMs && hit.configKey === configKey) {
      return {
        ...hit.payload,
        retrieval: "cached",
        cachedAt: hit.cachedAt,
        mockDemonstration: true,
        cacheTtlMs,
      };
    }
  }

  const payload = await buildManagerStatus(now);
  const fresh: ManagerStatusWithRetrieval = {
    ...payload,
    retrieval: "fresh",
    cachedAt: null,
    mockDemonstration,
    cacheTtlMs,
  };

  if (mockDemonstration && cacheTtlMs) {
    pruneCacheIfNeeded();
    cacheStore.set(key, {
      configKey,
      cachedAt: now.toISOString(),
      expiresAt: nowMs + cacheTtlMs,
      payload,
    });
  }

  return fresh;
}
