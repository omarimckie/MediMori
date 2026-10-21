import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("dispatcher watchdog workflow schedule, manual dispatch, auth, and healthchecks contract", () => {
  const source = readFileSync(WATCHDOG_WORKFLOW, "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /schedule:/);
  assert.match(source, /cron:\s*"\*\/15 \* \* \* \*"/);
  const cron = source.match(/cron:\s*"([^"]+)"/);
  assert.ok(cron);
  const fields = cron[1].trim().split(/\s+/);
  assert.deepEqual(fields, ["*/15", "*", "*", "*", "*"]);
  assert.equal(fields.length, 5);
  assert.match(source, /\/api\/cron\/marketing-dispatcher-watchdog/);
  assert.match(source, /secrets\.DISPATCHER_WATCHDOG_SECRET/);
  assert.match(source, /vars\.MARKETING_DISPATCHER_WATCHDOG_BASE_URL/);
  assert.match(source, /secrets\.HEALTHCHECKS_DISPATCHER_WATCHDOG_PING_URL/);
  assert.match(source, /Healthchecks ping skipped/);
  assert.match(
    source,
    /if \[ -z "\$\{HEALTHCHECKS_DISPATCHER_WATCHDOG_PING_URL\}" \]; then[\s\S]*exit 0/,
  );
  assert.match(source, /curl -fsS --max-time 30 --retry 2/);
  assert.doesNotMatch(source, /continue-on-error:\s*true/);
  assert.doesNotMatch(source, /if:\s*always\(\)/);
  const tickAt = source.indexOf("- name: POST /api/cron/marketing-dispatcher-watchdog");
  const pingAt = source.indexOf("- name: Healthchecks.io success ping");
  assert.ok(tickAt >= 0 && pingAt > tickAt);
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

const PING_SENTINEL = "https://hc-ping.example/secret-token-do-not-log";

function extractRunScript(source: string, stepName: string): string {
  const start = source.indexOf(`- name: ${stepName}`);
  assert.ok(start >= 0, stepName);
  const after = source.slice(start);
  const runAt = after.indexOf("run: |");
  assert.ok(runAt >= 0, `${stepName} run`);
  const bodyStart = runAt + "run: |".length;
  const next = after.indexOf("\n      - name:", bodyStart);
  const raw = after.slice(bodyStart, next === -1 ? undefined : next);
  return `${raw
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n")
    .trim()}\n`;
}

const BASH = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";

function runWorkflowScript(
  script: string,
  env: Record<string, string>,
  curlBody: string,
): { status: number; stdout: string; curlLog: string } {
  const setup = spawnSync(BASH, ["-lc", "mktemp -d"], { encoding: "utf8" });
  const dir = (setup.stdout ?? "").trim();
  assert.equal(setup.status ?? 1, 0, setup.stderr ?? "mktemp failed");
  const writer = spawnSync(
    BASH,
    ["-lc", "cat > \"$1/curl\" && chmod +x \"$1/curl\" && : > \"$1/curl.log\"", "setup", dir],
    { encoding: "utf8", input: curlBody },
  );
  assert.equal(writer.status ?? 1, 0, writer.stderr ?? "curl stub failed");
  const envAssign = Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  const result = spawnSync(
    BASH,
    ["-lc", `export PATH="$1:$PATH"; export CURL_LOG="$1/curl.log"; ${envAssign} bash -c "$2"`, "run", dir, script],
    { encoding: "utf8" },
  );
  const log = spawnSync(BASH, ["-lc", "cat \"$1/curl.log\"", "log", dir], { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    curlLog: log.stdout ?? "",
  };
}

const FAKE_CURL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CURL_LOG"
if [[ "$*" == *marketing-dispatcher-watchdog* ]]; then
  out=""
  prev=""
  for arg in "$@"; do
    if [[ "$prev" == "-o" ]]; then out="$arg"; fi
    prev="$arg"
  done
  code="\${WATCHDOG_HTTP_CODE:-200}"
  if [[ -n "$out" ]]; then
    if [[ "$code" == "200" ]]; then
      printf '%s' '{"ok":true,"outcome":"committed","observationSlotId":1}' > "$out"
    else
      printf '%s' '{"ok":false}' > "$out"
    fi
  fi
  printf '%s' "$code"
  exit 0
fi
exit "\${HC_CURL_EXIT:-0}"
`;

test("healthchecks shell skips when unset, pings when set, and fails closed", () => {
  const source = readFileSync(WATCHDOG_WORKFLOW, "utf8");
  const tick = extractRunScript(source, "POST /api/cron/marketing-dispatcher-watchdog");
  const ping = extractRunScript(source, "Healthchecks.io success ping");

  const skipped = runWorkflowScript(ping, { HEALTHCHECKS_DISPATCHER_WATCHDOG_PING_URL: "" }, FAKE_CURL);
  assert.equal(skipped.status, 0, skipped.stdout);
  assert.match(skipped.stdout, /Healthchecks ping skipped/);
  assert.equal(skipped.curlLog.trim(), "");
  assert.doesNotMatch(skipped.stdout, /secret-token-do-not-log/);

  const pinged = runWorkflowScript(
    ping,
    { HEALTHCHECKS_DISPATCHER_WATCHDOG_PING_URL: PING_SENTINEL, HC_CURL_EXIT: "0" },
    FAKE_CURL,
  );
  assert.equal(pinged.status, 0, pinged.stdout);
  assert.match(pinged.stdout, /Healthchecks ping succeeded/);
  assert.match(pinged.curlLog, /hc-ping\.example/);
  assert.doesNotMatch(pinged.stdout, /secret-token-do-not-log/);

  const pingFailed = runWorkflowScript(
    ping,
    { HEALTHCHECKS_DISPATCHER_WATCHDOG_PING_URL: PING_SENTINEL, HC_CURL_EXIT: "22" },
    FAKE_CURL,
  );
  assert.notEqual(pingFailed.status, 0);
  assert.doesNotMatch(pingFailed.stdout, /Healthchecks ping succeeded/);
  assert.doesNotMatch(pingFailed.stdout, /secret-token-do-not-log/);

  const tickFailed = runWorkflowScript(
    tick,
    {
      MARKETING_DISPATCHER_WATCHDOG_BASE_URL: "https://twilight-feather.com",
      DISPATCHER_WATCHDOG_SECRET: "test-watchdog-secret",
      GITHUB_RUN_ID: "101",
      GITHUB_RUN_ATTEMPT: "1",
      WATCHDOG_HTTP_CODE: "500",
    },
    FAKE_CURL,
  );
  assert.notEqual(tickFailed.status, 0);
  assert.match(tickFailed.stdout, /Watchdog tick failed with HTTP 500/);
  assert.doesNotMatch(tickFailed.stdout, /test-watchdog-secret/);
  assert.doesNotMatch(source, /^\s*continue-on-error:/m);
});
