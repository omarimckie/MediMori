import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { STALE_THRESHOLD_MS } from "./constants";
import {
  classifyWatchdogPushDelivery,
  deliverWatchdogOutagePush,
  deliverWatchdogRecoveryPush,
} from "./deliver-watchdog-push";
import { createMemoryWatchdogRepository, resetMemoryWatchdogRepositoryForTests } from "./repository";

const BASE = new Date("2026-10-12T12:07:00.000Z");
const ADMIN = "owner";

function atMinuteOffset(minutes: number): Date {
  return new Date(BASE.getTime() + minutes * 60_000);
}

function staleLastSeen(now: Date, extraMs = 60_000): string {
  return new Date(now.getTime() - STALE_THRESHOLD_MS - extraMs).toISOString();
}

async function openOutageIncident(repo: ReturnType<typeof createMemoryWatchdogRepository>) {
  await repo.recordPrimaryQstashActivation(atMinuteOffset(0));
  await repo.commitObservation({
    now: atMinuteOffset(0),
    primaryLastSeenAt: staleLastSeen(atMinuteOffset(0)),
  });
  const second = await repo.commitObservation({
    now: atMinuteOffset(15),
    primaryLastSeenAt: staleLastSeen(atMinuteOffset(15)),
  });
  assert.ok(second.openedIncidentId);
  return second.openedIncidentId!;
}

afterEach(() => {
  resetMemoryWatchdogRepositoryForTests();
});

describe("classifyWatchdogPushDelivery", () => {
  it("treats partial delivery as ambiguous", () => {
    const classified = classifyWatchdogPushDelivery({
      pushAttempted: 2,
      pushDelivered: 1,
      deliveryStatus: "partial",
    });
    assert.equal(classified.ambiguous, true);
    assert.equal(classified.pushDelivered, 1);
  });

  it("treats zero attempts as failed", () => {
    const classified = classifyWatchdogPushDelivery({
      pushAttempted: 0,
      pushDelivered: 0,
      deliveryStatus: "skipped",
    });
    assert.equal(classified.ambiguous, false);
    assert.equal(classified.pushDelivered, 0);
  });
});

describe("deliverWatchdogOutagePush", () => {
  it("finalizes delivered outage push after begin", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openOutageIncident(repo);
    const result = await deliverWatchdogOutagePush(
      repo,
      {
        incidentId,
        now: atMinuteOffset(15),
        payload: {
          type: "dispatcher_warning",
          severity: "error",
          title: "Outage",
          body: "Stale",
          destination: "/admin/marketing",
          adminUsername: ADMIN,
        },
      },
      {
        createNotification: async (payload) => ({
          id: "notif-1",
          deliveryStatus: "pending",
          ...payload,
        } as never),
        listSubscriptions: async () => [
          {
            id: "sub-1",
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
        sendToSubscription: async () => ({ ok: true, permanentFailure: false }),
        updateDelivery: async () => {},
      },
    );
    assert.equal(result.status, "finalized");
    assert.equal(result.pushDelivered, 1);
    assert.equal(result.ambiguous, false);
    const row = await repo.getIncidentNotification(incidentId);
    assert.equal(row?.outagePushClaimStatus, "delivered");
  });

  it("finalizes ambiguous outcome on partial provider delivery", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openOutageIncident(repo);
    const result = await deliverWatchdogOutagePush(
      repo,
      {
        incidentId,
        now: atMinuteOffset(15),
        payload: {
          type: "dispatcher_warning",
          severity: "error",
          title: "Outage",
          body: "Stale",
          destination: "/admin/marketing",
          adminUsername: ADMIN,
        },
      },
      {
        createNotification: async (payload) => ({
          id: "notif-2",
          deliveryStatus: "pending",
          ...payload,
        } as never),
        listSubscriptions: async () => [
          {
            id: "s1",
            adminUsername: ADMIN,
            endpoint: "https://a",
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
          {
            id: "s2",
            adminUsername: ADMIN,
            endpoint: "https://b",
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
        sendToSubscription: async (sub) => ({ ok: sub.id === "s1", permanentFailure: false }),
        updateDelivery: async () => {},
      },
    );
    assert.equal(result.status, "finalized");
    assert.equal(result.ambiguous, true);
    assert.equal(result.pushDelivered, 1);
    const row = await repo.getIncidentNotification(incidentId);
    assert.equal(row?.outagePushClaimStatus, "ambiguous");
  });

  it("blocks duplicate outage notification after delivered claim", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openOutageIncident(repo);
    const deps = {
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
      sendToSubscription: async () => ({ ok: true, permanentFailure: false }),
      updateDelivery: async () => {},
    };
    const first = await deliverWatchdogOutagePush(
      repo,
      {
        incidentId,
        now: atMinuteOffset(15),
        payload: {
          type: "dispatcher_warning",
          severity: "error",
          title: "Outage",
          body: "Stale",
          destination: "/admin/marketing",
          adminUsername: ADMIN,
        },
      },
      deps,
    );
    assert.equal(first.status, "finalized");
    const second = await deliverWatchdogOutagePush(
      repo,
      {
        incidentId,
        now: atMinuteOffset(30),
        payload: {
          type: "dispatcher_warning",
          severity: "error",
          title: "Outage",
          body: "Stale",
          destination: "/admin/marketing",
          adminUsername: ADMIN,
        },
      },
      deps,
    );
    assert.equal(second.status, "acquire_blocked");
  });

  it("finalizes failed outcome when provider delivery fails", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openOutageIncident(repo);
    const result = await deliverWatchdogOutagePush(
      repo,
      {
        incidentId,
        now: atMinuteOffset(15),
        payload: {
          type: "dispatcher_warning",
          severity: "error",
          title: "Outage",
          body: "Stale",
          destination: "/admin/marketing",
          adminUsername: ADMIN,
        },
      },
      {
        createNotification: async (payload) => ({
          id: "notif-fail",
          deliveryStatus: "pending",
          ...payload,
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
        sendToSubscription: async () => ({ ok: false, permanentFailure: false }),
        updateDelivery: async () => {},
      },
    );
    assert.equal(result.status, "finalized");
    assert.equal(result.pushDelivered, 0);
    assert.equal(result.ambiguous, false);
    const row = await repo.getIncidentNotification(incidentId);
    assert.equal(row?.outagePushClaimStatus, "failed");
  });

  it("rejects begin when claim nonce does not match", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openOutageIncident(repo);
    const claim = await repo.tryAcquireOutagePushClaim(incidentId);
    assert.equal(claim.status, "acquired");
    const begun = await repo.beginOutagePushAttempt({
      incidentId,
      claimNonce: "00000000-0000-4000-8000-000000000099",
      adminNotificationId: "n1",
      now: atMinuteOffset(15),
    });
    assert.equal(begun.ok, false);
  });
});

describe("deliverWatchdogRecoveryPush", () => {
  it("delivers recovery only after outage was sent", async () => {
    const repo = createMemoryWatchdogRepository();
    const incidentId = await openOutageIncident(repo);
    await deliverWatchdogOutagePush(
      repo,
      {
        incidentId,
        now: atMinuteOffset(15),
        payload: {
          type: "dispatcher_warning",
          severity: "error",
          title: "Outage",
          body: "Stale",
          destination: "/admin/marketing",
          adminUsername: ADMIN,
        },
      },
      {
        createNotification: async (payload) => ({
          id: "outage-notif",
          deliveryStatus: "pending",
          ...payload,
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
        sendToSubscription: async () => ({ ok: true, permanentFailure: false }),
        updateDelivery: async () => {},
      },
    );
    const recovered = await repo.commitObservation({
      now: atMinuteOffset(30),
      primaryLastSeenAt: new Date(atMinuteOffset(30).getTime() - 5 * 60_000).toISOString(),
    });
    assert.ok(recovered.notificationEligibility.recoveryNotificationEligible);
    const recovery = await deliverWatchdogRecoveryPush(
      repo,
      {
        incidentId,
        now: atMinuteOffset(30),
        payload: {
          type: "dispatcher_warning",
          severity: "info",
          title: "Recovered",
          body: "OK",
          destination: "/admin/marketing",
          adminUsername: ADMIN,
        },
      },
      {
        createNotification: async (payload) => ({
          id: "recovery-notif",
          deliveryStatus: "pending",
          ...payload,
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
        sendToSubscription: async () => ({ ok: true, permanentFailure: false }),
        updateDelivery: async () => {},
      },
    );
    assert.equal(recovery.status, "finalized");
  });
});
