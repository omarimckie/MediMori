/**
 * Explicit-only disposable PostgreSQL URL for dispatcher watchdog integration tests.
 * Never reads DATABASE_URL, POSTGRES_URL, or .env.local.
 */

export const DISPATCHER_WATCHDOG_TEST_ALLOW_VALUE = "disposable-local-only";

const PRODUCTION_HOST_MARKERS = [
  "ep-muddy-math-auxmesyz",
  "neon.tech",
  "aws.neon",
];

const FORBIDDEN_HOSTNAMES = new Set([
  "localhost",
  "host.docker.internal",
]);

const FORBIDDEN_QUERY_PARAM_PREFIXES = [
  "options",
  "host",
  "socket",
  "sockethost",
  "socketport",
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "channel_binding",
  "target_session_attrs",
];

/**
 * @param {string} runId
 * @returns {string}
 */
export function expectedDisposablePgHostname(runId) {
  const trimmed = String(runId ?? "").trim();
  if (!trimmed) {
    throw new Error("dispatcher_watchdog_test_run_id_required");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/.test(trimmed)) {
    throw new Error("dispatcher_watchdog_test_run_id_invalid");
  }
  return `tf-watchdog-pg-${trimmed}`;
}

/**
 * @param {string} hostname
 */
function isIpv4Literal(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * @param {string} hostname
 */
function isIpv6Literal(hostname) {
  return hostname.includes(":");
}

/**
 * @param {string} hostname
 */
function hostLooksExternal(hostname) {
  const lower = hostname.toLowerCase();
  if (FORBIDDEN_HOSTNAMES.has(lower)) {
    return true;
  }
  if (lower === "127.0.0.1" || lower.endsWith(".localhost")) {
    return true;
  }
  if (isIpv4Literal(hostname) || isIpv6Literal(hostname)) {
    return true;
  }
  for (const marker of PRODUCTION_HOST_MARKERS) {
    if (lower.includes(marker)) {
      return true;
    }
  }
  if (!lower.startsWith("tf-watchdog-pg-")) {
    return true;
  }
  if (lower.includes(".")) {
    return true;
  }
  return false;
}

/**
 * @param {URL} url
 */
function assertSafeQueryParams(url) {
  for (const key of url.searchParams.keys()) {
    const lower = key.toLowerCase();
    for (const forbidden of FORBIDDEN_QUERY_PARAM_PREFIXES) {
      if (lower === forbidden || lower.startsWith(`${forbidden}-`)) {
        throw new Error("dispatcher_watchdog_test_url_forbidden_query_param");
      }
    }
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string} connection string (caller must not log)
 */
export function resolveMarketingDispatcherWatchdogTestDatabaseUrl(env = process.env) {
  const allow = env.MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW?.trim();
  if (allow !== DISPATCHER_WATCHDOG_TEST_ALLOW_VALUE) {
    throw new Error("dispatcher_watchdog_test_allow_missing_or_invalid");
  }

  const rawUrl = env.MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error("dispatcher_watchdog_test_database_url_missing");
  }

  const expectedHost = env.MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST?.trim();
  if (!expectedHost) {
    throw new Error("dispatcher_watchdog_test_expected_pg_host_missing");
  }

  const runId = env.MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID?.trim();
  if (!runId) {
    throw new Error("dispatcher_watchdog_test_run_id_missing");
  }

  const canonicalHost = expectedDisposablePgHostname(runId);
  if (expectedHost !== canonicalHost) {
    throw new Error("dispatcher_watchdog_test_expected_pg_host_mismatch");
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("dispatcher_watchdog_test_database_url_malformed");
  }

  const protocol = url.protocol.replace(":", "").toLowerCase();
  if (protocol !== "postgresql" && protocol !== "postgres") {
    throw new Error("dispatcher_watchdog_test_database_url_protocol_invalid");
  }

  if (!url.username) {
    throw new Error("dispatcher_watchdog_test_database_url_user_missing");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!databaseName) {
    throw new Error("dispatcher_watchdog_test_database_url_database_missing");
  }

  const hostname = url.hostname;
  if (hostLooksExternal(hostname)) {
    throw new Error("dispatcher_watchdog_test_database_url_host_forbidden");
  }

  if (hostname !== canonicalHost) {
    throw new Error("dispatcher_watchdog_test_database_url_host_identity_mismatch");
  }

  assertSafeQueryParams(url);

  return rawUrl;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string | null} connection string when fully valid; otherwise null
 */
export function tryResolveMarketingDispatcherWatchdogTestDatabaseUrl(env = process.env) {
  try {
    return resolveMarketingDispatcherWatchdogTestDatabaseUrl(env);
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function isDispatcherWatchdogIntegrationConfigured(env = process.env) {
  return tryResolveMarketingDispatcherWatchdogTestDatabaseUrl(env) != null;
}
