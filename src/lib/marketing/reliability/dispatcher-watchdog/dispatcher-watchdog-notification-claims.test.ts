import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STALE_THRESHOLD_MS } from "./constants";
import { createFakeWatchdogPgHarness } from "./fake-pg-harness";
import {
  outagePushAttemptEligibleFromState,
  recoveryPushAttemptEligibleFromState,
  STALE_UNATTEMPTED_CLAIM_INTERVAL,
} from "./notification-claims";
import { createInitialWatchdogState, outageNotificationWasSent } from "./evaluate";
import type { IncidentNotificationState } from "./types";
import { createMemoryWatchdogRepository } from "./repository";

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

async function openIncident(repo: ReturnType<typeof createMemoryWatchdogRepository>) {
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
  return opened.openedIncidentId!;
}

async function deliverOutage(
  repo: ReturnType<typeof createMemoryWatchdogRepository>,
  incidentId: string,
) {
  const claim = await repo.tryAcquireOutagePushClaim(incidentId);
  assert.equal(claim.status, "acquired");
  await repo.recordOutagePushOutcome({
    incidentId,
    claimNonce: claim.claimNonce,
    pushDelivered: 1,
    now: atMinuteOffset(16),
  });
}

async function resolveEpisode(
  repo: ReturnType<typeof createMemoryWatchdogRepository>,
) {
  await repo.commitObservation({
    now: atMinuteOffset(30),
    primaryLastSeenAt: freshLastSeen(atMinuteOffset(30)),
  });
}

async function activateFakeQstash(
  repo: ReturnType<typeof createFakeWatchdogPgHarness>["repo"],
) {
  await repo.recordPrimaryQstashActivation(atMinuteOffset(0), {
    verificationKind: "qstash_signature_verified",
    verifiedAt: atMinuteOffset(0).toISOString(),
    attestationId: "test-attestation",
  });
}

async function openIncidentFakePg(repo: ReturnType<typeof createFakeWatchdogPgHarness>["repo"]) {
  await repo.commitObservation({
    now: atMinuteOffset(0),
    primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
  });
  const opened = await repo.commitObservation({
    now: atMinuteOffset(15),
    primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
  });
  return opened.openedIncidentId!;
}

describe("dispatcher watchdog notification claims (B3a + P1)", () => {
  it("T01 new outage claim receives a durable nonce", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    const result = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(result.status, "acquired");
    assert.match(result.claimNonce, /^[0-9a-f-]{36}$/i);
    const row = await repo.getIncidentNotification(incidentId);
    assert.equal(row?.outagePushClaimNonce, result.claimNonce);
    assert.equal(row?.outagePushAttemptStartedAt, null);
  });

  it("T02 concurrent outage claims yield one acquired and one blocked", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    await activateFakeQstash(repo);
    const incidentId = await openIncidentFakePg(repo);
    const [a, b] = await Promise.all([
      repo.tryAcquireOutagePushClaim(incidentId),
      repo.tryAcquireOutagePushClaim(incidentId),
    ]);
    assert.deepEqual([a.status, b.status].sort(), ["acquired", "blocked"]);
  });

  it("T03 stale unattempted outage claim is reclaimed and re-acquired", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateFakeQstash(repo);
    const incidentId = await openIncidentFakePg(repo);
    const first = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(first.status, "acquired");
    store.notifications.get(incidentId)!.updated_at = new Date(
      Date.now() - 11 * 60_000,
    ).toISOString();
    const second = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(second.status, "acquired");
    assert.notEqual(second.claimNonce, first.claimNonce);
  });

  it("T04 claim younger than ten minutes cannot be reclaimed", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateFakeQstash(repo);
    const incidentId = await openIncidentFakePg(repo);
    const first = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(first.status, "acquired");
    store.notifications.get(incidentId)!.updated_at = new Date(
      Date.now() - 9 * 60_000,
    ).toISOString();
    const blocked = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(blocked.status, "blocked");
    assert.equal(
      store.notifications.get(incidentId)?.outage_push_claim_nonce,
      first.claimNonce,
    );
  });

  it("T05 legacy claimed row without nonce is never auto-reclaimed", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateFakeQstash(repo);
    const incidentId = await openIncidentFakePg(repo);
    const row = store.notifications.get(incidentId)!;
    row.outage_push_claim_status = "claimed";
    row.outage_push_claim_nonce = null;
    row.updated_at = new Date(Date.now() - 11 * 60_000).toISOString();
    assert.equal((await repo.tryAcquireOutagePushClaim(incidentId)).status, "blocked");
  });

  it("T06 attempt-start marker blocks stale reclaim", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateFakeQstash(repo);
    const incidentId = await openIncidentFakePg(repo);
    const first = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(first.status, "acquired");
    const began = await repo.beginOutagePushAttempt({
      incidentId,
      claimNonce: first.claimNonce,
      now: atMinuteOffset(16),
    });
    assert.equal(began.ok, true);
    store.notifications.get(incidentId)!.updated_at = new Date(
      Date.now() - 11 * 60_000,
    ).toISOString();
    assert.equal((await repo.tryAcquireOutagePushClaim(incidentId)).status, "blocked");
  });

  it("T07 linked admin notification id prevents reclaim", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateFakeQstash(repo);
    const incidentId = await openIncidentFakePg(repo);
    const first = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(first.status, "acquired");
    const row = store.notifications.get(incidentId)!;
    row.outage_push_admin_notification_id = crypto.randomUUID();
    row.updated_at = new Date(Date.now() - 11 * 60_000).toISOString();
    assert.equal((await repo.tryAcquireOutagePushClaim(incidentId)).status, "blocked");
  });

  it("T08 delivered and ambiguous outage states block re-acquire", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    const claim = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(claim.status, "acquired");
    await repo.recordOutagePushOutcome({
      incidentId,
      claimNonce: claim.claimNonce,
      pushDelivered: 0,
      ambiguous: true,
      now: atMinuteOffset(16),
    });
    assert.equal((await repo.tryAcquireOutagePushClaim(incidentId)).status, "blocked");
    const row = await repo.getIncidentNotification(incidentId);
    assert.equal(row?.outagePushClaimStatus, "ambiguous");
  });

  it("T09 begin outage attempt requires matching nonce", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(acquired.status, "acquired");
    const began = await repo.beginOutagePushAttempt({
      incidentId,
      claimNonce: crypto.randomUUID(),
      now: atMinuteOffset(16),
    });
    assert.equal(began.ok, false);
    assert.equal(
      (await repo.getIncidentNotification(incidentId))?.outagePushAttemptStartedAt,
      null,
    );
  });

  it("T10 old claim owner cannot begin after reclaim replaces generation", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateFakeQstash(repo);
    const incidentId = await openIncidentFakePg(repo);
    const first = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(first.status, "acquired");
    store.notifications.get(incidentId)!.updated_at = new Date(
      Date.now() - 11 * 60_000,
    ).toISOString();
    const second = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(second.status, "acquired");
    const staleBegin = await repo.beginOutagePushAttempt({
      incidentId,
      claimNonce: first.claimNonce,
      now: atMinuteOffset(17),
    });
    assert.equal(staleBegin.ok, false);
    const row = store.notifications.get(incidentId)!;
    assert.equal(row.outage_push_claim_nonce, second.claimNonce);
    assert.equal(row.outage_push_attempt_started_at, null);
  });

  it("T11 repeated outage begin-attempt is rejected", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
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
  });

  it("T12 attempt start rejects resolved incident for outage", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(acquired.status, "acquired");
    await resolveEpisode(repo);
    const began = await repo.beginOutagePushAttempt({
      incidentId,
      claimNonce: acquired.claimNonce,
      now: atMinuteOffset(31),
    });
    assert.equal(began.ok, false);
    assert.equal(
      (await repo.getIncidentNotification(incidentId))?.outagePushAttemptStartedAt,
      null,
    );
  });

  it("T13 outage attempt start rejects active maintenance", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    await repo.addMaintenanceWindow({
      id: crypto.randomUUID(),
      startsAt: atMinuteOffset(-60).toISOString(),
      endsAt: atMinuteOffset(60).toISOString(),
      reason: "planned",
      createdBy: "owner",
      createdAt: atMinuteOffset(-60).toISOString(),
    });
    const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(acquired.status, "acquired");
    const began = await repo.beginOutagePushAttempt({
      incidentId,
      claimNonce: acquired.claimNonce,
      now: atMinuteOffset(16),
    });
    assert.equal(began.ok, false);
  });

  it("T14 finalize requires matching nonce", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(acquired.status, "acquired");
    assert.equal(
      await repo.recordOutagePushOutcome({
        incidentId,
        claimNonce: crypto.randomUUID(),
        pushDelivered: 1,
        now: atMinuteOffset(16),
      }),
      null,
    );
  });

  it("T15 stale worker cannot finalize after reclaim replaces generation", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateFakeQstash(repo);
    const incidentId = await openIncidentFakePg(repo);
    const first = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(first.status, "acquired");
    store.notifications.get(incidentId)!.updated_at = new Date(
      Date.now() - 11 * 60_000,
    ).toISOString();
    const second = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(second.status, "acquired");
    const finalized = await repo.recordOutagePushOutcome({
      incidentId,
      claimNonce: first.claimNonce,
      pushDelivered: 1,
      now: atMinuteOffset(18),
    });
    assert.equal(finalized, null);
    assert.equal(store.notifications.get(incidentId)?.outage_push_claim_status, "claimed");
  });

  it("T16 recovery acquire blocked without qualifying outage delivery", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    assert.equal((await repo.tryAcquireRecoveryPushClaim(incidentId)).status, "blocked");
    const claimedOnly = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(claimedOnly.status, "acquired");
    assert.equal((await repo.tryAcquireRecoveryPushClaim(incidentId)).status, "blocked");
  });

  it("T17 recovery begin rejects open incident", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    await deliverOutage(repo, incidentId);
    const recovery = await repo.tryAcquireRecoveryPushClaim(incidentId);
    assert.equal(recovery.status, "acquired");
    const began = await repo.beginRecoveryPushAttempt({
      incidentId,
      claimNonce: recovery.claimNonce,
      now: atMinuteOffset(17),
    });
    assert.equal(began.ok, false);
  });

  it("T17b recovery begin succeeds after resolved episode with fresh state", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    await deliverOutage(repo, incidentId);
    await resolveEpisode(repo);
    const recovery = await repo.tryAcquireRecoveryPushClaim(incidentId);
    assert.equal(recovery.status, "acquired");
    const began = await repo.beginRecoveryPushAttempt({
      incidentId,
      claimNonce: recovery.claimNonce,
      now: atMinuteOffset(31),
    });
    assert.equal(began.ok, true);
  });

  it("T19 outage and recovery metadata remain isolated", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    const outage = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(outage.status, "acquired");
    await repo.beginOutagePushAttempt({
      incidentId,
      claimNonce: outage.claimNonce,
      adminNotificationId: crypto.randomUUID(),
      now: atMinuteOffset(16),
    });
    await repo.recordOutagePushOutcome({
      incidentId,
      claimNonce: outage.claimNonce,
      pushDelivered: 1,
      now: atMinuteOffset(17),
    });
    await resolveEpisode(repo);
    const recovery = await repo.tryAcquireRecoveryPushClaim(incidentId);
    assert.equal(recovery.status, "acquired");
    const row = await repo.getIncidentNotification(incidentId);
    assert.ok(row?.outagePushAttemptStartedAt);
    assert.equal(row?.recoveryPushAttemptStartedAt, null);
    assert.equal(row?.recoveryPushClaimNonce, recovery.claimNonce);
  });

  it("T21 stale reclaim interval constant uses PostgreSQL interval text", () => {
    assert.equal(STALE_UNATTEMPTED_CLAIM_INTERVAL, "10 minutes");
  });

  it("T22 crash after acquire before begin permits safe reclaim", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateFakeQstash(repo);
    const incidentId = await openIncidentFakePg(repo);
    const first = await repo.tryAcquireOutagePushClaim(incidentId);
    store.notifications.get(incidentId)!.updated_at = new Date(
      Date.now() - 11 * 60_000,
    ).toISOString();
    const second = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(second.status, "acquired");
    assert.equal(store.notifications.get(incidentId)?.outage_push_attempt_started_at, null);
  });

  it("T23 crash after committed begin blocks automatic reclaim", async () => {
    const { repo, store } = createFakeWatchdogPgHarness();
    await activateFakeQstash(repo);
    const incidentId = await openIncidentFakePg(repo);
    const first = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(first.status, "acquired");
    await repo.beginOutagePushAttempt({
      incidentId,
      claimNonce: first.claimNonce,
      now: atMinuteOffset(16),
    });
    store.notifications.get(incidentId)!.updated_at = new Date(
      Date.now() - 11 * 60_000,
    ).toISOString();
    assert.equal((await repo.tryAcquireOutagePushClaim(incidentId)).status, "blocked");
  });

  it("outage open active incident permits attempt start", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(acquired.status, "acquired");
    const began = await repo.beginOutagePushAttempt({
      incidentId,
      claimNonce: acquired.claimNonce,
      now: atMinuteOffset(16),
    });
    assert.equal(began.ok, true);
  });

  it("outage inactive incident rejects attempt start", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openIncident(repo);
    const otherId = crypto.randomUUID();
    const acquired = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(acquired.status, "acquired");
    const state = await repo.getState();
    if (state.activeIncidentId === incidentId) {
      const began = await repo.beginOutagePushAttempt({
        incidentId: otherId,
        claimNonce: acquired.claimNonce,
        now: atMinuteOffset(16),
      });
      assert.equal(began.ok, false);
    }
  });

  it("recovery pure predicate rejects outage attempt-start only", () => {
    const notification: IncidentNotificationState = {
      incidentId: "inc-1",
      outagePushClaimStatus: "claimed",
      recoveryPushClaimStatus: "none",
      outagePushSentAt: null,
      outagePushClaimNonce: "n",
      outagePushAttemptStartedAt: new Date().toISOString(),
      outagePushAdminNotificationId: null,
      recoveryPushClaimNonce: null,
      recoveryPushAttemptStartedAt: null,
      recoveryPushAdminNotificationId: null,
      createdAt: BASE.toISOString(),
      updatedAt: BASE.toISOString(),
    };
    assert.equal(outageNotificationWasSent(notification), false);
    const state = createInitialWatchdogState(BASE.toISOString());
    assert.equal(
      recoveryPushAttemptEligibleFromState({
        incident: { status: "resolved", resolvedAt: BASE.toISOString() },
        notification,
        watchdogState: state,
      }),
      false,
    );
  });

  it("outage pure predicate matches PostgreSQL contract", () => {
    assert.equal(
      outagePushAttemptEligibleFromState({
        incidentId: "inc-1",
        incident: { status: "open", resolvedAt: null },
        watchdogState: { activeIncidentId: "inc-1" },
        maintenanceActive: false,
      }),
      true,
    );
    assert.equal(
      outagePushAttemptEligibleFromState({
        incidentId: "inc-1",
        incident: { status: "resolved", resolvedAt: BASE.toISOString() },
        watchdogState: { activeIncidentId: "inc-1" },
        maintenanceActive: false,
      }),
      false,
    );
  });
});
