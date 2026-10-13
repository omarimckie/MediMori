import type { PoolClient } from "@neondatabase/serverless";
import { withMarketingPoolTransaction } from "../../credential-health/heartbeat-store-pool";
import { WATCHDOG_ADVISORY_LOCK_KEY } from "./constants";
import {
  computeObservationSlotId,
  createInitialWatchdogState,
  isActivationPending,
  isPrimaryHeartbeatStale,
} from "./evaluate";
import type {
  CommitObservationInput,
  CommitObservationResult,
  IncidentNotificationState,
  MaintenanceWindow,
  WatchdogPrimaryActivationEvidence,
  WatchdogState,
} from "./types";
import {
  buildCommitObservationResult,
  commitObservationCore,
  type WatchdogCommitStore,
} from "./commit-observation-core";
import {
  ensureIncidentNotificationRow,
  finalizeOutagePushClaimRow,
  finalizeRecoveryPushClaimRow,
  loadIncidentNotificationRow,
  tryAcquireOutagePushClaim,
  tryAcquireRecoveryPushClaim,
} from "./notification-claims";
import {
  insertDispatcherWatchdogIncident,
  resolveDispatcherWatchdogIncident,
} from "./incident-persistence";
import {
  activatePrimaryQstashWatchdog,
  initWatchdogStateRow,
  insertObservationSlot,
  listActiveMaintenanceWindows,
  loadWatchdogStateForUpdate,
  observationSlotExists,
  persistWatchdogState,
  readWatchdogState,
} from "./postgres-persistence";

export type WatchdogRepository = {
  getState(): Promise<WatchdogState>;
  ensureInitialized(now: Date): Promise<WatchdogState>;
  recordPrimaryQstashActivation(
    now: Date,
    evidence?: WatchdogPrimaryActivationEvidence,
  ): Promise<WatchdogState>;
  listMaintenanceWindows(): Promise<MaintenanceWindow[]>;
  addMaintenanceWindow(window: MaintenanceWindow): Promise<void>;
  getIncidentNotification(
    incidentId: string,
  ): Promise<IncidentNotificationState | null>;
  commitObservation(input: CommitObservationInput): Promise<CommitObservationResult>;
  recordOutagePushOutcome(input: {
    incidentId: string;
    pushDelivered: number;
    ambiguous?: boolean;
    now: Date;
  }): Promise<IncidentNotificationState | null>;
  tryAcquireOutagePushClaim(incidentId: string): Promise<"acquired" | "blocked" | "missing">;
  tryAcquireRecoveryPushClaim(incidentId: string): Promise<"acquired" | "blocked" | "missing">;
  finalizeRecoveryPushClaim(input: {
    incidentId: string;
    pushDelivered: number;
    ambiguous?: boolean;
    now: Date;
  }): Promise<IncidentNotificationState | null>;
};

type MemoryStore = {
  state: WatchdogState | null;
  observations: Set<number>;
  incidentNotifications: Map<string, IncidentNotificationState>;
  maintenanceWindows: MaintenanceWindow[];
};

let memoryLock: Promise<void> = Promise.resolve();

async function withMemoryLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = memoryLock;
  memoryLock = previous.then(() => wait);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export function resetMemoryWatchdogRepositoryForTests(): void {
  memoryLock = Promise.resolve();
}

function memoryCommitStore(store: MemoryStore): WatchdogCommitStore {
  return {
    getState() {
      if (!store.state) {
        store.state = createInitialWatchdogState(new Date().toISOString());
      }
      return store.state;
    },
    setState(state) {
      store.state = state;
    },
    hasObservationSlot(slotId) {
      return store.observations.has(slotId);
    },
    addObservationSlot(slotId) {
      store.observations.add(slotId);
    },
    getIncidentNotification(incidentId) {
      return store.incidentNotifications.get(incidentId) ?? null;
    },
    setIncidentNotification(row) {
      store.incidentNotifications.set(row.incidentId, row);
    },
    listMaintenanceWindows() {
      return store.maintenanceWindows;
    },
  };
}

export function createMemoryWatchdogRepository(
  seed?: Partial<MemoryStore>,
): WatchdogRepository {
  const store: MemoryStore = {
    state: seed?.state ?? null,
    observations: seed?.observations ?? new Set(),
    incidentNotifications: seed?.incidentNotifications ?? new Map(),
    maintenanceWindows: seed?.maintenanceWindows ?? [],
  };

  async function ensureInitialized(now: Date): Promise<WatchdogState> {
    if (!store.state) {
      store.state = createInitialWatchdogState(now.toISOString());
    }
    return store.state;
  }

  return {
    async getState() {
      if (!store.state) {
        return createInitialWatchdogState(new Date().toISOString());
      }
      return store.state;
    },

    ensureInitialized,

    async recordPrimaryQstashActivation(now) {
      return withMemoryLock(async () => {
        const state = await ensureInitialized(now);
        if (state.primaryQstashActivatedAt != null) {
          return state;
        }
        state.primaryQstashActivatedAt = now.toISOString();
        state.updatedAt = now.toISOString();
        return { ...state };
      });
    },

    async listMaintenanceWindows() {
      return [...store.maintenanceWindows];
    },

    async addMaintenanceWindow(window: MaintenanceWindow) {
      store.maintenanceWindows.push(window);
    },

    async getIncidentNotification(incidentId: string) {
      return store.incidentNotifications.get(incidentId) ?? null;
    },

    async commitObservation(input: CommitObservationInput) {
      return withMemoryLock(async () =>
        commitObservationCore(memoryCommitStore(store), input),
      );
    },

    async recordOutagePushOutcome({ incidentId, pushDelivered, ambiguous, now }) {
      return withMemoryLock(async () => {
        const row = store.incidentNotifications.get(incidentId);
        if (!row) return null;
        const nowIso = now.toISOString();
        if (ambiguous || pushDelivered > 0) {
          row.outagePushClaimStatus = ambiguous ? "ambiguous" : "delivered";
          row.outagePushSentAt = row.outagePushSentAt ?? nowIso;
        } else {
          row.outagePushClaimStatus = "failed";
        }
        row.updatedAt = nowIso;
        return { ...row };
      });
    },

    async tryAcquireOutagePushClaim(incidentId) {
      const row = store.incidentNotifications.get(incidentId);
      if (!row) return "missing";
      if (row.outagePushClaimStatus === "delivered" || row.outagePushClaimStatus === "ambiguous") {
        return "blocked";
      }
      if (row.outagePushClaimStatus === "claimed") return "blocked";
      if (row.outagePushClaimStatus === "none" || row.outagePushClaimStatus === "failed") {
        row.outagePushClaimStatus = "claimed";
        return "acquired";
      }
      return "blocked";
    },

    async tryAcquireRecoveryPushClaim(incidentId) {
      const row = store.incidentNotifications.get(incidentId);
      if (!row) return "missing";
      if (!row.outagePushSentAt && row.outagePushClaimStatus !== "delivered" && row.outagePushClaimStatus !== "ambiguous") {
        return "blocked";
      }
      if (row.recoveryPushClaimStatus === "delivered" || row.recoveryPushClaimStatus === "ambiguous") {
        return "blocked";
      }
      if (row.recoveryPushClaimStatus === "claimed") return "blocked";
      if (row.recoveryPushClaimStatus === "none" || row.recoveryPushClaimStatus === "failed") {
        row.recoveryPushClaimStatus = "claimed";
        return "acquired";
      }
      return "blocked";
    },

    async finalizeRecoveryPushClaim({ incidentId, pushDelivered, ambiguous, now }) {
      const row = store.incidentNotifications.get(incidentId);
      if (!row) return null;
      row.recoveryPushClaimStatus =
        ambiguous || pushDelivered > 0
          ? ambiguous
            ? "ambiguous"
            : "delivered"
          : "failed";
      row.updatedAt = now.toISOString();
      return { ...row };
    },
  };
}

export type PostgresWatchdogDeps = {
  runWatchdogTransaction?: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
};

function assertActivationEvidence(
  evidence?: WatchdogPrimaryActivationEvidence,
): WatchdogPrimaryActivationEvidence {
  if (!evidence || evidence.verificationKind !== "qstash_signature_verified") {
    throw new Error("watchdog_activation_requires_verified_qstash_evidence");
  }
  return evidence;
}

export async function commitPostgresObservation(
  client: PoolClient,
  input: CommitObservationInput,
): Promise<CommitObservationResult> {
  const now = input.now;
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const observationSlotId = computeObservationSlotId(nowMs);

  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
    WATCHDOG_ADVISORY_LOCK_KEY,
  ]);
  await initWatchdogStateRow(client, nowIso);
  const state = await loadWatchdogStateForUpdate(client);

  const stale = isPrimaryHeartbeatStale(input.primaryLastSeenAt, nowMs);
  const activationPending = isActivationPending(state);

  if (await observationSlotExists(client, observationSlotId)) {
    return buildCommitObservationResult({
      outcome: "duplicate_slot",
      observationSlotId,
      activationPending,
      stale,
      state,
      incidentNotification: state.activeIncidentId
        ? await loadIncidentNotificationRow(client, state.activeIncidentId)
        : null,
    });
  }

  if (observationSlotId < state.lastCommittedObservationSlotId) {
    return buildCommitObservationResult({
      outcome: "ignored_late_slot",
      observationSlotId,
      activationPending,
      stale,
      state,
      incidentNotification: state.activeIncidentId
        ? await loadIncidentNotificationRow(client, state.activeIncidentId)
        : null,
    });
  }

  const maintenanceWindows = await listActiveMaintenanceWindows(client, nowIso);

  const volatile: MemoryStore = {
    state: { ...state },
    observations: new Set<number>(),
    incidentNotifications: new Map(),
    maintenanceWindows,
  };

  if (state.activeIncidentId) {
    const row = await loadIncidentNotificationRow(client, state.activeIncidentId);
    if (row) {
      volatile.incidentNotifications.set(row.incidentId, row);
    }
  }

  const result = commitObservationCore(memoryCommitStore(volatile), input);

  const inserted = await insertObservationSlot(client, {
    observationSlotId,
    observedAt: nowIso,
    githubRunId: input.githubRunId ?? null,
    githubRunAttempt: input.githubRunAttempt ?? null,
    primaryLastSeenAt: input.primaryLastSeenAt,
    stale,
    activationPending: result.activationPending,
    outcome: result.outcome,
  });
  if (!inserted) {
    throw new Error("watchdog_observation_insert_race");
  }

  if (result.openedIncidentId) {
    await insertDispatcherWatchdogIncident(client, {
      incidentId: result.openedIncidentId,
      detectedAt: nowIso,
      evidence: {
        observationSlotId,
        primaryLastSeenAt: input.primaryLastSeenAt,
      },
    });
    await ensureIncidentNotificationRow(client, result.openedIncidentId);
  }

  if (result.resolvedIncidentId) {
    await resolveDispatcherWatchdogIncident(client, {
      incidentId: result.resolvedIncidentId,
      resolvedAt: nowIso,
      resolutionSummary: "Primary QStash dispatcher heartbeat recovered.",
    });
  }

  await persistWatchdogState(client, result.state);

  let incidentNotification = result.incidentNotification;
  if (result.state.activeIncidentId) {
    incidentNotification = await loadIncidentNotificationRow(
      client,
      result.state.activeIncidentId,
    );
  }

  return {
    ...result,
    incidentNotification,
  };
}

export function createPostgresWatchdogRepository(
  deps: PostgresWatchdogDeps = {},
): WatchdogRepository {
  const runTx =
    deps.runWatchdogTransaction ??
    (<T>(fn: (client: PoolClient) => Promise<T>) => withWatchdogAdvisoryLock(fn));

  return {
    async getState() {
      return runTx(async (client) => {
        await initWatchdogStateRow(client, new Date().toISOString());
        const state = await readWatchdogState(client);
        return state ?? createInitialWatchdogState(new Date().toISOString());
      });
    },

    async ensureInitialized(now: Date) {
      return runTx(async (client) => {
        await initWatchdogStateRow(client, now.toISOString());
        return loadWatchdogStateForUpdate(client);
      });
    },

    async recordPrimaryQstashActivation(now, evidence?) {
      const verified = assertActivationEvidence(evidence);
      return runTx(async (client) => {
        await initWatchdogStateRow(client, now.toISOString());
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
          WATCHDOG_ADVISORY_LOCK_KEY,
        ]);
        return activatePrimaryQstashWatchdog(client, {
          activatedAt: verified.verifiedAt ?? now.toISOString(),
          attestationId: verified.attestationId,
        });
      });
    },

    async listMaintenanceWindows() {
      return runTx(async (client) =>
        listActiveMaintenanceWindows(client, new Date().toISOString()),
      );
    },

    async addMaintenanceWindow(window: MaintenanceWindow) {
      return runTx(async (client) => {
        await client.query(
          `INSERT INTO marketing_dispatcher_maintenance_windows (
            id, starts_at, ends_at, reason, created_by, created_at
          ) VALUES ($1::uuid, $2::timestamptz, $3::timestamptz, $4, $5, $6::timestamptz)`,
          [
            window.id,
            window.startsAt,
            window.endsAt,
            window.reason,
            window.createdBy,
            window.createdAt,
          ],
        );
      });
    },

    async getIncidentNotification(incidentId: string) {
      return runTx(async (client) => loadIncidentNotificationRow(client, incidentId));
    },

    async commitObservation(input: CommitObservationInput) {
      return runTx(async (client) => commitPostgresObservation(client, input));
    },

    async recordOutagePushOutcome({ incidentId, pushDelivered, ambiguous, now }) {
      return runTx(async (client) =>
        finalizeOutagePushClaimRow(client, {
          incidentId,
          pushDelivered,
          ambiguous,
          nowIso: now.toISOString(),
        }),
      );
    },

    async tryAcquireOutagePushClaim(incidentId) {
      return runTx(async (client) => tryAcquireOutagePushClaim(client, incidentId));
    },

    async tryAcquireRecoveryPushClaim(incidentId) {
      return runTx(async (client) => tryAcquireRecoveryPushClaim(client, incidentId));
    },

    async finalizeRecoveryPushClaim(input) {
      return runTx(async (client) =>
        finalizeRecoveryPushClaimRow(client, {
          ...input,
          nowIso: input.now.toISOString(),
        }),
      );
    },
  };
}

export async function withWatchdogAdvisoryLock<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withMarketingPoolTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
      WATCHDOG_ADVISORY_LOCK_KEY,
    ]);
    return fn(client);
  });
}

export async function loadOrInitWatchdogStateRow(
  client: PoolClient,
  nowIso: string,
): Promise<WatchdogState> {
  await initWatchdogStateRow(client, nowIso);
  return loadWatchdogStateForUpdate(client);
}
