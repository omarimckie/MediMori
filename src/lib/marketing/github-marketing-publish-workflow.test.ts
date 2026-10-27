import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const WORKFLOW_PATH = join(
  process.cwd(),
  ".github/workflows/marketing-publish-dispatch.yml",
);

test("marketing publish dispatch workflow is manual-only emergency dispatcher", () => {
  const source = readFileSync(WORKFLOW_PATH, "utf8");
  assert.doesNotMatch(source, /^\s*schedule:/m);
  assert.doesNotMatch(source, /cron:\s*"/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /QStash/i);
  assert.match(source, /\/api\/cron\/marketing-publish/);
  assert.match(source, /secrets\.CRON_SECRET/);
  assert.match(source, /vars\.MARKETING_PUBLISH_BASE_URL/);
  assert.match(source, /group: marketing-publish-dispatch/);
  assert.doesNotMatch(source, /Bearer [A-Za-z0-9]{8,}/);
});
