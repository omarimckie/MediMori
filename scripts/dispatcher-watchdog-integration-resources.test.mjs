import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RunResourceLedger,
  assertOwnedResourceName,
  resourceNamesForRun,
  validateRunId,
} from "./dispatcher-watchdog-integration-resources.mjs";

describe("dispatcher watchdog integration resource ledger", () => {
  it("builds deterministic resource names", () => {
    const names = resourceNamesForRun("run-abc123");
    assert.equal(names.postgresContainer, "tf-watchdog-pg-run-abc123");
    assert.equal(names.network, "tf-watchdog-net-run-abc123");
  });

  it("rejects cleanup of unrelated resource names", () => {
    assert.throws(
      () => assertOwnedResourceName("run-abc123", "tf-watchdog-pg-other", "container"),
      /cleanup_resource_not_owned/,
    );
  });

  it("verifies cleanup completion", () => {
    const ledger = new RunResourceLedger(validateRunId("run-abc123"));
    ledger.registerContainer("id1", ledger.names.postgresContainer);
    ledger.verifyCleanupComplete({ containers: [], networks: [], volumes: [] });
    assert.throws(
      () => ledger.verifyCleanupComplete({ containers: ["left"], networks: [], volumes: [] }),
      /cleanup_incomplete/,
    );
  });
});
