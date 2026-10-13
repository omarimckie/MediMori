import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { STALE_THRESHOLD_MS } from "./constants";
import {
  computeObservationSlotId,
  finalizeOutagePushClaim,
  isOutagePushDuplicateBlocked,
  isPrimaryHeartbeatStale,
  markOutagePushAmbiguous,
  primaryHeartbeatAgeMs,
} from "./evaluate";
import {
  createMemoryWatchdogRepository,
  resetMemoryWatchdogRepositoryForTests,
} from "./repository";

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

afterEach(() => {
  resetMemoryWatchdogRepositoryForTests();
});

describe("dispatcher watchdog evaluate", () => {
  it("1 activation pending does not advance stale counter toward outage", async () => {
    const repo = createMemoryWatchdogRepository();
    const now = atMinuteOffset(0);
    const result = await repo.commitObservation({
      now,
      primaryLastSeenAt: staleLastSeen(now),
    });
    assert.equal(result.activationPending, true);
    assert.equal(result.outcome, "ignored_not_activated");
    assert.equal(result.state.consecutiveStaleObservations, 0);
    assert.equal(result.openedIncidentId, null);
  });

  it("2 recordPrimaryQstashActivation sets activation timestamp", async () => {
    const repo = createMemoryWatchdogRepository();
    const now = atMinuteOffset(0);
    const activated = await repo.recordPrimaryQstashActivation(now);
    assert.ok(activated.primaryQstashActivatedAt);
  });

  it("3 fresh primary heartbeat resets stale counter after activation", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    await repo.commitObservation({
      now: atMinuteOffset(15),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
    });
    assert.equal((await repo.getState()).consecutiveStaleObservations, 2);
    const fresh = await repo.commitObservation({
      now: atMinuteOffset(30),
      primaryLastSeenAt: freshLastSeen(atMinuteOffset(30)),
    });
    assert.equal(fresh.stale, false);
    assert.equal(fresh.state.consecutiveStaleObservations, 0);
  });

  it("4 stale heartbeat older than 30 minutes", () => {
    const nowMs = BASE.getTime();
    assert.equal(isPrimaryHeartbeatStale(staleLastSeen(BASE), nowMs), true);
  });

  it("5 exactly 30-minute boundary is not stale", () => {
    const nowMs = BASE.getTime();
    const lastSeen = new Date(nowMs - STALE_THRESHOLD_MS).toISOString();
    assert.equal(primaryHeartbeatAgeMs(lastSeen, nowMs), STALE_THRESHOLD_MS);
    assert.equal(isPrimaryHeartbeatStale(lastSeen, nowMs), false);
  });

  it("6 first stale observation after activation", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    const result = await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    assert.equal(result.outcome, "committed");
    assert.equal(result.state.consecutiveStaleObservations, 1);
    assert.equal(result.openedIncidentId, null);
  });

  it("7 second consecutive stale observation opens incident", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    const second = await repo.commitObservation({
      now: atMinuteOffset(15),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
    });
    assert.equal(second.state.consecutiveStaleObservations, 2);
    assert.ok(second.openedIncidentId);
    assert.equal(second.state.activeIncidentId, second.openedIncidentId);
  });

  it("8 duplicate observation slot does not double-count", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    const dup = await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    assert.equal(dup.outcome, "duplicate_slot");
    assert.equal(dup.state.consecutiveStaleObservations, 1);
  });

  it("9 retried invocation same slot is duplicate", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    const first = await repo.commitObservation({
      now: atMinuteOffset(15),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
    });
    const retry = await repo.commitObservation({
      now: atMinuteOffset(15),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
    });
    assert.equal(first.outcome, "committed");
    assert.equal(retry.outcome, "duplicate_slot");
  });

  it("10 out-of-order older slot is ignored", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    await repo.commitObservation({
      now: atMinuteOffset(15),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
    });
    const late = await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    assert.equal(late.outcome, "ignored_late_slot");
    assert.equal(late.state.lastCommittedObservationSlotId, computeObservationSlotId(atMinuteOffset(15).getTime()));
  });

  it("11 monotonic high-water mark never decreases", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
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

  it("12 concurrent invocations same slot yield one commit", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    const now = atMinuteOffset(45);
    const [a, b] = await Promise.all([
      repo.commitObservation({ now, primaryLastSeenAt: staleLastSeen(now) }),
      repo.commitObservation({ now, primaryLastSeenAt: staleLastSeen(now) }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    assert.deepEqual(outcomes, ["committed", "duplicate_slot"]);
    assert.equal((await repo.getState()).consecutiveStaleObservations, 1);
  });

  it("13 safe singleton initialization", async () => {
    const repo = createMemoryWatchdogRepository();
    const a = await repo.ensureInitialized(atMinuteOffset(0));
    const b = await repo.ensureInitialized(atMinuteOffset(0));
    assert.equal(a.id, "primary");
    assert.equal(b.id, "primary");
  });

  it("15 maintenance suppresses outage notification eligibility", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
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

  it("16 maintenance expiry allows deferred outage eligibility", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
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

  it("17 recovery without prior outage notification is ineligible", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    const opened = await repo.commitObservation({
      now: atMinuteOffset(15),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
    });
    assert.ok(opened.openedIncidentId);
    const fresh = await repo.commitObservation({
      now: atMinuteOffset(30),
      primaryLastSeenAt: freshLastSeen(atMinuteOffset(30)),
    });
    assert.equal(fresh.notificationEligibility.recoveryNotificationEligible, false);
  });

  it("18 recovery after prior outage notification is eligible", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    await repo.commitObservation({
      now: atMinuteOffset(0),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
    });
    const opened = await repo.commitObservation({
      now: atMinuteOffset(15),
      primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
    });
    assert.ok(opened.openedIncidentId);
    await repo.recordOutagePushOutcome({
      incidentId: opened.openedIncidentId!,
      pushDelivered: 1,
      now: atMinuteOffset(16),
    });
    const fresh = await repo.commitObservation({
      now: atMinuteOffset(30),
      primaryLastSeenAt: freshLastSeen(atMinuteOffset(30)),
    });
    assert.equal(fresh.notificationEligibility.recoveryNotificationEligible, true);
  });

  it("19 ambiguous push acceptance blocks duplicate outage eligibility", () => {
    const ambiguous = markOutagePushAmbiguous(
      {
        incidentId: "inc-1",
        outagePushClaimStatus: "claimed",
        recoveryPushClaimStatus: "none",
        outagePushSentAt: null,
        createdAt: BASE.toISOString(),
        updatedAt: BASE.toISOString(),
      },
      BASE.toISOString(),
    );
    assert.equal(isOutagePushDuplicateBlocked(ambiguous.outagePushClaimStatus), true);
    const failed = finalizeOutagePushClaim(
      ambiguous,
      0,
      BASE.toISOString(),
    );
    assert.equal(failed.outagePushClaimStatus, "failed");
  });

  it("20 new incident episode has clean notification claims", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
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
    assert.notEqual(second.openedIncidentId, firstIncident);
    const notif = await repo.getIncidentNotification(second.openedIncidentId!);
    assert.equal(notif?.outagePushClaimStatus, "none");
    assert.equal(notif?.outagePushSentAt, null);
    const prior = await repo.getIncidentNotification(firstIncident);
    assert.equal(prior?.outagePushClaimStatus, "delivered");
  });
});
