import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const root = path.join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

test("analytics dashboard route is admin-gated read-only GET", () => {
  const source = read("app/api/admin/marketing/analytics/route.ts");
  assert.match(source, /requireMarketingAdmin/);
  assert.match(source, /export async function GET/);
  assert.match(source, /buildMarketingAnalyticsDashboard/);
  assert.match(source, /Cache-Control.*no-store/);
  assert.doesNotMatch(source, /requireMarketingAdminMutation/);
  assert.doesNotMatch(source, /recordClick/);
  assert.doesNotMatch(source, /sendMarketingAdminBroadcastNotification/);
  assert.doesNotMatch(source, /POST\s*\(/);
});

test("prior-day analytics route previews push payload without delivering", () => {
  const source = read("app/api/admin/marketing/analytics/prior-day/route.ts");
  assert.match(source, /requireMarketingAdmin/);
  assert.match(source, /deliverable:\s*false/);
  assert.match(source, /buildPriorDayAnalyticsNotificationPayload/);
  assert.doesNotMatch(source, /runMorningBriefDeliveryIfDue/);
  assert.doesNotMatch(source, /sendMarketingAdminBroadcastNotification/);
  assert.doesNotMatch(source, /deliverPush:\s*true/);
});

test("analytics aggregation does not import publishing modules", () => {
  const source = read("lib/marketing/analytics/analytics-aggregation.ts");
  assert.doesNotMatch(source, /from "\.\.\/publishers"/);
  assert.doesNotMatch(source, /publishPublication/);
});
