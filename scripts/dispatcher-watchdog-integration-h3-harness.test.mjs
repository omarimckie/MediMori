import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { RUNNER_SOURCE_ALLOWLIST } from "./dispatcher-watchdog-runner-snapshot.mjs";
import {
  INTEGRATION_H3_SCHEMA_ONLY_ENV,
  INTEGRATION_H3_SCHEMA_ONLY_VALUE,
  isIntegrationH3SchemaOnlyMode,
} from "./dispatcher-watchdog-integration-image-preflight.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const wrapperPath = join(repoRoot, "scripts/run-dispatcher-watchdog-postgres-integration.ps1");

test("H3 schema integration file is on runner allowlist", () => {
  assert.ok(
    RUNNER_SOURCE_ALLOWLIST.includes("scripts/qstash-primary-schema-disposable.integration.test.mjs"),
  );
});

test("H3-only integration mode is opt-in via dedicated env", () => {
  assert.equal(isIntegrationH3SchemaOnlyMode({}), false);
  assert.equal(
    isIntegrationH3SchemaOnlyMode({
      [INTEGRATION_H3_SCHEMA_ONLY_ENV]: INTEGRATION_H3_SCHEMA_ONLY_VALUE,
    }),
    true,
  );
});

test("disposable wrapper preserves default 63-test argv and adds H3-only branch", () => {
  const source = readFileSync(wrapperPath, "utf8");
  assert.match(source, /MARKETING_DISPATCHER_WATCHDOG_INTEGRATION_H3_SCHEMA_ONLY/);
  assert.match(source, /qstash-primary-schema-disposable\.integration\.test\.mjs/);
  assert.match(source, /dispatcher-watchdog-postgres\.integration\.test\.ts/);
  assert.match(source, /qstash-primary-postgres\.integration\.test\.ts/);
});
