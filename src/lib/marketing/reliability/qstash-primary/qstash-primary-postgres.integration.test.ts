import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Pool } from "@neondatabase/serverless";
import { isDispatcherWatchdogIntegrationConfigured } from "../../../../../scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs";
import { createDisposableWatchdogPgPool } from "../dispatcher-watchdog/disposable-postgres-pool";
import { QSTASH_PRIMARY_ADVISORY_LOCK_KEY, QSTASH_PRIMARY_ROW_ID } from "./constants";
import {
  loadVerifiedPrimaryLastSeenAt,
  recordVerifiedPrimaryHeartbeat,
  recordVerifiedPrimaryHeartbeatInLock,
} from "./persistence";
import {
  applyQstashPrimarySchema,
  countQstashTable,
  createDisposableCredentialHealthSourceLockRunner,
  createQstashPrimaryTransaction,
  DISPOSABLE_PG_ADVISORY_LOCK_TIMEOUT_MS,
  truncateQstashPrimaryTables,
} from "./postgres-integration-helpers";

const integrationEnabled = isDispatcherWatchdogIntegrationConfigured();

describe(
  "qstash primary postgres integration (disposable DB)",
  { skip: !integrationEnabled },
  () => {
    let pool: Pool;
    let runTx: ReturnType<typeof createQstashPrimaryTransaction>;
    let runLocked: ReturnType<typeof createDisposableCredentialHealthSourceLockRunner>;

    before(async () => {
      const { resolveMarketingDispatcherWatchdogTestDatabaseUrl } = await import(
        "../../../../../scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs"
      );
      const connectionString = resolveMarketingDispatcherWatchdogTestDatabaseUrl();
      const expectedHost = process.env.MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST?.trim();
      assert.ok(expectedHost, "MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST is required");
      assert.match(connectionString, new RegExp(`@${expectedHost}[:/]`));
      pool = createDisposableWatchdogPgPool(connectionString);
      runTx = createQstashPrimaryTransaction(pool);
      runLocked = createDisposableCredentialHealthSourceLockRunner(pool);
    });

    after(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await truncateQstashPrimaryTables(pool);
      await applyQstashPrimarySchema(pool);
    });

    it("1 fresh QStash schema creates required tables", async () => {
      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN (
             'marketing_dispatcher_qstash_primary',
             'marketing_dispatcher_qstash_verified_deliveries'
           )
         ORDER BY table_name`,
      );
      assert.deepEqual(
        tables.rows.map((row) => row.table_name),
        [
          "marketing_dispatcher_qstash_primary",
          "marketing_dispatcher_qstash_verified_deliveries",
        ],
      );
    });

    it("2 migration idempotency re-applies without error", async () => {
      await applyQstashPrimarySchema(pool);
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_primary"), 0);
    });

    it("3 first verified jti advances primary heartbeat", async () => {
      const result = await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, { jti: "jwt_first_accepted" }),
      );
      assert.equal(result.outcome, "advanced");
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_verified_deliveries"), 1);
      const client = await pool.connect();
      try {
        const lastSeen = await loadVerifiedPrimaryLastSeenAt(client);
        assert.ok(lastSeen);
      } finally {
        client.release();
      }
    });

    it("4 duplicate jti does not advance heartbeat", async () => {
      const first = await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, { jti: "jwt_dup" }),
      );
      const second = await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, { jti: "jwt_dup" }),
      );
      assert.equal(first.outcome, "advanced");
      assert.equal(second.outcome, "duplicate_jti");
      assert.equal(second.lastSeenAt, first.lastSeenAt);
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_verified_deliveries"), 1);
    });

    it("5 duplicate jti with changed untrusted message id remains duplicate", async () => {
      await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, {
          jti: "jwt_meta",
          untrustedMessageId: "msg-a",
        }),
      );
      const second = await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, {
          jti: "jwt_meta",
          untrustedMessageId: "msg-b-forged",
        }),
      );
      assert.equal(second.outcome, "duplicate_jti");
      const row = await pool.query(
        `SELECT untrusted_message_id FROM marketing_dispatcher_qstash_verified_deliveries WHERE jti = $1`,
        ["jwt_meta"],
      );
      assert.equal(row.rows[0]?.untrusted_message_id, "msg-a");
    });

    it("6 distinct jti values with identical bodies are accepted", async () => {
      const a = await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, { jti: "jwt_body_a" }),
      );
      const b = await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, { jti: "jwt_body_b" }),
      );
      assert.equal(a.outcome, "advanced");
      assert.equal(b.outcome, "advanced");
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_verified_deliveries"), 2);
    });

    it("7 concurrent duplicate jti across connections yields one advancement", async () => {
      const client1 = await pool.connect();
      const client2 = await pool.connect();
      try {
        const results = await Promise.all([
          (async () => {
            await client1.query("BEGIN");
            try {
              return await recordVerifiedPrimaryHeartbeat(client1, { jti: "jwt_race_dup" });
            } finally {
              await client1.query("COMMIT");
            }
          })(),
          (async () => {
            await client2.query("BEGIN");
            try {
              return await recordVerifiedPrimaryHeartbeat(client2, { jti: "jwt_race_dup" });
            } finally {
              await client2.query("COMMIT");
            }
          })(),
        ]);
        const advanced = results.filter((row) => row.outcome === "advanced");
        const duplicate = results.filter((row) => row.outcome === "duplicate_jti");
        assert.equal(advanced.length, 1);
        assert.equal(duplicate.length, 1);
        assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_verified_deliveries"), 1);
      } finally {
        client1.release();
        client2.release();
      }
    });

    it("8 concurrent distinct jti values keep monotonic primary timestamp", async () => {
      const client1 = await pool.connect();
      const client2 = await pool.connect();
      try {
        const [a, b] = await Promise.all([
          (async () => {
            await client1.query("BEGIN");
            try {
              return await recordVerifiedPrimaryHeartbeat(client1, { jti: "jwt_race_a" });
            } finally {
              await client1.query("COMMIT");
            }
          })(),
          (async () => {
            await client2.query("BEGIN");
            try {
              return await recordVerifiedPrimaryHeartbeat(client2, { jti: "jwt_race_b" });
            } finally {
              await client2.query("COMMIT");
            }
          })(),
        ]);
        assert.equal(a.outcome, "advanced");
        assert.equal(b.outcome, "advanced");
        assert.ok(Date.parse(b.lastSeenAt) >= Date.parse(a.lastSeenAt));
      } finally {
        client1.release();
        client2.release();
      }
    });

    it("9 rollback after deduplication insert removes jti and primary changes", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await recordVerifiedPrimaryHeartbeat(client, { jti: "jwt_rollback" });
        await client.query(`SELECT * FROM marketing_dispatcher_qstash_missing_probe`);
        await client.query("COMMIT");
        assert.fail("expected rollback path");
      } catch {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_verified_deliveries"), 0);
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_primary"), 0);
    });

    it("10 primary singleton row uses fixed id", async () => {
      await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, { jti: "jwt_singleton" }),
      );
      const row = await pool.query(
        `SELECT id FROM marketing_dispatcher_qstash_primary`,
      );
      assert.equal(row.rows.length, 1);
      assert.equal(row.rows[0]?.id, QSTASH_PRIMARY_ROW_ID);
    });

    it("11 monotonic last_seen_at across committed transactions", async () => {
      const first = await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, { jti: "jwt_mono_1" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, { jti: "jwt_mono_2" }),
      );
      assert.ok(Date.parse(second.lastSeenAt) >= Date.parse(first.lastSeenAt));
    });

    it("12 delivery seen_at is database-authoritative", async () => {
      const before = Date.now();
      await runTx((client) =>
        recordVerifiedPrimaryHeartbeat(client, { jti: "jwt_seen_at" }),
      );
      const after = Date.now();
      const row = await pool.query(
        `SELECT seen_at FROM marketing_dispatcher_qstash_verified_deliveries WHERE jti = $1`,
        ["jwt_seen_at"],
      );
      const seenMs = new Date(String(row.rows[0]?.seen_at)).getTime();
      assert.ok(seenMs >= before - 2_000);
      assert.ok(seenMs <= after + 2_000);
    });

    it("13 advisory lock blocks second session until first commits", async () => {
      const client1 = await pool.connect();
      const client2 = await pool.connect();
      try {
        await client1.query("BEGIN");
        await client1.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
          QSTASH_PRIMARY_ADVISORY_LOCK_KEY,
        ]);
        await client2.query("BEGIN");
        await client2.query("SET LOCAL lock_timeout = '500ms'");
        await assert.rejects(
          () =>
            client2.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
              QSTASH_PRIMARY_ADVISORY_LOCK_KEY,
            ]),
          /lock timeout|canceling statement/,
        );
        await client2.query("ROLLBACK");
        await client1.query("COMMIT");
      } finally {
        client1.release();
        client2.release();
      }
    });

    it("14 migration parser enforces three schema statements", async () => {
      const { parseMarketingDispatcherQstashPrimaryMigrationStatements } = await import(
        "../../../../../scripts/apply-marketing-dispatcher-qstash-primary-schema.mjs"
      );
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const sqlPath = fileURLToPath(
        new URL("../../../../../sql/marketing-dispatcher-qstash-primary.sql", import.meta.url),
      );
      const statements = parseMarketingDispatcherQstashPrimaryMigrationStatements(
        readFileSync(sqlPath, "utf8"),
      );
      assert.equal(statements.length, 3);
    });

    it("15 unique constraint rejects raw duplicate jti insert", async () => {
      await pool.query(
        `INSERT INTO marketing_dispatcher_qstash_verified_deliveries (jti) VALUES ($1)`,
        ["jwt_unique"],
      );
      await assert.rejects(
        () =>
          pool.query(
            `INSERT INTO marketing_dispatcher_qstash_verified_deliveries (jti) VALUES ($1)`,
            ["jwt_unique"],
          ),
        /duplicate key|unique constraint/i,
      );
    });

    it("16 connection cleanup after query error releases client", async () => {
      const client = await pool.connect();
      try {
        await assert.rejects(() => client.query(`SELECT * FROM marketing_dispatcher_qstash_missing_probe`));
      } finally {
        client.release();
      }
      const probe = await pool.query(`SELECT 1 AS ok`);
      assert.equal(probe.rows[0]?.ok, 1);
    });

    it("H1-1 locked entry point advances first verified jti with production lock key", async () => {
      let observedLockKey: string | null = null;
      const tracingRunner = async <T,>(
        source: string,
        fn: (client: import("@neondatabase/serverless").PoolClient) => Promise<T>,
      ) => {
        observedLockKey = source;
        return runLocked(source, fn);
      };
      const result = await recordVerifiedPrimaryHeartbeatInLock(
        { jti: "jwt_h1_first_locked" },
        { runLocked: tracingRunner },
      );
      assert.equal(result.outcome, "advanced");
      assert.equal(observedLockKey, QSTASH_PRIMARY_ADVISORY_LOCK_KEY);
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_verified_deliveries"), 1);
      const client = await pool.connect();
      try {
        const lastSeen = await loadVerifiedPrimaryLastSeenAt(client);
        assert.ok(lastSeen);
      } finally {
        client.release();
      }
    });

    it("H1-2 locked entry point duplicate jti does not advance primary", async () => {
      const first = await recordVerifiedPrimaryHeartbeatInLock(
        { jti: "jwt_h1_dup_locked" },
        { runLocked },
      );
      const second = await recordVerifiedPrimaryHeartbeatInLock(
        { jti: "jwt_h1_dup_locked" },
        { runLocked },
      );
      assert.equal(first.outcome, "advanced");
      assert.equal(second.outcome, "duplicate_jti");
      assert.equal(second.lastSeenAt, first.lastSeenAt);
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_verified_deliveries"), 1);
    });

    it("H1-3 locked entry point concurrent duplicate jti yields one advancement", async () => {
      const results = await Promise.all([
        recordVerifiedPrimaryHeartbeatInLock({ jti: "jwt_h1_race_locked" }, { runLocked }),
        recordVerifiedPrimaryHeartbeatInLock({ jti: "jwt_h1_race_locked" }, { runLocked }),
      ]);
      const advanced = results.filter((row) => row.outcome === "advanced");
      const duplicate = results.filter((row) => row.outcome === "duplicate_jti");
      assert.equal(advanced.length, 1);
      assert.equal(duplicate.length, 1);
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_verified_deliveries"), 1);
    });

    it("H1-4 locked entry point rolls back delivery and primary on post-persist failure", async () => {
      const failingRunner = async <T,>(
        source: string,
        fn: (client: import("@neondatabase/serverless").PoolClient) => Promise<T>,
      ) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [source]);
          const result = await fn(client);
          await client.query(`SELECT * FROM marketing_dispatcher_qstash_missing_probe`);
          await client.query("COMMIT");
          return result;
        } catch {
          await client.query("ROLLBACK");
          throw new Error("h1_rollback_probe");
        } finally {
          client.release();
        }
      };
      await assert.rejects(
        () =>
          recordVerifiedPrimaryHeartbeatInLock(
            { jti: "jwt_h1_rollback_locked" },
            { runLocked: failingRunner },
          ),
        /h1_rollback_probe/,
      );
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_verified_deliveries"), 0);
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_primary"), 0);
      const probe = await pool.query(`SELECT 1 AS ok`);
      assert.equal(probe.rows[0]?.ok, 1);
    });

    it("H1-5 locked entry point serializes concurrent calls on production lock key", async () => {
      const client1 = await pool.connect();
      const client2 = await pool.connect();
      try {
        await client1.query("BEGIN");
        await client1.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
          QSTASH_PRIMARY_ADVISORY_LOCK_KEY,
        ]);
        await client2.query("BEGIN");
        await client2.query(
          `SET LOCAL lock_timeout = '${DISPOSABLE_PG_ADVISORY_LOCK_TIMEOUT_MS}ms'`,
        );
        await assert.rejects(
          () =>
            client2.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
              QSTASH_PRIMARY_ADVISORY_LOCK_KEY,
            ]),
          /lock timeout|canceling statement/,
        );
        await client2.query("ROLLBACK");
        await client1.query("COMMIT");
      } finally {
        client1.release();
        client2.release();
      }
      const a = await recordVerifiedPrimaryHeartbeatInLock({ jti: "jwt_h1_lock_a" }, { runLocked });
      const b = await recordVerifiedPrimaryHeartbeatInLock({ jti: "jwt_h1_lock_b" }, { runLocked });
      assert.equal(a.outcome, "advanced");
      assert.equal(b.outcome, "advanced");
      assert.equal(await countQstashTable(pool, "marketing_dispatcher_qstash_verified_deliveries"), 2);
    });
  },
);
