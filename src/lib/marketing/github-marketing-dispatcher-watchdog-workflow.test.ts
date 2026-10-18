import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const WATCHDOG_WORKFLOW = join(
  process.cwd(),
  ".github/workflows/marketing-dispatcher-watchdog.yml",
);
const PUBLISH_WORKFLOW = join(
  process.cwd(),
  ".github/workflows/marketing-publish-dispatch.yml",
);

test("dispatcher watchdog workflow schedule, auth, and healthchecks contract", () => {
  const source = readFileSync(WATCHDOG_WORKFLOW, "utf8");
  assert.match(source, /cron:\s*"\*\/15 \* \* \* \*"/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /\/api\/cron\/marketing-dispatcher-watchdog/);
  assert.match(source, /secrets\.DISPATCHER_WATCHDOG_SECRET/);
  assert.match(source, /vars\.MARKETING_DISPATCHER_WATCHDOG_BASE_URL/);
  assert.match(source, /secrets\.HEALTHCHECKS_DISPATCHER_WATCHDOG_PING_URL/);
  assert.match(source, /x-github-run-id:/i);
  assert.match(source, /x-github-run-attempt:/i);
  assert.match(source, /group: marketing-dispatcher-watchdog/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /--max-time 120/);
  assert.match(source, /body\?\.ok !== true/);
  assert.match(source, /allowedOutcomes/);
  assert.match(source, /Healthchecks\.io success ping/);
  assert.doesNotMatch(source, /CRON_SECRET/);
  assert.doesNotMatch(source, /\/api\/cron\/marketing-publish/);
  assert.doesNotMatch(source, /Bearer [A-Za-z0-9]{12,}/);
  assert.doesNotMatch(source, /hc-ping\.io\/[a-f0-9-]+/i);
  assert.match(source, /default branch/i);
  assert.match(source, /ignored_not_activated/);
});

test("orchestration doc warns on default branch schedule and Healthchecks scope", () => {
  const doc = readFileSync(
    join(process.cwd(), "docs/marketing-dispatcher-watchdog-orchestration.md"),
    "utf8",
  );
  assert.match(doc, /default branch/i);
  assert.match(doc, /recordPrimaryQstashActivation/);
  assert.match(doc, /does not mean/i);
  assert.match(doc, /marketing-publish/);
});

test("marketing publish dispatch workflow remains manual-only", () => {
  const publish = readFileSync(PUBLISH_WORKFLOW, "utf8");
  assert.doesNotMatch(publish, /marketing-dispatcher-watchdog/);
});
