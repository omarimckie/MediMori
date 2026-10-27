import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const RETRY_WORKFLOW_PATH = join(
  process.cwd(),
  ".github/workflows/order-notification-retry.yml",
);
const MARKETING_WORKFLOW_PATH = join(
  process.cwd(),
  ".github/workflows/marketing-publish-dispatch.yml",
);
const VERCEL_PATH = join(process.cwd(), "vercel.json");

test("order notification retry workflow is an independent scheduled dispatcher", () => {
  const source = readFileSync(RETRY_WORKFLOW_PATH, "utf8");

  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /schedule:/);
  assert.match(source, /cron:\s*"\*\/15 \* \* \* \*"/);
  assert.match(source, /\/api\/cron\/order-notifications/);
  assert.doesNotMatch(source, /\/api\/cron\/marketing-publish/);
  assert.doesNotMatch(source, /publishDue/);
  assert.match(source, /secrets\.CRON_SECRET/);
  assert.match(source, /vars\.MARKETING_PUBLISH_BASE_URL/);
  assert.match(source, /group: order-notification-retry/);
  assert.match(source, /cancel-in-progress:\s*false/);
  assert.match(source, /timeout-minutes:\s*5/);
  assert.match(source, /--max-time 60/);
  assert.match(source, /attempted - delivered/);
  assert.doesNotMatch(source, /Bearer [A-Za-z0-9]{8,}/);
  assert.doesNotMatch(source, /console\.log\([^)]*raw/);
  assert.doesNotMatch(source, /echo[^\n]*\$\{CRON_SECRET\}/);
});

test("marketing dispatcher and Vercel cron stay unchanged by order notification retry", () => {
  const marketing = readFileSync(MARKETING_WORKFLOW_PATH, "utf8");
  assert.doesNotMatch(marketing, /^\s*schedule:/m);
  assert.doesNotMatch(marketing, /cron:\s*"/);
  assert.match(marketing, /workflow_dispatch:/);
  assert.match(marketing, /\/api\/cron\/marketing-publish/);
  assert.doesNotMatch(marketing, /order-notifications/);
  assert.match(marketing, /group: marketing-publish-dispatch/);

  const vercel = JSON.parse(readFileSync(VERCEL_PATH, "utf8")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  assert.equal(vercel.crons?.length, 1);
  assert.equal(vercel.crons?.[0]?.path, "/api/cron/marketing-publish");
  assert.equal(vercel.crons?.[0]?.schedule, "0 16 * * *");
});
