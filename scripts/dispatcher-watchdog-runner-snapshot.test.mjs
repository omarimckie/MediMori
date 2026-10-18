import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  RUNNER_SOURCE_ALLOWLIST,
  assertAllowlistPathSafe,
  buildRunnerSourceSnapshot,
  isPathAllowedInRunnerSnapshot,
  validateForbiddenSnapshotPath,
} from "./dispatcher-watchdog-runner-snapshot.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("dispatcher watchdog runner snapshot allowlist", () => {
  it("rejects forbidden secret paths", () => {
    assert.equal(isPathAllowedInRunnerSnapshot(".env.local"), false);
    assert.throws(() => assertAllowlistPathSafe(".env.local"), /forbidden_basename/);
    const verdict = validateForbiddenSnapshotPath(repoRoot, ".env.local");
    assert.equal(verdict.allowed, false);
  });

  it("rejects traversal paths", () => {
    assert.throws(() => assertAllowlistPathSafe("../package.json"), /traversal/);
  });

  it("allows only explicit allowlisted files", () => {
    for (const rel of RUNNER_SOURCE_ALLOWLIST) {
      assert.equal(isPathAllowedInRunnerSnapshot(rel), true);
    }
    assert.equal(isPathAllowedInRunnerSnapshot("src/app/page.tsx"), false);
  });

  it("stages QStash primary schema apply repository-local import closure", () => {
    const qstashApply = "scripts/apply-marketing-dispatcher-qstash-primary-schema.mjs";
    const qstashResolver = "scripts/resolve-marketing-qstash-primary-schema-database-url.mjs";
    const stripComments = "scripts/apply-marketing-web-push-schema.mjs";
    const qstashSql = "sql/marketing-dispatcher-qstash-primary.sql";
    for (const required of [qstashApply, qstashResolver, stripComments, qstashSql]) {
      assert.ok(
        RUNNER_SOURCE_ALLOWLIST.includes(required),
        `missing allowlist entry: ${required}`,
      );
    }
    for (const rel of RUNNER_SOURCE_ALLOWLIST) {
      assert.doesNotMatch(rel, /^\.env/i);
      assert.doesNotMatch(rel, /\.env\./i);
    }
  });

  it("builds a curated snapshot directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-snapshot-"));
    try {
      const result = buildRunnerSourceSnapshot(dir, repoRoot);
      assert.equal(result.fileCount, RUNNER_SOURCE_ALLOWLIST.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
