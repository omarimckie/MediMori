import { getSql } from "@/lib/db";
import type { CredentialHealthHeartbeatMetadata } from "./observation-persistence";
import { credentialHealthHeartbeatSource } from "./observation-persistence";
import type { MetaCredentialPlatform } from "./types";
import { withCredentialHealthSourceLock } from "./heartbeat-store-pool";

export type StoredCredentialHealthState = CredentialHealthHeartbeatMetadata & {
  observation_sequence: number;
  monitoring_unavailable_push_sent: boolean;
  last_proactive_daily_probe_day: string | null;
  fingerprint_key_epoch: string;
};

export type CredentialHealthStoreBackend = "memory" | "postgres";

export type CredentialHealthHeartbeatStore = {
  readonly storeBackend: CredentialHealthStoreBackend;
  load(platform: MetaCredentialPlatform): Promise<StoredCredentialHealthState | null>;
  /**
   * Atomically claims the UTC daily proactive probe slot for a platform.
   * Returns false when another invocation already claimed or completed today's probe.
   */
  claimProactiveDailyProbe(
    platform: MetaCredentialPlatform,
    dayUtc: string,
    attemptedAtIso: string,
  ): Promise<boolean>;
  saveMerged(
    platform: MetaCredentialPlatform,
    merge: (previous: StoredCredentialHealthState | null) => StoredCredentialHealthState,
    options: { attemptedAtIso: string },
  ): Promise<StoredCredentialHealthState>;
};

function parseStored(raw: unknown): StoredCredentialHealthState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as StoredCredentialHealthState;
  if (row.schema_version !== 1 || !row.platform) {
    return null;
  }
  return row;
}

function applyDailyProbeClaim(
  previous: StoredCredentialHealthState | null,
  platform: MetaCredentialPlatform,
  dayUtc: string,
): StoredCredentialHealthState | null {
  if (previous?.last_proactive_daily_probe_day === dayUtc) {
    return null;
  }
  const base = previous ?? defaultStoredCredentialHealthState(platform);
  return {
    ...base,
    last_proactive_daily_probe_day: dayUtc,
  };
}

export function defaultStoredCredentialHealthState(
  platform: MetaCredentialPlatform,
): StoredCredentialHealthState {
  return {
    schema_version: 1,
    platform,
    last_validation_attempt_at: "1970-01-01T00:00:00.000Z",
    last_successful_validation_at: null,
    validity: "unknown",
    expiration_knowledge: "unknown",
    permission_check: "not_checked",
    health_state: "validation_unavailable",
    consecutive_validation_failures: 0,
    credential_replaced: false,
    credential_fingerprint: null,
    previous_credential_fingerprint: null,
    evidence: {
      platform,
      health_state: "validation_unavailable",
      validity: "unknown",
      expiration_knowledge: "unknown",
      validation_timestamp: "1970-01-01T00:00:00.000Z",
      known_expires_at: null,
      error_class: null,
      validation_method: "not_attempted",
      permission_check: "not_checked",
      evidence_confidence: "low",
      monitoring_availability: "not_configured",
      non_expiring_token_reported: false,
    },
    observation_sequence: 0,
    monitoring_unavailable_push_sent: false,
    last_proactive_daily_probe_day: null,
    fingerprint_key_epoch: "1",
  };
}

export function createMemoryCredentialHealthHeartbeatStore(): CredentialHealthHeartbeatStore & {
  dump(): Map<string, StoredCredentialHealthState>;
} {
  const rows = new Map<string, StoredCredentialHealthState>();
  const lock = new Map<string, Promise<void>>();

  async function withLock<T>(source: string, fn: () => Promise<T>): Promise<T> {
    const prior = lock.get(source) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    lock.set(source, prior.then(() => gate));
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    storeBackend: "memory",
    dump: () => new Map(rows),
    async load(platform) {
      const source = credentialHealthHeartbeatSource(platform);
      return rows.get(source) ?? null;
    },
    async claimProactiveDailyProbe(platform, dayUtc, _attemptedAtIso) {
      const source = credentialHealthHeartbeatSource(platform);
      return withLock(source, async () => {
        const previous = rows.get(source) ?? null;
        const claimed = applyDailyProbeClaim(previous, platform, dayUtc);
        if (!claimed) {
          return false;
        }
        rows.set(source, claimed);
        return true;
      });
    },
    async saveMerged(platform, merge, options) {
      const source = credentialHealthHeartbeatSource(platform);
      return withLock(source, async () => {
        const previous = rows.get(source) ?? null;
        if (
          previous &&
          Date.parse(previous.last_validation_attempt_at) >
            Date.parse(options.attemptedAtIso)
        ) {
          return previous;
        }
        const next = merge(previous);
        next.observation_sequence = (previous?.observation_sequence ?? 0) + 1;
        rows.set(source, next);
        return next;
      });
    },
  };
}

async function loadStoredFromClient(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> },
  source: string,
): Promise<StoredCredentialHealthState | null> {
  const result = await client.query(
    `SELECT metadata FROM marketing_dispatcher_heartbeats WHERE source = $1`,
    [source],
  );
  const row = result.rows[0] as { metadata: unknown } | undefined;
  if (!row) {
    return null;
  }
  return parseStored(row.metadata);
}

async function upsertStoredMetadata(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  source: string,
  metadata: string,
): Promise<void> {
  await client.query(
    `INSERT INTO marketing_dispatcher_heartbeats (source, last_seen_at, last_published_count, metadata)
     VALUES ($1, now(), 0, $2::jsonb)
     ON CONFLICT (source) DO UPDATE SET
       last_seen_at = EXCLUDED.last_seen_at,
       metadata = EXCLUDED.metadata`,
    [source, metadata],
  );
}

export function createPostgresCredentialHealthHeartbeatStore(): CredentialHealthHeartbeatStore {
  return {
    storeBackend: "postgres",
    async load(platform) {
      const sql = getSql();
      const source = credentialHealthHeartbeatSource(platform);
      const rows = await sql`
        SELECT metadata FROM marketing_dispatcher_heartbeats WHERE source = ${source}
      `;
      if (!rows.length) {
        return null;
      }
      return parseStored((rows[0] as { metadata: unknown }).metadata);
    },
    async claimProactiveDailyProbe(platform, dayUtc, _attemptedAtIso) {
      const source = credentialHealthHeartbeatSource(platform);
      return withCredentialHealthSourceLock(source, async (client) => {
        const existing = await loadStoredFromClient(client, source);
        const claimed = applyDailyProbeClaim(existing, platform, dayUtc);
        if (!claimed) {
          return false;
        }
        await upsertStoredMetadata(client, source, JSON.stringify(claimed));
        return true;
      });
    },
    async saveMerged(platform, merge, options) {
      const source = credentialHealthHeartbeatSource(platform);
      return withCredentialHealthSourceLock(source, async (client) => {
        const existing = await loadStoredFromClient(client, source);
        if (
          existing &&
          Date.parse(existing.last_validation_attempt_at) > Date.parse(options.attemptedAtIso)
        ) {
          return existing;
        }
        const previous = existing ?? defaultStoredCredentialHealthState(platform);
        const next = merge(previous);
        next.observation_sequence = (previous.observation_sequence ?? 0) + 1;
        await upsertStoredMetadata(client, source, JSON.stringify(next));
        return next;
      });
    },
  };
}

/**
 * Test helper: naive read-merge-write without cross-instance locking (documents lost-update risk).
 */
export function createUnsafeRaceCredentialHealthHeartbeatStore(): CredentialHealthHeartbeatStore {
  const rows = new Map<string, StoredCredentialHealthState>();
  return {
    storeBackend: "memory",
    async load(platform) {
      const source = credentialHealthHeartbeatSource(platform);
      return rows.get(source) ?? null;
    },
    async claimProactiveDailyProbe(platform, dayUtc, _attemptedAtIso) {
      const source = credentialHealthHeartbeatSource(platform);
      const previous = rows.get(source) ?? null;
      const claimed = applyDailyProbeClaim(previous, platform, dayUtc);
      if (!claimed) {
        return false;
      }
      rows.set(source, claimed);
      return true;
    },
    async saveMerged(platform, merge, options) {
      const source = credentialHealthHeartbeatSource(platform);
      const previous = rows.get(source) ?? null;
      if (
        previous &&
        Date.parse(previous.last_validation_attempt_at) > Date.parse(options.attemptedAtIso)
      ) {
        return previous;
      }
      const next = merge(previous);
      next.observation_sequence = (previous?.observation_sequence ?? 0) + 1;
      rows.set(source, next);
      return next;
    },
  };
}
