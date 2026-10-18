import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { STALE_THRESHOLD_MS } from "./constants";
import { runWatchdogTick } from "./run-watchdog-tick";
import { createMemoryWatchdogRepository, resetMemoryWatchdogRepositoryForTests } from "./repository";

const BASE = new Date("2026-10-12T12:07:00.000Z");
const ADMIN = "owner";

function atMinuteOffset(minutes: number): Date {
  return new Date(BASE.getTime() + minutes * 60_000);
}

function staleLastSeen(now: Date, extraMs = 60_000): string {
  return new Date(now.getTime() - STALE_THRESHOLD_MS - extraMs).toISOString();
}

function freshLastSeen(now: Date): string {
  return new Date(now.getTime() - 5 * 60_000).toISOString();
}

const mockPushDeps = {
  createNotification: async (payload: unknown) => ({
    id: crypto.randomUUID(),
    deliveryStatus: "pending",
    ...(payload as object),
  } as never),
  listSubscriptions: async () => [
    {
      id: "sub",
      adminUsername: ADMIN,
      endpoint: "https://example",
      p256dh: "k",
      auth: "a",
      userAgent: null,
      enabled: true,
      createdAt: "",
      updatedAt: "",
      lastSuccessAt: null,
      lastFailureAt: null,
      failureCount: 0,
    },
  ],
  sendToSubscription: async () => ({ ok: true }),
  updateDelivery: async () => {},
};

afterEach(() => {
  resetMemoryWatchdogRepositoryForTests();
});

describe("runWatchdogTick", () => {
  it("uses only injected primary last seen (ignores backup-style signals)", async () => {
    const repo = createMemoryWatchdogRepository();
    let loaderCalls = 0;
    const backupWouldBeFresh = freshLastSeen(atMinuteOffset(0));
    const result = await runWatchdogTick(
      { now: atMinuteOffset(0), adminUsername: ADMIN },
      {
        repo,
        loadPrimaryLastSeenAt: async () => {
          loaderCalls += 1;
          return staleLastSeen(atMinuteOffset(0));
        },
        deliverPushDeps: mockPushDeps,
      },
    );
    assert.equal(loaderCalls, 1);
    assert.equal(result.primaryLastSeenAt, staleLastSeen(atMinuteOffset(0)));
    assert.notEqual(result.primaryLastSeenAt, backupWouldBeFresh);
    assert.equal(result.observation.activationPending, true);
  });

  it("reports fresh verified primary heartbeat as not stale", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    const result = await runWatchdogTick(
      { now: atMinuteOffset(0), adminUsername: ADMIN },
      {
        repo,
        loadPrimaryLastSeenAt: async () => freshLastSeen(atMinuteOffset(0)),
        deliverPushDeps: mockPushDeps,
      },
    );
    assert.equal(result.observation.stale, false);
    assert.equal(result.observation.outcome, "committed");
    assert.equal(result.push.outage.attempted, false);
  });

  it("requires two distinct stale observations before outage push", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    const first = await runWatchdogTick(
      { now: atMinuteOffset(0), adminUsername: ADMIN },
      {
        repo,
        loadPrimaryLastSeenAt: async () => staleLastSeen(atMinuteOffset(0)),
        deliverPushDeps: mockPushDeps,
      },
    );
    assert.equal(first.observation.state.consecutiveStaleObservations, 1);
    assert.equal(first.push.outage.attempted, false);

    const second = await runWatchdogTick(
      { now: atMinuteOffset(15), adminUsername: ADMIN },
      {
        repo,
        loadPrimaryLastSeenAt: async () => staleLastSeen(atMinuteOffset(15)),
        deliverPushDeps: mockPushDeps,
      },
    );
    assert.equal(second.observation.state.consecutiveStaleObservations, 2);
    assert.equal(second.push.outage.attempted, true);
    assert.equal(second.push.outage.result, "finalized");
  });

  it("suppresses outage push during maintenance", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    await repo.addMaintenanceWindow({
      id: crypto.randomUUID(),
      startsAt: atMinuteOffset(-60).toISOString(),
      endsAt: atMinuteOffset(60).toISOString(),
      reason: "deploy",
      createdBy: ADMIN,
      createdAt: atMinuteOffset(-60).toISOString(),
    });
    await runWatchdogTick(
      { now: atMinuteOffset(0), adminUsername: ADMIN },
      {
        repo,
        loadPrimaryLastSeenAt: async () => staleLastSeen(atMinuteOffset(0)),
        deliverPushDeps: mockPushDeps,
      },
    );
    const second = await runWatchdogTick(
      { now: atMinuteOffset(15), adminUsername: ADMIN },
      {
        repo,
        loadPrimaryLastSeenAt: async () => staleLastSeen(atMinuteOffset(15)),
        deliverPushDeps: mockPushDeps,
      },
    );
    assert.equal(second.observation.state.deferredOutagePush, true);
    assert.equal(second.push.outage.attempted, false);
  });

  it("attempts deferred outage after maintenance ends", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    await repo.addMaintenanceWindow({
      id: crypto.randomUUID(),
      startsAt: atMinuteOffset(-30).toISOString(),
      endsAt: atMinuteOffset(16).toISOString(),
      reason: "deploy",
      createdBy: ADMIN,
      createdAt: atMinuteOffset(-30).toISOString(),
    });
    await runWatchdogTick(
      { now: atMinuteOffset(0), adminUsername: ADMIN },
      {
        repo,
        loadPrimaryLastSeenAt: async () => staleLastSeen(atMinuteOffset(0)),
        deliverPushDeps: mockPushDeps,
      },
    );
    const second = await runWatchdogTick(
      { now: atMinuteOffset(15), adminUsername: ADMIN },
      {
        repo,
        loadPrimaryLastSeenAt: async () => staleLastSeen(atMinuteOffset(15)),
        deliverPushDeps: mockPushDeps,
      },
    );
    assert.equal(second.observation.state.deferredOutagePush, true);
    assert.equal(second.push.outage.attempted, false);
    const third = await runWatchdogTick(
      { now: atMinuteOffset(30), adminUsername: ADMIN },
      {
        repo,
        loadPrimaryLastSeenAt: async () => staleLastSeen(atMinuteOffset(30)),
        deliverPushDeps: mockPushDeps,
      },
    );
    assert.equal(third.observation.notificationEligibility.outageNotificationEligible, true);
    assert.equal(third.push.outage.attempted, true);
  });

  it("does not duplicate observation slots in the same window", async () => {
    const repo = createMemoryWatchdogRepository();
    await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
    const deps = {
      repo,
      loadPrimaryLastSeenAt: async () => staleLastSeen(atMinuteOffset(0)),
      deliverPushDeps: mockPushDeps,
    };
    const first = await runWatchdogTick({ now: atMinuteOffset(0), adminUsername: ADMIN }, deps);
    const dup = await runWatchdogTick({ now: atMinuteOffset(0), adminUsername: ADMIN }, deps);
    assert.equal(first.observation.outcome, "committed");
    assert.equal(dup.observation.outcome, "duplicate_slot");
  });

  it("does not invoke publishing side effects", async () => {
    const repo = createMemoryWatchdogRepository();
    const publishCalled = { value: false };
    await runWatchdogTick(
      { now: atMinuteOffset(0), adminUsername: ADMIN },
      {
        repo,
        loadPrimaryLastSeenAt: async () => null,
        deliverPushDeps: mockPushDeps,
      },
    );
    assert.equal(publishCalled.value, false);
  });
});
