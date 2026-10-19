import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Pool } from "@neondatabase/serverless";
import { isDispatcherWatchdogIntegrationConfigured } from "../../../../../scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs";
import { createDisposableWatchdogPgPool } from "./disposable-postgres-pool";
import {
  activateQstash,
  applyIncidentsSchema,
  applyWatchdogSchema,
  atMinuteOffset,
  countTable,
  createIsolatedWatchdogRepository,
  freshLastSeen,
  staleLastSeen,
  truncateWatchdogTables,
} from "./postgres-integration-helpers";
import type { WatchdogRepository } from "./repository";
import type { PushClaimAcquireResult } from "./types";

const integrationEnabled = isDispatcherWatchdogIntegrationConfigured();

async function mustAcquireOutage(
  repo: WatchdogRepository,
  incidentId: string,
): Promise<string> {
  const result = await repo.tryAcquireOutagePushClaim(incidentId);
  assert.equal(result.status, "acquired");
  return result.claimNonce;
}

async function deliverOutageNotification(
  repo: WatchdogRepository,
  incidentId: string,
  now: Date,
  pushDelivered = 1,
) {
  const claimNonce = await mustAcquireOutage(repo, incidentId);
  return repo.recordOutagePushOutcome({
    incidentId,
    claimNonce,
    pushDelivered,
    now,
  });
}

function sortedAcquireStatuses(
  a: PushClaimAcquireResult,
  b: PushClaimAcquireResult,
): string[] {
  return [a.status, b.status].sort();
}

async function openOutageIncident(repo: WatchdogRepository): Promise<string> {
  await activateQstash(repo, atMinuteOffset(0));
  await repo.commitObservation({
    now: atMinuteOffset(0),
    primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
  });
  const opened = await repo.commitObservation({
    now: atMinuteOffset(15),
    primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
  });
  assert.ok(opened.openedIncidentId);
  return opened.openedIncidentId!;
}

async function resolveIncidentEpisode(repo: WatchdogRepository): Promise<void> {
  await repo.commitObservation({
    now: atMinuteOffset(30),
    primaryLastSeenAt: freshLastSeen(atMinuteOffset(30)),
  });
}

/** Ages notification.updated_at relative to PostgreSQL now() (not host clock). */
async function ageNotificationRowUpdatedAt(
  pool: Pool,
  incidentId: string,
  intervalAgo: string,
): Promise<void> {
  await pool.query(
    `UPDATE marketing_dispatcher_watchdog_incident_notifications
     SET updated_at = now() - $2::interval
     WHERE incident_id = $1::uuid`,
    [incidentId, intervalAgo],
  );
}

async function readNotificationColumns(
  pool: Pool,
  incidentId: string,
): Promise<Record<string, unknown>> {
  const result = await pool.query(
    `SELECT outage_push_claim_status,
            outage_push_claim_nonce,
            outage_push_attempt_started_at,
            outage_push_admin_notification_id,
            recovery_push_claim_status,
            recovery_push_claim_nonce,
            recovery_push_attempt_started_at,
            recovery_push_admin_notification_id,
            updated_at
     FROM marketing_dispatcher_watchdog_incident_notifications
     WHERE incident_id = $1::uuid`,
    [incidentId],
  );
  assert.ok(result.rows[0], "expected notification row");
  return result.rows[0] as Record<string, unknown>;
}

describe(
  "dispatcher watchdog postgres integration (disposable DB)",
  { skip: !integrationEnabled },
  () => {
    let pool: Pool;
    let repo: WatchdogRepository;

    before(async () => {
      const { resolveMarketingDispatcherWatchdogTestDatabaseUrl } = await import(
        "../../../../../scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs"
      );
      const connectionString = resolveMarketingDispatcherWatchdogTestDatabaseUrl();
      pool = createDisposableWatchdogPgPool(connectionString);
      repo = await createIsolatedWatchdogRepository(pool);
    });

    after(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await truncateWatchdogTables(pool);
      await applyIncidentsSchema(pool);
      await applyWatchdogSchema(pool);
      repo = await createIsolatedWatchdogRepository(pool);
    });

    it("1 schema initialization creates required tables", async () => {
      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name LIKE 'marketing_%'
         ORDER BY table_name`,
      );
      const names = new Set(tables.rows.map((r) => r.table_name));
      assert.ok(names.has("marketing_incidents"));
      assert.ok(names.has("marketing_incident_events"));
      assert.ok(names.has("marketing_dispatcher_watchdog_state"));
      assert.ok(names.has("marketing_dispatcher_watchdog_observations"));
      assert.ok(names.has("marketing_dispatcher_watchdog_incident_notifications"));
      assert.ok(names.has("marketing_dispatcher_maintenance_windows"));
    });

    it("2 migration idempotency re-applies without error", async () => {
      await applyIncidentsSchema(pool);
      await applyWatchdogSchema(pool);
      assert.equal(await countTable(pool, "marketing_dispatcher_watchdog_state"), 0);
    });

    it("3 singleton watchdog state initialization", async () => {
      const a = await repo.ensureInitialized(atMinuteOffset(0));
      const b = await repo.ensureInitialized(atMinuteOffset(0));
      assert.equal(a.id, "primary");
      assert.equal(b.id, "primary");
      assert.equal(await countTable(pool, "marketing_dispatcher_watchdog_state"), 1);
    });

    it("4 advisory lock serializes concurrent transactions", async () => {
      const client1 = await pool.connect();
      const client2 = await pool.connect();
      try {
        await client1.query("BEGIN");
        await client1.query(`SELECT pg_advisory_xact_lock(hashtext('marketing_dispatcher_watchdog'))`);
        await client2.query("BEGIN");
        await client2.query("SET LOCAL lock_timeout = '300ms'");
        await assert.rejects(
          () =>
            client2.query(
              `SELECT pg_advisory_xact_lock(hashtext('marketing_dispatcher_watchdog'))`,
            ),
          /lock timeout|canceling statement/,
        );
        await client2.query("ROLLBACK");
        await client1.query("COMMIT");
      } finally {
        client1.release();
        client2.release();
      }
    });

    it("5 concurrent observations on different slots both commit", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      const [a, b] = await Promise.all([
        repo.commitObservation({
          now: atMinuteOffset(0),
          primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
        }),
        repo.commitObservation({
          now: atMinuteOffset(15),
          primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
        }),
      ]);
      assert.equal(a.outcome, "committed");
      assert.equal(b.outcome, "committed");
      assert.equal(await countTable(pool, "marketing_dispatcher_watchdog_observations"), 2);
    });

    it("6 SELECT FOR UPDATE serializes state updates", async () => {
      await repo.ensureInitialized(atMinuteOffset(0));
      const c1 = await pool.connect();
      const c2 = await pool.connect();
      try {
        await c1.query("BEGIN");
        await c1.query(
          `SELECT * FROM marketing_dispatcher_watchdog_state WHERE id = 'primary' FOR UPDATE`,
        );
        await c2.query("BEGIN");
        await c2.query("SET LOCAL lock_timeout = '300ms'");
        await assert.rejects(
          () =>
            c2.query(
              `SELECT * FROM marketing_dispatcher_watchdog_state WHERE id = 'primary' FOR UPDATE`,
            ),
          /lock timeout|canceling statement/,
        );
        await c2.query("ROLLBACK");
        await c1.query("COMMIT");
      } finally {
        c1.release();
        c2.release();
      }
    });

    it("7 duplicate slot rejected in database", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const dup = await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      assert.equal(dup.outcome, "duplicate_slot");
      assert.equal(await countTable(pool, "marketing_dispatcher_watchdog_observations"), 1);
    });

    it("8 late slot rejected", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      const late = await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      assert.equal(late.outcome, "ignored_late_slot");
    });

    it("9 monotonic high-water mark", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(30),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(30)),
      });
      const hwm = (await repo.getState()).lastCommittedObservationSlotId;
      await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      assert.equal((await repo.getState()).lastCommittedObservationSlotId, hwm);
    });

    it("10 repository commitObservation rolls back observation persistence", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      const faultRepo = await createIsolatedWatchdogRepository(pool, {
        failAfterSqlMatching: /INSERT INTO marketing_dispatcher_watchdog_observations/i,
      });
      await assert.rejects(
        () =>
          faultRepo.commitObservation({
            now: atMinuteOffset(0),
            primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
          }),
        /integration_fault_injection_after_query/,
      );
      assert.equal(await countTable(pool, "marketing_dispatcher_watchdog_observations"), 0);
      assert.equal((await repo.getState()).consecutiveStaleObservations, 0);
    });

    it("11 repository commitObservation rolls back incident persistence", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const faultRepo = await createIsolatedWatchdogRepository(pool, {
        failAfterSqlMatching: /INSERT INTO marketing_incidents/i,
      });
      await assert.rejects(
        () =>
          faultRepo.commitObservation({
            now: atMinuteOffset(15),
            primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
          }),
        /integration_fault_injection_after_query/,
      );
      assert.equal(await countTable(pool, "marketing_incidents"), 0);
      assert.equal(
        await countTable(pool, "marketing_dispatcher_watchdog_incident_notifications"),
        0,
      );
      assert.equal((await repo.getState()).consecutiveStaleObservations, 1);
      assert.equal(await countTable(pool, "marketing_dispatcher_watchdog_observations"), 1);
    });

    it("12 foreign-key enforcement on notification rows", async () => {
      await assert.rejects(
        () =>
          pool.query(
            `INSERT INTO marketing_dispatcher_watchdog_incident_notifications (incident_id)
             VALUES ($1::uuid)`,
            [crypto.randomUUID()],
          ),
        /violates foreign key constraint/,
      );
    });

    it("13 outage after two stale observations", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const second = await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      assert.ok(second.openedIncidentId);
      assert.equal(await countTable(pool, "marketing_incidents"), 1);
    });

    it("14 recovery resolves incident", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const opened = await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      const incidentId = opened.openedIncidentId!;
      await repo.commitObservation({
        now: atMinuteOffset(30),
        primaryLastSeenAt: freshLastSeen(atMinuteOffset(30)),
      });
      const row = await pool.query(
        `SELECT status FROM marketing_incidents WHERE id = $1::uuid`,
        [incidentId],
      );
      assert.equal(row.rows[0]?.status, "resolved");
    });

    it("15 later outage uses fresh incident id", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const first = await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      await repo.commitObservation({
        now: atMinuteOffset(30),
        primaryLastSeenAt: freshLastSeen(atMinuteOffset(30)),
      });
      await repo.commitObservation({
        now: atMinuteOffset(45),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(45)),
      });
      const second = await repo.commitObservation({
        now: atMinuteOffset(60),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(60)),
      });
      assert.notEqual(second.openedIncidentId, first.openedIncidentId);
    });

    it("16 incident events persisted", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      await repo.commitObservation({
        now: atMinuteOffset(30),
        primaryLastSeenAt: freshLastSeen(atMinuteOffset(30)),
      });
      assert.ok((await countTable(pool, "marketing_incident_events")) >= 2);
    });

    it("17 notification row created with incident", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const opened = await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      assert.equal(
        await countTable(pool, "marketing_dispatcher_watchdog_incident_notifications"),
        1,
      );
      const row = await repo.getIncidentNotification(opened.openedIncidentId!);
      assert.equal(row?.outagePushClaimStatus, "none");
    });

    it("18 concurrent outage claim acquisition", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const opened = await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      const incidentId = opened.openedIncidentId!;
      const [a, b] = await Promise.all([
        repo.tryAcquireOutagePushClaim(incidentId),
        repo.tryAcquireOutagePushClaim(incidentId),
      ]);
      assert.deepEqual(sortedAcquireStatuses(a, b), ["acquired", "blocked"]);
    });

    it("19 delivered claim deduplication", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const opened = await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      const incidentId = opened.openedIncidentId!;
      await deliverOutageNotification(repo, incidentId, atMinuteOffset(16));
      assert.equal(
        (await repo.tryAcquireOutagePushClaim(incidentId)).status,
        "blocked",
      );
    });

    it("20 ambiguous claim deduplication", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const opened = await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      const incidentId = opened.openedIncidentId!;
      const claimNonce = await mustAcquireOutage(repo, incidentId);
      await repo.recordOutagePushOutcome({
        incidentId,
        claimNonce,
        pushDelivered: 0,
        ambiguous: true,
        now: atMinuteOffset(16),
      });
      assert.equal(
        (await repo.tryAcquireOutagePushClaim(incidentId)).status,
        "blocked",
      );
    });

    it("21 failed claim retry eligibility", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const opened = await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      const incidentId = opened.openedIncidentId!;
      const claimNonce = await mustAcquireOutage(repo, incidentId);
      await repo.recordOutagePushOutcome({
        incidentId,
        claimNonce,
        pushDelivered: 0,
        now: atMinuteOffset(16),
      });
      assert.equal(
        (await repo.tryAcquireOutagePushClaim(incidentId)).status,
        "acquired",
      );
    });

    it("22 recovery notification gating", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const opened = await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      const incidentId = opened.openedIncidentId!;
      assert.equal(
        (await repo.tryAcquireRecoveryPushClaim(incidentId)).status,
        "blocked",
      );
      await deliverOutageNotification(repo, incidentId, atMinuteOffset(16));
      assert.equal(
        (await repo.tryAcquireRecoveryPushClaim(incidentId)).status,
        "acquired",
      );
    });

    it("23 maintenance suppresses outage notification eligibility", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.addMaintenanceWindow({
        id: crypto.randomUUID(),
        startsAt: atMinuteOffset(-60).toISOString(),
        endsAt: atMinuteOffset(60).toISOString(),
        reason: "planned",
        createdBy: "integration",
        createdAt: atMinuteOffset(-60).toISOString(),
      });
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      const second = await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      assert.equal(second.notificationEligibility.outageNotificationEligible, false);
      assert.equal(second.state.deferredOutagePush, true);
    });

    it("24 deferred outage eligibility after maintenance", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.addMaintenanceWindow({
        id: crypto.randomUUID(),
        startsAt: atMinuteOffset(-30).toISOString(),
        endsAt: atMinuteOffset(1).toISOString(),
        reason: "planned",
        createdBy: "integration",
        createdAt: atMinuteOffset(-30).toISOString(),
      });
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      const after = await repo.commitObservation({
        now: atMinuteOffset(30),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(30)),
      });
      assert.equal(after.notificationEligibility.outageNotificationEligible, true);
    });

    it("25 recovery without prior outage delivery is ineligible", async () => {
      await activateQstash(repo, atMinuteOffset(0));
      await repo.commitObservation({
        now: atMinuteOffset(0),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
      });
      await repo.commitObservation({
        now: atMinuteOffset(15),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
      });
      const fresh = await repo.commitObservation({
        now: atMinuteOffset(30),
        primaryLastSeenAt: freshLastSeen(atMinuteOffset(30)),
      });
      assert.equal(fresh.notificationEligibility.recoveryNotificationEligible, false);
    });

    it("PG01: durable outage claim nonce persisted in PostgreSQL", async () => {
      const incidentA = await openOutageIncident(repo);
      await resolveIncidentEpisode(repo);
      await repo.commitObservation({
        now: atMinuteOffset(45),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(45)),
      });
      const reopened = await repo.commitObservation({
        now: atMinuteOffset(60),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(60)),
      });
      assert.ok(reopened.openedIncidentId);
      assert.notEqual(incidentA, reopened.openedIncidentId);

      const claimA = await repo.tryAcquireOutagePushClaim(incidentA);
      const claimB = await repo.tryAcquireOutagePushClaim(reopened.openedIncidentId!);
      assert.equal(claimA.status, "acquired");
      assert.equal(claimB.status, "acquired");
      assert.match(claimA.claimNonce, /^[0-9a-f-]{36}$/i);
      assert.match(claimB.claimNonce, /^[0-9a-f-]{36}$/i);
      assert.notEqual(claimA.claimNonce, claimB.claimNonce);

      const rowA = await readNotificationColumns(pool, incidentA);
      const rowB = await readNotificationColumns(pool, reopened.openedIncidentId!);
      assert.equal(String(rowA.outage_push_claim_nonce), claimA.claimNonce);
      assert.equal(String(rowB.outage_push_claim_nonce), claimB.claimNonce);
      assert.equal(rowA.outage_push_attempt_started_at, null);
      assert.equal(rowB.outage_push_attempt_started_at, null);
    });

    it("PG03: stale unattempted outage claim is reclaimed after ten PostgreSQL minutes", async () => {
      const incidentId = await openOutageIncident(repo);
      const first = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(first.status, "acquired");
      await ageNotificationRowUpdatedAt(pool, incidentId, "11 minutes");
      const second = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(second.status, "acquired");
      assert.notEqual(second.claimNonce, first.claimNonce);
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(String(row.outage_push_claim_nonce), second.claimNonce);
      assert.equal(row.outage_push_attempt_started_at, null);
      assert.equal(row.outage_push_admin_notification_id, null);
    });

    it("PG04: fresh claimed outage row cannot be reclaimed before ten PostgreSQL minutes", async () => {
      const incidentId = await openOutageIncident(repo);
      const first = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(first.status, "acquired");
      await ageNotificationRowUpdatedAt(pool, incidentId, "9 minutes");
      const blocked = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(blocked.status, "blocked");
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(String(row.outage_push_claim_nonce), first.claimNonce);
    });

    it("PG05: legacy claimed row with null nonce cannot be auto-reclaimed", async () => {
      const incidentId = await openOutageIncident(repo);
      await pool.query(
        `UPDATE marketing_dispatcher_watchdog_incident_notifications
         SET outage_push_claim_status = 'claimed',
             outage_push_claim_nonce = NULL,
             outage_push_attempt_started_at = NULL,
             outage_push_admin_notification_id = NULL,
             updated_at = now() - interval '11 minutes'
         WHERE incident_id = $1::uuid`,
        [incidentId],
      );
      assert.equal((await repo.tryAcquireOutagePushClaim(incidentId)).status, "blocked");
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(row.outage_push_claim_status, "claimed");
      assert.equal(row.outage_push_claim_nonce, null);
    });

    it("PG06: durable outage attempt-start blocks stale reclaim", async () => {
      const incidentId = await openOutageIncident(repo);
      const first = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(first.status, "acquired");
      const began = await repo.beginOutagePushAttempt({
        incidentId,
        claimNonce: first.claimNonce,
        now: atMinuteOffset(16),
      });
      assert.equal(began.ok, true);
      await ageNotificationRowUpdatedAt(pool, incidentId, "11 minutes");
      assert.equal((await repo.tryAcquireOutagePushClaim(incidentId)).status, "blocked");
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(String(row.outage_push_claim_nonce), first.claimNonce);
      assert.notEqual(row.outage_push_attempt_started_at, null);
    });

    it("PG07: admin notification id blocks stale reclaim without attempt-start", async () => {
      const incidentId = await openOutageIncident(repo);
      const first = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(first.status, "acquired");
      const adminId = crypto.randomUUID();
      await pool.query(
        `UPDATE marketing_dispatcher_watchdog_incident_notifications
         SET outage_push_admin_notification_id = $2::uuid,
             updated_at = now() - interval '11 minutes'
         WHERE incident_id = $1::uuid`,
        [incidentId, adminId],
      );
      assert.equal((await repo.tryAcquireOutagePushClaim(incidentId)).status, "blocked");
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(String(row.outage_push_admin_notification_id), adminId);
      assert.equal(row.outage_push_attempt_started_at, null);
      assert.equal(String(row.outage_push_claim_nonce), first.claimNonce);
    });

    it("PG08: wrong nonce cannot begin outage delivery attempt", async () => {
      const incidentId = await openOutageIncident(repo);
      const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(acquired.status, "acquired");
      const began = await repo.beginOutagePushAttempt({
        incidentId,
        claimNonce: crypto.randomUUID(),
        now: atMinuteOffset(16),
      });
      assert.equal(began.ok, false);
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(row.outage_push_attempt_started_at, null);
      assert.equal(row.outage_push_admin_notification_id, null);
      assert.equal(String(row.outage_push_claim_nonce), acquired.claimNonce);
    });

    it("PG09: wrong nonce cannot finalize outage claim", async () => {
      const incidentId = await openOutageIncident(repo);
      const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(acquired.status, "acquired");
      const finalized = await repo.recordOutagePushOutcome({
        incidentId,
        claimNonce: crypto.randomUUID(),
        pushDelivered: 1,
        now: atMinuteOffset(16),
      });
      assert.equal(finalized, null);
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(row.outage_push_claim_status, "claimed");
      assert.equal(String(row.outage_push_claim_nonce), acquired.claimNonce);
    });

    it("PG10: reclaimed nonce fences the previous owner", async () => {
      const incidentId = await openOutageIncident(repo);
      const first = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(first.status, "acquired");
      await ageNotificationRowUpdatedAt(pool, incidentId, "11 minutes");
      const second = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(second.status, "acquired");
      const staleBegin = await repo.beginOutagePushAttempt({
        incidentId,
        claimNonce: first.claimNonce,
        now: atMinuteOffset(17),
      });
      assert.equal(staleBegin.ok, false);
      const staleFinalize = await repo.recordOutagePushOutcome({
        incidentId,
        claimNonce: first.claimNonce,
        pushDelivered: 1,
        now: atMinuteOffset(17),
      });
      assert.equal(staleFinalize, null);
      const currentBegin = await repo.beginOutagePushAttempt({
        incidentId,
        claimNonce: second.claimNonce,
        now: atMinuteOffset(18),
      });
      assert.equal(currentBegin.ok, true);
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(String(row.outage_push_claim_nonce), second.claimNonce);
    });

    it("PG11: repeated outage begin-attempt is rejected", async () => {
      const incidentId = await openOutageIncident(repo);
      const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(acquired.status, "acquired");
      const first = await repo.beginOutagePushAttempt({
        incidentId,
        claimNonce: acquired.claimNonce,
        now: atMinuteOffset(16),
      });
      assert.equal(first.ok, true);
      const second = await repo.beginOutagePushAttempt({
        incidentId,
        claimNonce: acquired.claimNonce,
        now: atMinuteOffset(17),
      });
      assert.equal(second.ok, false);
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(String(row.outage_push_claim_nonce), acquired.claimNonce);
      assert.notEqual(row.outage_push_attempt_started_at, null);
    });

    it("PG12: resolved incident blocks outage attempt-start", async () => {
      const incidentId = await openOutageIncident(repo);
      const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(acquired.status, "acquired");
      await resolveIncidentEpisode(repo);
      const began = await repo.beginOutagePushAttempt({
        incidentId,
        claimNonce: acquired.claimNonce,
        now: atMinuteOffset(31),
      });
      assert.equal(began.ok, false);
      assert.equal(began.code, "watchdog_outage_push_not_eligible");
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(row.outage_push_attempt_started_at, null);
    });

    it("PG13: maintenance blocks outage attempt-start and preserves incident", async () => {
      const incidentId = await openOutageIncident(repo);
      const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(acquired.status, "acquired");
      const incidentsBefore = await countTable(pool, "marketing_incidents");
      await repo.addMaintenanceWindow({
        id: crypto.randomUUID(),
        startsAt: atMinuteOffset(-60).toISOString(),
        endsAt: atMinuteOffset(60).toISOString(),
        reason: "planned",
        createdBy: "integration",
        createdAt: atMinuteOffset(-60).toISOString(),
      });
      const began = await repo.beginOutagePushAttempt({
        incidentId,
        claimNonce: acquired.claimNonce,
        now: atMinuteOffset(16),
      });
      assert.equal(began.ok, false);
      assert.equal(began.code, "watchdog_outage_push_not_eligible");
      assert.equal(await countTable(pool, "marketing_incidents"), incidentsBefore);
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(row.outage_push_claim_status, "claimed");
      assert.equal(row.outage_push_attempt_started_at, null);
    });

    it("PG15: recovery begin permitted only with resolved healthy prerequisites", async () => {
      const incidentId = await openOutageIncident(repo);
      const openClaim = await repo.tryAcquireRecoveryPushClaim(incidentId);
      assert.equal(openClaim.status, "blocked");

      const outageOnly = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(outageOnly.status, "acquired");
      const blockedWithoutDelivery = await repo.beginRecoveryPushAttempt({
        incidentId,
        claimNonce: crypto.randomUUID(),
        now: atMinuteOffset(17),
      });
      assert.equal(blockedWithoutDelivery.ok, false);

      const outageBegin = await repo.beginOutagePushAttempt({
        incidentId,
        claimNonce: outageOnly.claimNonce,
        now: atMinuteOffset(18),
      });
      assert.equal(outageBegin.ok, true);
      await repo.recordOutagePushOutcome({
        incidentId,
        claimNonce: outageOnly.claimNonce,
        pushDelivered: 1,
        now: atMinuteOffset(18),
      });
      const recoveryWhileOpen = await repo.tryAcquireRecoveryPushClaim(incidentId);
      assert.equal(recoveryWhileOpen.status, "acquired");
      const beginWhileOpen = await repo.beginRecoveryPushAttempt({
        incidentId,
        claimNonce: recoveryWhileOpen.claimNonce,
        now: atMinuteOffset(19),
      });
      assert.equal(beginWhileOpen.ok, false);
      assert.equal(beginWhileOpen.code, "watchdog_recovery_push_not_eligible");
      assert.equal(
        (await readNotificationColumns(pool, incidentId)).recovery_push_attempt_started_at,
        null,
      );

      await resolveIncidentEpisode(repo);
      const beginHealthy = await repo.beginRecoveryPushAttempt({
        incidentId,
        claimNonce: recoveryWhileOpen.claimNonce,
        now: atMinuteOffset(31),
      });
      assert.equal(beginHealthy.ok, true);
      const row = await readNotificationColumns(pool, incidentId);
      assert.notEqual(row.recovery_push_attempt_started_at, null);
      assert.equal(String(row.recovery_push_claim_nonce), recoveryWhileOpen.claimNonce);
    });

    it("PG16: failed outage claim acquire rolls back partial persisted state", async () => {
      const incidentId = await openOutageIncident(repo);
      const faultRepo = await createIsolatedWatchdogRepository(pool, {
        failAfterSqlMatching:
          /SET outage_push_claim_status = 'claimed',\s+outage_push_claim_nonce = \$2::uuid/i,
      });
      await assert.rejects(
        () => faultRepo.tryAcquireOutagePushClaim(incidentId),
        /integration_fault_injection_after_query/,
      );
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(row.outage_push_claim_status, "none");
      assert.equal(row.outage_push_claim_nonce, null);
      assert.equal((await repo.tryAcquireOutagePushClaim(incidentId)).status, "acquired");
    });

    it("PG17: concurrent stale reclaim and begin-attempt cannot both authorize delivery", async () => {
      const incidentId = await openOutageIncident(repo);
      const first = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(first.status, "acquired");
      await ageNotificationRowUpdatedAt(pool, incidentId, "11 minutes");

      const [reclaim, begin] = await Promise.all([
        repo.tryAcquireOutagePushClaim(incidentId),
        repo.beginOutagePushAttempt({
          incidentId,
          claimNonce: first.claimNonce,
          now: atMinuteOffset(17),
        }),
      ]);

      const row = await readNotificationColumns(pool, incidentId);
      if (reclaim.status === "acquired") {
        assert.equal(begin.ok, false);
        assert.notEqual(String(row.outage_push_claim_nonce), first.claimNonce);
        assert.equal(row.outage_push_attempt_started_at, null);
      } else {
        assert.equal(reclaim.status, "blocked");
        assert.equal(begin.ok, true);
        assert.equal(String(row.outage_push_claim_nonce), first.claimNonce);
        assert.notEqual(row.outage_push_attempt_started_at, null);
      }
      assert.notEqual(reclaim.status === "acquired" && begin.ok, true);
    });

    it("PG18: outage and recovery claim metadata remain independent", async () => {
      const incidentId = await openOutageIncident(repo);
      const outage = await repo.tryAcquireOutagePushClaim(incidentId);
      assert.equal(outage.status, "acquired");
      const outageAdminId = crypto.randomUUID();
      const outageBegin = await repo.beginOutagePushAttempt({
        incidentId,
        claimNonce: outage.claimNonce,
        adminNotificationId: outageAdminId,
        now: atMinuteOffset(16),
      });
      assert.equal(outageBegin.ok, true);
      await repo.recordOutagePushOutcome({
        incidentId,
        claimNonce: outage.claimNonce,
        pushDelivered: 1,
        now: atMinuteOffset(17),
      });
      await resolveIncidentEpisode(repo);
      const recovery = await repo.tryAcquireRecoveryPushClaim(incidentId);
      assert.equal(recovery.status, "acquired");
      const row = await readNotificationColumns(pool, incidentId);
      assert.equal(String(row.outage_push_admin_notification_id), outageAdminId);
      assert.notEqual(row.outage_push_attempt_started_at, null);
      assert.equal(row.recovery_push_attempt_started_at, null);
      assert.equal(row.recovery_push_admin_notification_id, null);
      assert.equal(String(row.recovery_push_claim_nonce), recovery.claimNonce);
      assert.equal(row.outage_push_claim_status, "delivered");
      assert.equal(row.recovery_push_claim_status, "claimed");
    });

    it("PG20: stale reclaim eligibility follows PostgreSQL database time", async () => {
      const youngIncident = await openOutageIncident(repo);
      const young = await repo.tryAcquireOutagePushClaim(youngIncident);
      assert.equal(young.status, "acquired");
      await ageNotificationRowUpdatedAt(pool, youngIncident, "9 minutes");
      assert.equal(
        (await repo.tryAcquireOutagePushClaim(youngIncident)).status,
        "blocked",
      );

      await resolveIncidentEpisode(repo);
      await repo.commitObservation({
        now: atMinuteOffset(45),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(45)),
      });
      const reopened = await repo.commitObservation({
        now: atMinuteOffset(60),
        primaryLastSeenAt: staleLastSeen(atMinuteOffset(60)),
      });
      const staleIncidentId = reopened.openedIncidentId!;
      assert.ok(staleIncidentId);
      const stale = await repo.tryAcquireOutagePushClaim(staleIncidentId);
      assert.equal(stale.status, "acquired");
      await ageNotificationRowUpdatedAt(pool, staleIncidentId, "11 minutes");
      const reclaimed = await repo.tryAcquireOutagePushClaim(staleIncidentId);
      assert.equal(reclaimed.status, "acquired");
      assert.notEqual(reclaimed.claimNonce, stale.claimNonce);

      const dbClock = await pool.query<{ db_now: Date }>(`SELECT now() AS db_now`);
      const aged = await pool.query<{ updated_at: Date }>(
        `SELECT updated_at FROM marketing_dispatcher_watchdog_incident_notifications
         WHERE incident_id = $1::uuid`,
        [youngIncident],
      );
      const ageMs =
        dbClock.rows[0]!.db_now.getTime() - aged.rows[0]!.updated_at.getTime();
      assert.ok(ageMs >= 9 * 60_000 - 2_000);
      assert.ok(ageMs < 10 * 60_000);
    });

  },
);
