import type { PoolClient } from "@neondatabase/serverless";
import { withMarketingPoolTransaction } from "../../credential-health/heartbeat-store-pool";
import {
  WATCHDOG_ADVISORY_LOCK_KEY,
  WATCHDOG_STATE_ID,
} from "./constants";
import {
  applyCommittedObservation,
  computeObservationSlotId,
  createInitialWatchdogState,
  isActivationPending,
  isMaintenanceActive,
  isPrimaryHeartbeatStale,
} from "./evaluate";
import type {
  CommitObservationInput,
  CommitObservationResult,
  IncidentNotificationState,
  MaintenanceWindow,
  ObservationOutcome,
  WatchdogState,
} from "./types";

export type WatchdogRepository = {
  getState(): Promise<WatchdogState>;
  ensureInitialized(now: Date): Promise<WatchdogState>;
  recordPrimaryQstashActivation(now: Date): Promise<WatchdogState>;
  listMaintenanceWindows(): Promise<MaintenanceWindow[]>;
  addMaintenanceWindow(window: MaintenanceWindow): Promise<void>;
  getIncidentNotification(
    incidentId: string,
  ): Promise<IncidentNotificationState | null>;
  commitObservation(input: CommitObservationInput): Promise<CommitObservationResult>;
  /** Test helper: apply outage push claim without sending notifications. */
  recordOutagePushOutcome(input: {
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

    async recordPrimaryQstashActivation(now: Date) {
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
      return withMemoryLock(async () => commitObservationInStore(store, input));
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
  };
}

async function commitObservationInStore(
  store: MemoryStore,
  input: CommitObservationInput,
): Promise<CommitObservationResult> {
  const now = input.now;
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const state = await (async () => {
    if (!store.state) {
      store.state = createInitialWatchdogState(nowIso);
    }
    return store.state;
  })();

  const observationSlotId = computeObservationSlotId(nowMs);
  const stale = isPrimaryHeartbeatStale(input.primaryLastSeenAt, nowMs);
  const activationPending = isActivationPending(state);

  if (store.observations.has(observationSlotId)) {
    return buildResult({
      outcome: "duplicate_slot",
      observationSlotId,
      activationPending,
      stale,
      state,
      incidentNotification: state.activeIncidentId
        ? store.incidentNotifications.get(state.activeIncidentId) ?? null
        : null,
    });
  }

  if (observationSlotId < state.lastCommittedObservationSlotId) {
    return buildResult({
      outcome: "ignored_late_slot",
      observationSlotId,
      activationPending,
      stale,
      state,
      incidentNotification: state.activeIncidentId
        ? store.incidentNotifications.get(state.activeIncidentId) ?? null
        : null,
    });
  }

  store.observations.add(observationSlotId);

  if (activationPending) {
    const nextState: WatchdogState = {
      ...state,
      lastPrimaryLastSeenAt: input.primaryLastSeenAt,
      lastCommittedObservationSlotId: observationSlotId,
      lastObservationWasStale: stale,
      updatedAt: nowIso,
    };
    store.state = nextState;
    return buildResult({
      outcome: "ignored_not_activated",
      observationSlotId,
      activationPending: true,
      stale,
      state: nextState,
      incidentNotification: null,
    });
  }

  const maintenanceActive = isMaintenanceActive(store.maintenanceWindows, nowMs);
  const incidentNotification = state.activeIncidentId
    ? store.incidentNotifications.get(state.activeIncidentId) ?? null
    : null;

  const applied = applyCommittedObservation({
    state,
    incidentNotification,
    primaryLastSeenAt: input.primaryLastSeenAt,
    stale,
    nowMs,
    nowIso,
    observationSlotId,
    maintenanceActive,
    createIncidentId: () => crypto.randomUUID(),
  });

  store.state = applied.state;
  if (applied.openedIncidentId && applied.incidentNotification) {
    store.incidentNotifications.set(
      applied.openedIncidentId,
      applied.incidentNotification,
    );
  } else if (applied.state.activeIncidentId && applied.incidentNotification) {
    store.incidentNotifications.set(
      applied.state.activeIncidentId,
      applied.incidentNotification,
    );
  }

  if (applied.resolvedIncidentId) {
    // Historical notification row retained; active pointer cleared in state.
  }

  return {
    outcome: "committed",
    observationSlotId,
    activationPending: false,
    stale,
    state: applied.state,
    incidentNotification: applied.state.activeIncidentId
      ? store.incidentNotifications.get(applied.state.activeIncidentId) ?? null
      : applied.incidentNotification,
    notificationEligibility: applied.notificationEligibility,
    openedIncidentId: applied.openedIncidentId,
    resolvedIncidentId: applied.resolvedIncidentId,
  };
}

function buildResult(input: {
  outcome: ObservationOutcome;
  observationSlotId: number;
  activationPending: boolean;
  stale: boolean;
  state: WatchdogState;
  incidentNotification: IncidentNotificationState | null;
}): CommitObservationResult {
  return {
    outcome: input.outcome,
    observationSlotId: input.observationSlotId,
    activationPending: input.activationPending,
    stale: input.stale,
    state: input.state,
    incidentNotification: input.incidentNotification,
    notificationEligibility: {
      outageNotificationEligible: false,
      recoveryNotificationEligible: false,
      deferredOutagePending: input.state.deferredOutagePush,
    },
    openedIncidentId: null,
    resolvedIncidentId: null,
  };
}

function mapStateRow(row: Record<string, unknown>): WatchdogState {
  return {
    id: String(row.id),
    primaryQstashActivatedAt:
      row.primary_qstash_activated_at == null
        ? null
        : new Date(String(row.primary_qstash_activated_at)).toISOString(),
    consecutiveStaleObservations: Number(row.consecutive_stale_observations ?? 0),
    lastPrimaryLastSeenAt:
      row.last_primary_last_seen_at == null
        ? null
        : new Date(String(row.last_primary_last_seen_at)).toISOString(),
    lastCommittedObservationSlotId: Number(row.last_committed_observation_slot_id ?? -1),
    lastObservationWasStale: Boolean(row.last_observation_was_stale),
    activeIncidentId: row.active_incident_id == null ? null : String(row.active_incident_id),
    deferredOutagePush: Boolean(row.deferred_outage_push),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

/**
 * Postgres persistence (requires DATABASE_URL).
 * Not exercised in P0 CI without a live database.
 */
export function createPostgresWatchdogRepository(): WatchdogRepository {
  return {
    async getState() {
      throw new Error("Postgres watchdog repository is not wired in P0 tests.");
    },
    async ensureInitialized() {
      throw new Error("Postgres watchdog repository is not wired in P0 tests.");
    },
    async recordPrimaryQstashActivation() {
      throw new Error("Postgres watchdog repository is not wired in P0 tests.");
    },
    async listMaintenanceWindows() {
      throw new Error("Postgres watchdog repository is not wired in P0 tests.");
    },
    async addMaintenanceWindow() {
      throw new Error("Postgres watchdog repository is not wired in P0 tests.");
    },
    async getIncidentNotification() {
      throw new Error("Postgres watchdog repository is not wired in P0 tests.");
    },
    async commitObservation() {
      throw new Error("Postgres watchdog repository is not wired in P0 tests.");
    },
    async recordOutagePushOutcome() {
      throw new Error("Postgres watchdog repository is not wired in P0 tests.");
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
  const existing = await client.query(
    `SELECT * FROM marketing_dispatcher_watchdog_state WHERE id = $1`,
    [WATCHDOG_STATE_ID],
  );
  if (existing.rows.length > 0) {
    return mapStateRow(existing.rows[0] as Record<string, unknown>);
  }
  await client.query(
    `INSERT INTO marketing_dispatcher_watchdog_state (id, updated_at)
     VALUES ($1, $2::timestamptz)
     ON CONFLICT (id) DO NOTHING`,
    [WATCHDOG_STATE_ID, nowIso],
  );
  const loaded = await client.query(
    `SELECT * FROM marketing_dispatcher_watchdog_state WHERE id = $1`,
    [WATCHDOG_STATE_ID],
  );
  return mapStateRow(loaded.rows[0] as Record<string, unknown>);
}
