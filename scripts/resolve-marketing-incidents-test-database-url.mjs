/**
 * Resolves MARKETING_INCIDENTS_TEST_DATABASE_URL for CI/local runs without printing secrets.
 * Uses Neon engineering branch host (non-production) with credentials from local DATABASE_URL.
 */
import { readFileSync } from "node:fs";

/** Production Neon compute for twilightFeather `production` branch — do not use for tests. */
const PRODUCTION_TEST_HOST_MARKERS = ["ep-muddy-math-auxmesyz"];

/** Engineering branch compute — safe for incident schema/tests. */
const ENGINEERING_POOLER_HOST =
  "ep-gentle-dawn-au6vxirn-pooler.c-10.us-east-1.aws.neon.tech";

function loadDatabaseUrlFromEnvLocal() {
  const env = readFileSync(".env.local", "utf8");
  const match = env.match(/^DATABASE_URL=(.*)$/m);
  if (!match) {
    throw new Error("DATABASE_URL missing from .env.local");
  }
  return match[1].trim().replace(/^["']|["']$/g, "");
}

export function resolveMarketingIncidentsTestDatabaseUrl() {
  const explicit = process.env.MARKETING_INCIDENTS_TEST_DATABASE_URL?.trim();
  if (explicit) {
    const host = new URL(explicit).hostname;
    for (const marker of PRODUCTION_TEST_HOST_MARKERS) {
      if (host.includes(marker)) {
        throw new Error(
          "MARKETING_INCIDENTS_TEST_DATABASE_URL points at production Neon compute; use engineering branch or a disposable database.",
        );
      }
    }
    return explicit;
  }

  const base = loadDatabaseUrlFromEnvLocal();
  const url = new URL(base);
  for (const marker of PRODUCTION_TEST_HOST_MARKERS) {
    if (url.hostname.includes(marker)) {
      url.hostname = ENGINEERING_POOLER_HOST;
      return url.toString();
    }
  }

  throw new Error(
    "Could not resolve a non-production test database. Set MARKETING_INCIDENTS_TEST_DATABASE_URL to a disposable Neon branch.",
  );
}

import { pathToFileURL } from "node:url";

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const resolved = resolveMarketingIncidentsTestDatabaseUrl();
  const host = new URL(resolved).hostname;
  const isProd = PRODUCTION_TEST_HOST_MARKERS.some((m) => host.includes(m));
  console.log(JSON.stringify({ ok: !isProd, hostname: host, branch: "engineering-2a-20261002" }));
}
