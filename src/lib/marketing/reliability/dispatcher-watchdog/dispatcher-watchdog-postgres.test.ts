import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STALE_THRESHOLD_MS, WATCHDOG_STATE_ID } from "./constants";
import { computeObservationSlotId } from "./evaluate";
import {
  createFakeWatchdogPgHarness,
  type FakeWatchdogPgStore,
} from "./fake-pg-harness";

const BASE = new Date("2026-10-12T12:07:00.000Z");

function atMinuteOffset(minutes: number): Date {
  return new Date(BASE.getTime() + minutes * 60_000);
}

function staleLastSeen(now: Date, extraMs = 60_000): string {
  return new Date(now.getTime() - STALE_THRESHOLD_MS - extraMs).toISOString();
}

function freshLastSeen(now: Date): string {
  return new Date(now.getTime() - 5 * 60_000).toISOString();
}

async function activateQstash(
  repo: ReturnType<typeof createFakeWatchdogPgHarness>["repo"],
  now: Date,
): Promise<void> {
  await repo.recordPrimaryQstashActivation(now, {
    verificationKind: "qstash_signature_verified",
    verifiedAt: now.toISOString(),
    attestationId: "test-attestation",
  });
}

describe("dispatcher watchdog postgres repository (isolated fake pg)", () => {
  it("1 safe singleton initialization", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    const a = await repo.ensureInitialized(atMinuteOffset(0));
    const b = await repo.ensureInitialized(atMinuteOffset(0));
    assert.equal(a.id, WATCHDOG_STATE_ID);
    assert.equal(b.id, WATCHDOG_STATE_ID);
  });

  it("2 existing state preserved during initialization", async () => {
    const seed: Partial<FakeWatchdogPgStore> = {
      state: {
        id: WATCHDOG_STATE_ID,
        primary_qstash_activated_at: atMinuteOffset(-60).toISOString(),
        consecutive_stale_observations: 3,
        last_primary_last_seen_at: staleLastSeen(atMinuteOffset(-15)),
        last_committed_observation_slot_id: 42,
        last_observation_was_stale: true,
        active_incident_id: null,
        deferred_outage_push: true,
        updated_at: atMinuteOffset(-15).toISOString(),
      },
    };
    const { repo, store } = createFakeWatchdogPgHarness(seed);
    await repo.ensureInitialized(atMinuteOffset(0));
    assert.equal(store.state?.consecutive_stale_observations, 3);
    assert.equal(store.state?.last_committed_observation_slot_id, 42);
    assert.equal(store.state?.deferred_outage_push, true);
  });

  it("3 successful atomic observation commit", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateQstash(repo, atMinuteOffset(0));
    const result = await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: freshLastSeen(atMinuteOffset(0)),
    });
    assert.equal(result.outcome, "committed");
    assert.equal(store.observations.size, 1);
    assert.equal(
      store.state?.last_committed_observation_slot_id,
      result.observationSlotId,
    );
  });

  it("4 duplicate slot rejected", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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
  });

  it("5 late slot rejected", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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

  it("6 high-water mark monotonicity", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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

  it("7 concurrent same-slot requests", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    await activateQstash(repo, atMinuteOffset(0));
    const now = atMinuteOffset(45);
    const [a, b] = await Promise.all([
      repo.commitObservation({ now, primaryLastSeenAt: staleLastSeen(now) }),
      repo.commitObservation({ now, primaryLastSeenAt: staleLastSeen(now) }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    assert.deepEqual(outcomes, ["committed", "duplicate_slot"]);
  });

  it("8 concurrent different-slot requests", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
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
    assert.equal(store.observations.size, 2);
  });

  it("9 transaction rollback on observation failure", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateQstash(repo, atMinuteOffset(0));
    store.failNextObservationInsert = true;
    await assert.rejects(
      () =>
        repo.commitObservation({
          now: atMinuteOffset(0),
          primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
        }),
      /injected_observation_insert_failure/,
    );
    assert.equal(store.observations.size, 0);
    assert.equal(store.state?.consecutive_stale_observations, 0);
  });

  it("10 transaction rollback on incident failure", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateQstash(repo, atMinuteOffset(0));
    await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    store.failNextIncidentInsert = true;
    await assert.rejects(
      () =>
        repo.commitObservation({
          now: atMinuteOffset(15),
          primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
        }),
      /injected_incident_insert_failure/,
    );
    assert.equal(store.incidents.size, 0);
    assert.equal(store.state?.active_incident_id, null);
    assert.equal(store.observations.size, 1);
  });

  it("11 activation pending before verified activation", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    const result = await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    assert.equal(result.activationPending, true);
    assert.equal(result.outcome, "ignored_not_activated");
  });

  it("12 verified activation operation", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    const activated = await repo.recordPrimaryQstashActivation(atMinuteOffset(0), {
      verificationKind: "qstash_signature_verified",
      verifiedAt: atMinuteOffset(0).toISOString(),
    });
    assert.ok(activated.primaryQstashActivatedAt);
    await assert.rejects(
      () => repo.recordPrimaryQstashActivation(atMinuteOffset(1)),
      /watchdog_activation_requires_verified_qstash_evidence/,
    );
  });

  it("13 first stale observation after activation", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    await activateQstash(repo, atMinuteOffset(0));
    const result = await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    assert.equal(result.outcome, "committed");
    assert.equal(result.state.consecutiveStaleObservations, 1);
    assert.equal(result.openedIncidentId, null);
  });

  it("14 second consecutive stale observation opens incident", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
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
    assert.equal(second.state.activeIncidentId, second.openedIncidentId);
    assert.ok(store.notifications.has(second.openedIncidentId!));
  });

  it("15 fresh recovery resolves active incident", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
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
    const fresh = await repo.commitObservation({
      now: atMinuteOffset(30),
      primaryLastSeenAt: freshLastSeen(atMinuteOffset(30)),
    });
    assert.equal(fresh.resolvedIncidentId, incidentId);
    assert.equal(fresh.state.activeIncidentId, null);
    assert.equal(store.incidents.get(incidentId)?.status, "resolved");
  });

  it("16 one active incident per continuing outage", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    await activateQstash(repo, atMinuteOffset(0));
    await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    const opened = await repo.commitObservation({
      now: atMinuteOffset(15),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
    });
    const third = await repo.commitObservation({
      now: atMinuteOffset(30),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(30)),
    });
    assert.equal(third.openedIncidentId, null);
    assert.equal(third.state.activeIncidentId, opened.openedIncidentId);
  });

  it("17 new incident id for later outage episode", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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
    assert.ok(second.openedIncidentId);
    assert.notEqual(second.openedIncidentId, first.openedIncidentId);
  });

  it("18 incident foreign-key ordering on open", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
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
    assert.ok(store.incidents.has(incidentId));
    assert.equal(store.state?.active_incident_id, incidentId);
    assert.ok(store.notifications.has(incidentId));
  });

  it("19 incident-scoped notification claims", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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
    const row = await repo.getIncidentNotification(incidentId);
    assert.equal(row?.outagePushClaimStatus, "none");
    assert.equal(row?.recoveryPushClaimStatus, "none");
  });

  it("20 concurrent outage claim attempts", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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
    const results = [a, b].sort();
    assert.deepEqual(results, ["acquired", "blocked"]);
  });

  it("21 ambiguous outage claim deduplication", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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
    assert.equal(await repo.tryAcquireOutagePushClaim(incidentId), "acquired");
    await repo.recordOutagePushOutcome({
      incidentId,
      pushDelivered: 0,
      ambiguous: true,
      now: atMinuteOffset(16),
    });
    assert.equal(await repo.tryAcquireOutagePushClaim(incidentId), "blocked");
  });

  it("22 recovery claim gating without outage notification", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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
    assert.equal(await repo.tryAcquireRecoveryPushClaim(incidentId), "blocked");
  });

  it("23 recovery claim after outage notification", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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
    await repo.recordOutagePushOutcome({
      incidentId,
      pushDelivered: 1,
      now: atMinuteOffset(16),
    });
    assert.equal(await repo.tryAcquireRecoveryPushClaim(incidentId), "acquired");
  });

  it("24 ambiguous recovery deduplication", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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
    await repo.recordOutagePushOutcome({
      incidentId,
      pushDelivered: 1,
      now: atMinuteOffset(16),
    });
    assert.equal(await repo.tryAcquireRecoveryPushClaim(incidentId), "acquired");
    await repo.finalizeRecoveryPushClaim({
      incidentId,
      pushDelivered: 0,
      ambiguous: true,
      now: atMinuteOffset(17),
    });
    assert.equal(await repo.tryAcquireRecoveryPushClaim(incidentId), "blocked");
  });

  it("25 definite failure handling for outage claim", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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
    assert.equal(await repo.tryAcquireOutagePushClaim(incidentId), "acquired");
    const failed = await repo.recordOutagePushOutcome({
      incidentId,
      pushDelivered: 0,
      now: atMinuteOffset(16),
    });
    assert.equal(failed?.outagePushClaimStatus, "failed");
    assert.equal(await repo.tryAcquireOutagePushClaim(incidentId), "acquired");
  });

  it("26 maintenance suppresses outage notification eligibility", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    await activateQstash(repo, atMinuteOffset(0));
    await repo.addMaintenanceWindow({
      id: crypto.randomUUID(),
      startsAt: atMinuteOffset(-60).toISOString(),
      endsAt: atMinuteOffset(60).toISOString(),
      reason: "planned",
      createdBy: "owner",
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

  it("27 maintenance expiry allows deferred outage eligibility", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    await activateQstash(repo, atMinuteOffset(0));
    await repo.addMaintenanceWindow({
      id: crypto.randomUUID(),
      startsAt: atMinuteOffset(-30).toISOString(),
      endsAt: atMinuteOffset(1).toISOString(),
      reason: "planned",
      createdBy: "owner",
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
    const afterMaintenance = await repo.commitObservation({
      now: atMinuteOffset(30),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(30)),
    });
    assert.equal(afterMaintenance.notificationEligibility.outageNotificationEligible, true);
  });

  it("28 recovery without prior outage notification is ineligible", async () => {
    const { repo } = createFakeWatchdogPgHarness();
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

  it("29 rollback consistency across state observations incidents notifications", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateQstash(repo, atMinuteOffset(0));
    await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    const beforeNotifications = store.notifications.size;
    store.failNextIncidentInsert = true;
    await assert.rejects(
      () =>
        repo.commitObservation({
          now: atMinuteOffset(15),
          primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
        }),
      /injected_incident_insert_failure/,
    );
    assert.equal(store.notifications.size, beforeNotifications);
    assert.equal(store.state?.consecutive_stale_observations, 1);
    assert.equal(
      store.state?.last_committed_observation_slot_id,
      computeObservationSlotId(atMinuteOffset(0).getTime()),
    );
  });

  it("30 new incident episode has clean notification claims", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    await activateQstash(repo, atMinuteOffset(0));
    await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    const first = await repo.commitObservation({
      now: atMinuteOffset(15),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
    });
    const firstIncident = first.openedIncidentId!;
    await repo.recordOutagePushOutcome({
      incidentId: firstIncident,
      pushDelivered: 1,
      now: atMinuteOffset(16),
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
    assert.ok(second.openedIncidentId);
    const notif = await repo.getIncidentNotification(second.openedIncidentId!);
    assert.equal(notif?.outagePushClaimStatus, "none");
    const prior = await repo.getIncidentNotification(firstIncident);
    assert.equal(prior?.outagePushClaimStatus, "delivered");
  });
});
