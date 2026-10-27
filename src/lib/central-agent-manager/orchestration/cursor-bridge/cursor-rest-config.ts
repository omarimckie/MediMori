export const CURSOR_CLOUD_API_DEFAULT_BASE_URL = "https://api.cursor.com";

export type CursorRestTransportConfig = {
  apiKey: string;
  baseUrl: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  maxReadRetries: number;
  readRetryBaseMs: number;
  readRetryMaxMs: number;
};

export type CursorBridgePollingConfig = {
  pollIntervalMs: number;
  pollMaxDurationMs: number;
  heartbeatMinIntervalMs: number;
};

const POSITIVE_INT = (value: string | undefined, fallback: number): number => {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

export function readCursorApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.CURSOR_API_KEY?.trim();
  return raw ? raw : null;
}

export function loadCursorRestTransportConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CursorRestTransportConfig | null {
  const apiKey = readCursorApiKeyFromEnv(env);
  if (!apiKey) return null;
  const baseUrl = (env.CURSOR_CLOUD_API_BASE_URL?.trim() || CURSOR_CLOUD_API_DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  return {
    apiKey,
    baseUrl,
    requestTimeoutMs: POSITIVE_INT(env.CURSOR_BRIDGE_REQUEST_TIMEOUT_MS, 60_000),
    maxResponseBytes: POSITIVE_INT(env.CURSOR_BRIDGE_MAX_RESPONSE_BYTES, 256_000),
    maxReadRetries: POSITIVE_INT(env.CURSOR_BRIDGE_READ_MAX_RETRIES, 4),
    readRetryBaseMs: POSITIVE_INT(env.CURSOR_BRIDGE_READ_RETRY_BASE_MS, 1_000),
    readRetryMaxMs: POSITIVE_INT(env.CURSOR_BRIDGE_READ_RETRY_MAX_MS, 30_000),
  };
}

export function loadCursorBridgePollingConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CursorBridgePollingConfig {
  return {
    pollIntervalMs: POSITIVE_INT(env.CURSOR_BRIDGE_POLL_INTERVAL_MS, 5_000),
    pollMaxDurationMs: POSITIVE_INT(env.CURSOR_BRIDGE_POLL_MAX_DURATION_MS, 600_000),
    heartbeatMinIntervalMs: POSITIVE_INT(env.CURSOR_BRIDGE_HEARTBEAT_MIN_INTERVAL_MS, 15_000),
  };
}
