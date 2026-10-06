import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cronAuthDecision } from "./config";
import { recordMarketingPublishDispatcherHeartbeat } from "./marketing-cron";

test("authorized publish cron path is wired to record heartbeat after publishDue", () => {
  const route = readFileSync("src/app/api/cron/marketing-publish/route.ts", "utf8");
  assert.match(route, /publishDue/);
  assert.match(route, /recordMarketingPublishDispatcherHeartbeat/);
  assert.match(route, /publishedCount: results\.length/);
  assert.doesNotMatch(route, /sendMarketingNotification/);
});

test("cron auth accepts bearer secret and admin session", () => {
  const bearer = cronAuthDecision({
    isProduction: true,
    cronSecret: "secret",
    authorizationHeader: "Bearer secret",
    isAdmin: false,
  });
  assert.equal(bearer.ok, true);

  const admin = cronAuthDecision({
    isProduction: true,
    cronSecret: "secret",
    authorizationHeader: null,
    isAdmin: true,
  });
  assert.equal(admin.ok, true);
});

test("recordMarketingPublishDispatcherHeartbeat skips DB write when unauthorized", async () => {
  const source = await recordMarketingPublishDispatcherHeartbeat({
    request: new Request("https://example.com"),
    auth: { ok: false, reason: "unauthorized" },
    publishedCount: 0,
  });
  assert.equal(source, "unknown");
});
