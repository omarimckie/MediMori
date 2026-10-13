import type { PoolClient } from "@neondatabase/serverless";
import { WATCHDOG_STATE_ID } from "./constants";
import type { MaintenanceWindow } from "./types";
import {
  createPostgresWatchdogRepository,
  type PostgresWatchdogDeps,
} from "./repository";

type StateRow = {
  id: string;
  primary_qstash_activated_at: string | null;
  consecutive_stale_observations: number;
  last_primary_last_seen_at: string | null;
  last_committed_observation_slot_id: number;
  last_observation_was_stale: boolean;
  active_incident_id: string | null;
  deferred_outage_push: boolean;
  updated_at: string;
};

type ObservationRow = {
  observation_slot_id: number;
  observed_at: string;
  github_run_id: string | null;
  github_run_attempt: string | null;
  primary_last_seen_at: string | null;
  stale: boolean;
  activation_pending: boolean;
  outcome: string;
};

type IncidentRow = {
  id: string;
  dedupe_key: string;
  status: string;
  [key: string]: unknown;
};

type NotificationRow = {
  incident_id: string;
  outage_push_claim_status: string;
  recovery_push_claim_status: string;
  outage_push_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FakeWatchdogPgStore = {
  state: StateRow | null;
  observations: Map<number, ObservationRow>;
  incidents: Map<string, IncidentRow>;
  incidentEvents: Array<Record<string, unknown>>;
  notifications: Map<string, NotificationRow>;
  maintenanceWindows: MaintenanceWindow[];
  failNextIncidentInsert: boolean;
  failNextObservationInsert: boolean;
};

function defaultStateRow(nowIso: string): StateRow {
  return {
    id: WATCHDOG_STATE_ID,
    primary_qstash_activated_at: null,
    consecutive_stale_observations: 0,
    last_primary_last_seen_at: null,
    last_committed_observation_slot_id: -1,
    last_observation_was_stale: false,
    active_incident_id: null,
    deferred_outage_push: false,
    updated_at: nowIso,
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function cloneStore(store: FakeWatchdogPgStore): FakeWatchdogPgStore {
  return {
    state: store.state ? { ...store.state } : null,
    observations: new Map(
      [...store.observations.entries()].map(([k, v]) => [k, { ...v }]),
    ),
    incidents: new Map(
      [...store.incidents.entries()].map(([k, v]) => [k, { ...v }]),
    ),
    incidentEvents: store.incidentEvents.map((e) => ({ ...e })),
    notifications: new Map(
      [...store.notifications.entries()].map(([k, v]) => [k, { ...v }]),
    ),
    maintenanceWindows: store.maintenanceWindows.map((w) => ({ ...w })),
    failNextIncidentInsert: store.failNextIncidentInsert,
    failNextObservationInsert: store.failNextObservationInsert,
  };
}

export function createFakeWatchdogPgStore(): FakeWatchdogPgStore {
  return {
    state: null,
    observations: new Map(),
    incidents: new Map(),
    incidentEvents: [],
    notifications: new Map(),
    maintenanceWindows: [],
    failNextIncidentInsert: false,
    failNextObservationInsert: false,
  };
}

class Mutex {
  private chain: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.chain;
    this.chain = previous.then(() => gate);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

function queryResult(rows: Record<string, unknown>[], rowCount?: number) {
  return {
    rows,
    rowCount: rowCount ?? rows.length,
  };
}

export function createFakeWatchdogPoolClient(
  store: FakeWatchdogPgStore,
): PoolClient {
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      const normalized = normalizeSql(sql);
      const p = params ?? [];

      if (normalized.includes("pg_advisory_xact_lock")) {
        return queryResult([]);
      }

      if (
        normalized.includes("insert into marketing_dispatcher_watchdog_state") &&
        normalized.includes("on conflict")
      ) {
        const id = String(p[0]);
        const updatedAt = String(p[1]);
        if (!store.state || store.state.id !== id) {
          store.state = defaultStateRow(updatedAt);
        }
        return queryResult([]);
      }

      if (
        normalized.includes("from marketing_dispatcher_watchdog_state") &&
        normalized.includes("for update")
      ) {
        if (!store.state) {
          throw new Error("watchdog_state_missing_after_init");
        }
        return queryResult([{ ...store.state }]);
      }

      if (
        normalized.includes("from marketing_dispatcher_watchdog_state") &&
        !normalized.includes("for update")
      ) {
        if (!store.state) {
          return queryResult([]);
        }
        return queryResult([{ ...store.state }]);
      }

      if (normalized.startsWith("update marketing_dispatcher_watchdog_state")) {
        if (normalized.includes("consecutive_stale_observations = $3")) {
          const [
            id,
            primaryQstashActivatedAt,
            consecutiveStale,
            lastPrimaryLastSeenAt,
            lastCommittedSlot,
            lastObservationWasStale,
            activeIncidentId,
            deferredOutagePush,
            updatedAt,
          ] = p as [
            string,
            string | null,
            number,
            string | null,
            number,
            boolean,
            string | null,
            boolean,
            string,
          ];
          if (!store.state || store.state.id !== id) {
            return queryResult([]);
          }
          store.state = {
            ...store.state,
            primary_qstash_activated_at: primaryQstashActivatedAt,
            consecutive_stale_observations: consecutiveStale,
            last_primary_last_seen_at: lastPrimaryLastSeenAt,
            last_committed_observation_slot_id: lastCommittedSlot,
            last_observation_was_stale: lastObservationWasStale,
            active_incident_id: activeIncidentId,
            deferred_outage_push: deferredOutagePush,
            updated_at: updatedAt,
          };
          return queryResult([]);
        }

        if (
          normalized.includes("primary_qstash_activated_at = $2") &&
          normalized.includes("primary_qstash_activated_at is null")
        ) {
          const id = String(p[0]);
          const activatedAt = String(p[1]);
          if (!store.state || store.state.id !== id) {
            return queryResult([]);
          }
          if (store.state.primary_qstash_activated_at != null) {
            return queryResult([]);
          }
          store.state = {
            ...store.state,
            primary_qstash_activated_at: activatedAt,
            updated_at: activatedAt,
          };
          return queryResult([{ ...store.state }]);
        }

        throw new Error(`fake_pg_unhandled_state_update: ${normalized.slice(0, 160)}`);
      }

      if (
        normalized.includes("from marketing_dispatcher_watchdog_observations") &&
        normalized.includes("where observation_slot_id")
      ) {
        const slotId = Number(p[0]);
        return store.observations.has(slotId)
          ? queryResult([{ observation_slot_id: slotId }])
          : queryResult([]);
      }

      if (normalized.includes("insert into marketing_dispatcher_watchdog_observations")) {
        const slotId = Number(p[0]);
        if (store.failNextObservationInsert) {
          store.failNextObservationInsert = false;
          throw new Error("injected_observation_insert_failure");
        }
        if (store.observations.has(slotId)) {
          return queryResult([]);
        }
        const row: ObservationRow = {
          observation_slot_id: slotId,
          observed_at: String(p[1]),
          github_run_id: p[2] == null ? null : String(p[2]),
          github_run_attempt: p[3] == null ? null : String(p[3]),
          primary_last_seen_at: p[4] == null ? null : String(p[4]),
          stale: Boolean(p[5]),
          activation_pending: Boolean(p[6]),
          outcome: String(p[7]),
        };
        store.observations.set(slotId, row);
        return queryResult([{ observation_slot_id: slotId }], 1);
      }

      if (normalized.includes("from marketing_dispatcher_maintenance_windows")) {
        const observationTime = String(p[0]);
        const t = new Date(observationTime).getTime();
        const active = store.maintenanceWindows.filter((w) => {
          const start = new Date(w.startsAt).getTime();
          const end = new Date(w.endsAt).getTime();
          return start <= t && end > t;
        });
        return queryResult(
          active.map((w) => ({
            id: w.id,
            starts_at: w.startsAt,
            ends_at: w.endsAt,
            reason: w.reason,
            created_by: w.createdBy,
            created_at: w.createdAt,
          })),
        );
      }

      if (normalized.includes("insert into marketing_dispatcher_maintenance_windows")) {
        const window: MaintenanceWindow = {
          id: String(p[0]),
          startsAt: new Date(String(p[1])).toISOString(),
          endsAt: new Date(String(p[2])).toISOString(),
          reason: String(p[3]),
          createdBy: String(p[4]),
          createdAt: new Date(String(p[5])).toISOString(),
        };
        store.maintenanceWindows.push(window);
        return queryResult([]);
      }

      if (normalized.includes("insert into marketing_incidents")) {
        if (store.failNextIncidentInsert) {
          store.failNextIncidentInsert = false;
          throw new Error("injected_incident_insert_failure");
        }
        const incidentId = String(p[0]);
        const dedupeKey = String(p[4]);
        if (store.incidents.has(dedupeKey)) {
          return queryResult([]);
        }
        store.incidents.set(dedupeKey, {
          id: incidentId,
          dedupe_key: dedupeKey,
          status: "open",
        });
        store.incidents.set(incidentId, {
          id: incidentId,
          dedupe_key: dedupeKey,
          status: "open",
        });
        return queryResult([{ id: incidentId }], 1);
      }

      if (normalized.includes("insert into marketing_incident_events")) {
        store.incidentEvents.push({
          id: String(p[0]),
          incident_id: String(p[1]),
          event_type: String(p[2]),
        });
        return queryResult([]);
      }

      if (normalized.includes("update marketing_incidents")) {
        const incidentId = String(p[0]);
        const row = store.incidents.get(incidentId);
        if (!row || row.status === "resolved") {
          return queryResult([]);
        }
        row.status = "resolved";
        return queryResult([{ id: incidentId }], 1);
      }

      if (
        normalized.includes(
          "insert into marketing_dispatcher_watchdog_incident_notifications",
        )
      ) {
        const incidentId = String(p[0]);
        if (!store.notifications.has(incidentId)) {
          const now = new Date().toISOString();
          store.notifications.set(incidentId, {
            incident_id: incidentId,
            outage_push_claim_status: "none",
            recovery_push_claim_status: "none",
            outage_push_sent_at: null,
            created_at: now,
            updated_at: now,
          });
        }
        return queryResult([]);
      }

      if (
        normalized.includes(
          "from marketing_dispatcher_watchdog_incident_notifications",
        ) &&
        normalized.includes("where incident_id")
      ) {
        const incidentId = String(p[0]);
        const row = store.notifications.get(incidentId);
        return row ? queryResult([{ ...row }]) : queryResult([]);
      }

      if (
        normalized.includes(
          "update marketing_dispatcher_watchdog_incident_notifications",
        )
      ) {
        const incidentId = String(p[0]);
        const row = store.notifications.get(incidentId);
        if (!row) {
          return queryResult([]);
        }
        if (normalized.includes("outage_push_claim_status = 'claimed'")) {
          if (!["none", "failed"].includes(row.outage_push_claim_status)) {
            return queryResult([]);
          }
          row.outage_push_claim_status = "claimed";
          row.updated_at = new Date().toISOString();
          return queryResult([{ incident_id: incidentId }], 1);
        }
        if (normalized.includes("recovery_push_claim_status = 'claimed'")) {
          if (!["none", "failed"].includes(row.recovery_push_claim_status)) {
            return queryResult([]);
          }
          row.recovery_push_claim_status = "claimed";
          row.updated_at = new Date().toISOString();
          return queryResult([{ incident_id: incidentId }], 1);
        }
        const status = String(p[1]);
        if (normalized.includes("outage_push_sent_at")) {
          row.outage_push_claim_status = status;
          const sentAt = p[2] == null ? null : String(p[2]);
          if (sentAt) {
            row.outage_push_sent_at = row.outage_push_sent_at ?? sentAt;
          }
        } else {
          row.recovery_push_claim_status = status;
        }
        row.updated_at = new Date().toISOString();
        return queryResult([{ ...row }], 1);
      }

      throw new Error(`fake_pg_unhandled_query: ${normalized.slice(0, 120)}`);
    },
  };
  return client as PoolClient;
}

export type FakeWatchdogPgHarness = {
  store: FakeWatchdogPgStore;
  repo: ReturnType<typeof createPostgresWatchdogRepository>;
  runWatchdogTransaction: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
};

export function createFakeWatchdogPgHarness(
  seed?: Partial<FakeWatchdogPgStore>,
): FakeWatchdogPgHarness {
  const store: FakeWatchdogPgStore = {
    ...createFakeWatchdogPgStore(),
    ...seed,
    observations: seed?.observations ?? new Map(),
    incidents: seed?.incidents ?? new Map(),
    notifications: seed?.notifications ?? new Map(),
    maintenanceWindows: seed?.maintenanceWindows ?? [],
    incidentEvents: seed?.incidentEvents ?? [],
  };
  const mutex = new Mutex();

  const runWatchdogTransaction = async <T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> => {
    return mutex.run(async () => {
      const snapshot = cloneStore(store);
      try {
        const client = createFakeWatchdogPoolClient(store);
        return await fn(client);
      } catch (error) {
        const restored = cloneStore(snapshot);
        store.state = restored.state;
        store.observations = restored.observations;
        store.incidents = restored.incidents;
        store.incidentEvents = restored.incidentEvents;
        store.notifications = restored.notifications;
        store.maintenanceWindows = restored.maintenanceWindows;
        store.failNextIncidentInsert = restored.failNextIncidentInsert;
        store.failNextObservationInsert = restored.failNextObservationInsert;
        throw error;
      }
    });
  };

  const deps: PostgresWatchdogDeps = { runWatchdogTransaction };
  const repo = createPostgresWatchdogRepository(deps);

  return { store, repo, runWatchdogTransaction };
}
