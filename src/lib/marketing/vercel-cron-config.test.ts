import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const MARKETING_PUBLISH_CRON_PATH = "/api/cron/marketing-publish";

/** Pro/Enterprise: per-minute precision. Hobby allows at most once per day (deploy would fail). */
const MARKETING_PUBLISH_CRON_SCHEDULE = "*/15 * * * *";

test("vercel.json registers marketing publish cron at 15-minute cadence", () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  const cron = vercel.crons?.find((row) => row.path === MARKETING_PUBLISH_CRON_PATH);
  assert.ok(cron, "marketing-publish cron entry missing");
  assert.equal(cron.schedule, MARKETING_PUBLISH_CRON_SCHEDULE);
});
