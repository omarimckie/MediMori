import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const MARKETING_PUBLISH_CRON_PATH = "/api/cron/marketing-publish";

/** Vercel Hobby: at most one cron invocation per day (sub-daily expressions fail deploy). */
const MARKETING_PUBLISH_CRON_SCHEDULE = "0 16 * * *";

test("vercel.json registers Hobby-compatible daily marketing publish cron", () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  const cron = vercel.crons?.find((row) => row.path === MARKETING_PUBLISH_CRON_PATH);
  assert.ok(cron, "marketing-publish cron entry missing");
  assert.equal(cron.schedule, MARKETING_PUBLISH_CRON_SCHEDULE);
});
