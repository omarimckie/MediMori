import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const WORKFLOW_PATH = join(
  process.cwd(),
  ".github/workflows/credential-health-dispatch.yml",
);

test("credential health dispatch workflow posts to credential-health cron", () => {
  const source = readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(source, /schedule:/);
  assert.match(source, /\/api\/cron\/credential-health/);
  assert.match(source, /secrets\.CRON_SECRET/);
  assert.match(source, /vars\.MARKETING_PUBLISH_BASE_URL/);
  assert.match(source, /group: credential-health-dispatch/);
  assert.match(source, /Vercel Hobby/i);
  assert.doesNotMatch(source, /Bearer [A-Za-z0-9]{8,}/);
});
