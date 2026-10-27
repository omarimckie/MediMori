import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_MAX_PRIMARY_HEARTBEAT_AGE_MS,
  assertPrimaryHeartbeatFresh,
  loadVerifiedPrimaryActivationEvidence,
} from "./marketing-dispatcher-watchdog-activation-evidence.mjs";
import {
  buildDispatcherWatchdogActivationDryRunReport,
  executeDispatcherWatchdogActivation,
} from "./marketing-dispatcher-watchdog-activation-runner.mjs";
import {
  assertDispatcherWatchdogActivationAuthorized,
  DISPATCHER_WATCHDOG_ACTIVATION_ENV,
  isDispatcherWatchdogActivationDryRunReport,
  isDispatcherWatchdogActivationSnapshotReport,
  resolveDispatcherWatchdogActivationDatabaseTarget,
} from "./resolve-marketing-dispatcher-watchdog-activation-database-url.mjs";

const executeScriptPath = fileURLToPath(
  new URL("./execute-marketing-dispatcher-watchdog-activation.mjs", import.meta.url),
);

function baseTargetEnv(overrides = {}) {
  return {
    [DISPATCHER_WATCHDOG_ACTIVATION_ENV.APPLY_AUTHORIZED]: "execute",
    [DISPATCHER_WATCHDOG_ACTIVATION_ENV.DATABASE_URL]:
      "postgresql://migration_user:secret@tf-watchdog-act1.example/marketing_act",
    [DISPATCHER_WATCHDOG_ACTIVATION_ENV.EXPECTED_HOST]: "tf-watchdog-act1.example",
    [DISPATCHER_WATCHDOG_ACTIVATION_ENV.EXPECTED_DATABASE]: "marketing_act",
    ...overrides,
  };
}

function mockClientForValidEvidence(nowMs) {
  const primaryIso = new Date(nowMs - 5 * 60_000).toISOString();
  const seenIso = new Date(nowMs - 6 * 60_000).toISOString();
  return {
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, " ");
      if (normalized.includes("information_schema.tables")) {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
      if (normalized.includes("COUNT(*)::int AS c")) {
        return { rows: [{ c: 2 }], rowCount: 1 };
      }
      if (normalized.includes("SELECT jti, seen_at")) {
        return {
          rows: [{ jti: "jti-activation-1", seen_at: seenIso }],
          rowCount: 1,
        };
      }
      if (normalized.includes("FROM marketing_dispatcher_qstash_primary")) {
        return { rows: [{ last_seen_at: primaryIso }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

describe("dispatcher watchdog activation guards", () => {
  it("missing authorization fails closed", () => {
    assert.throws(
      () => assertDispatcherWatchdogActivationAuthorized({}),
      (error) => error.code === "dispatcher_watchdog_activation_not_authorized",
    );
  });

  it("DATABASE_URL alone is ignored", () => {
    assert.throws(
      () =>
        resolveDispatcherWatchdogActivationDatabaseTarget({
          DATABASE_URL: "postgresql://app:secret@prod.example/appdb",
        }),
      (error) => error.code === "dispatcher_watchdog_activation_url_missing",
    );
  });

  it("execute script does not reference .env.local", () => {
    const source = readFileSync(executeScriptPath, "utf8");
    assert.doesNotMatch(source, /\.env\.local/);
    assert.doesNotMatch(source, /process\.env\.DATABASE_URL/);
  });

  it("host mismatch fails closed", () => {
    assert.throws(
      () =>
        resolveDispatcherWatchdogActivationDatabaseTarget({
          ...baseTargetEnv(),
          [DISPATCHER_WATCHDOG_ACTIVATION_ENV.EXPECTED_HOST]: "wrong.example",
        }),
      (error) => error.code === "dispatcher_watchdog_activation_target_mismatch",
    );
  });

  it("dry-run without authorization", () => {
    const report = buildDispatcherWatchdogActivationDryRunReport({
      [DISPATCHER_WATCHDOG_ACTIVATION_ENV.DRY_RUN]: "report",
    });
    assert.equal(report.mode, "dry_run");
    assert.equal(report.databaseConnection, false);
    assert.equal(report.configuration.executeAuthorizationPresent, false);
  });

  it("dry-run execute path never connects", async () => {
    const result = await executeDispatcherWatchdogActivation({
      [DISPATCHER_WATCHDOG_ACTIVATION_ENV.DRY_RUN]: "report",
      [DISPATCHER_WATCHDOG_ACTIVATION_ENV.APPLY_AUTHORIZED]: "execute",
    });
    assert.ok(result.dryRun);
    assert.equal(result.dryRun.sqlExecuted, false);
  });

  it("dry-run and snapshot modes are distinct", () => {
    assert.equal(
      isDispatcherWatchdogActivationDryRunReport({
        [DISPATCHER_WATCHDOG_ACTIVATION_ENV.DRY_RUN]: "report",
      }),
      true,
    );
    assert.equal(
      isDispatcherWatchdogActivationSnapshotReport({
        [DISPATCHER_WATCHDOG_ACTIVATION_ENV.SNAPSHOT]: "report",
      }),
      true,
    );
  });

  it("missing schema fails closed", async () => {
    const client = {
      query: async (sql) => {
        if (String(sql).includes("information_schema.tables")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    await assert.rejects(
      () => loadVerifiedPrimaryActivationEvidence(client),
      (error) => error.code === "dispatcher_watchdog_activation_schema_missing",
    );
  });

  it("missing verified delivery fails closed", async () => {
    const client = {
      query: async (sql) => {
        if (String(sql).includes("information_schema.tables")) {
          return { rows: [{ "?column?": 1 }], rowCount: 1 };
        }
        if (String(sql).includes("COUNT(*)")) {
          return { rows: [{ c: 0 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    await assert.rejects(
      () => loadVerifiedPrimaryActivationEvidence(client),
      (error) => error.code === "dispatcher_watchdog_activation_no_verified_delivery",
    );
  });

  it("stale heartbeat fails closed", () => {
    const staleIso = new Date(
      Date.now() - ACTIVATION_MAX_PRIMARY_HEARTBEAT_AGE_MS - 1000,
    ).toISOString();
    assert.throws(
      () => assertPrimaryHeartbeatFresh(staleIso),
      (error) => error.code === "dispatcher_watchdog_activation_heartbeat_stale",
    );
  });

  it("valid verified evidence is derived from durable records", async () => {
    const nowMs = Date.UTC(2026, 9, 19, 12, 0, 0);
    const evidence = await loadVerifiedPrimaryActivationEvidence(
      mockClientForValidEvidence(nowMs),
      { nowMs },
    );
    assert.equal(evidence.verificationKind, "qstash_signature_verified");
    assert.equal(evidence.attestationId, "jti-activation-1");
    assert.ok(evidence.verifiedAt);
    assert.ok(evidence.primaryHeartbeatAgeMs <= ACTIVATION_MAX_PRIMARY_HEARTBEAT_AGE_MS);
  });

  it("evidence unlink fails closed", async () => {
    const nowMs = Date.UTC(2026, 9, 19, 12, 0, 0);
    const primaryIso = new Date(nowMs - 5 * 60_000).toISOString();
    const client = {
      async query(sql) {
        const normalized = String(sql).replace(/\s+/g, " ");
        if (normalized.includes("information_schema.tables")) {
          return { rows: [{ "?column?": 1 }], rowCount: 1 };
        }
        if (normalized.includes("COUNT(*)")) {
          return { rows: [{ c: 1 }], rowCount: 1 };
        }
        if (normalized.includes("FROM marketing_dispatcher_qstash_primary")) {
          return { rows: [{ last_seen_at: primaryIso }], rowCount: 1 };
        }
        if (normalized.includes("FROM marketing_dispatcher_qstash_verified_deliveries")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    await assert.rejects(
      () => loadVerifiedPrimaryActivationEvidence(client, { nowMs }),
      (error) => error.code === "dispatcher_watchdog_activation_evidence_unlinked",
    );
  });
});
