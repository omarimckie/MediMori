import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPROVED_INTEGRATION_POSTGRES_IMAGE_REF,
  APPROVED_INTEGRATION_RUNNER_IMAGE_REF,
  assertPinnedImageReference,
  buildDisposableIntegrationEnv,
  normalizeRepoPath,
} from "./dispatcher-watchdog-integration-wrapper-lib.mjs";

describe("dispatcher watchdog integration wrapper lib", () => {
  it("requires sha256 digest pins", () => {
    assert.throws(
      () => assertPinnedImageReference("postgres:16", "postgres"),
      /integration_image_digest_missing/,
    );
    const ok = assertPinnedImageReference(APPROVED_INTEGRATION_POSTGRES_IMAGE_REF, "postgres");
    assert.equal(ok, APPROVED_INTEGRATION_POSTGRES_IMAGE_REF);
    assert.match(ok, /^postgres@sha256:/);
  });

  it("builds disposable integration env triple-bind", () => {
    const env = buildDisposableIntegrationEnv({
      runId: "run1",
      pgUser: "u",
      pgPassword: "p",
      pgDatabase: "db",
    });
    assert.equal(env.MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID, "run1");
    assert.equal(env.MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST, "tf-watchdog-pg-run1");
    assert.match(env.MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL, /@tf-watchdog-pg-run1:5432\/db/);
  });

  it("normalizes repo paths", () => {
    assert.equal(normalizeRepoPath("D:\\marketing-autopilot"), "d:/marketing-autopilot");
  });

  it("rejects compound node:22@digest runner pins", () => {
    assert.throws(
      () =>
        assertPinnedImageReference(
          "node:22@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "runner",
        ),
      /integration_image_compound_reference_rejected:runner/,
    );
    assert.throws(
      () =>
        assertPinnedImageReference(
          "node:22-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "runner",
        ),
      /integration_image_compound_reference_rejected:runner/,
    );
    const ok = assertPinnedImageReference(APPROVED_INTEGRATION_RUNNER_IMAGE_REF, "runner");
    assert.equal(ok, APPROVED_INTEGRATION_RUNNER_IMAGE_REF);
  });
});
