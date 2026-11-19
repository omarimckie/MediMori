import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  createIdentityProbeGuardedSql,
  runIdentityProbeWithMatcher,
  type GuardErrorClass,
} from "@/lib/marketing/database-identity-guard";
import {
  PREVIEW_DATABASE_GUARD_TIMEOUT_MS,
  PREVIEW_DB_IDENTITY_PROBE_SQL,
  type GuardablePoolClient,
} from "@/lib/marketing/preview-db-guard";
import {
  PRODUCTION_NEON_PROJECT_ID,
  STAGING_PLANNER_NEON_PROJECT_ALLOWLIST,
} from "@/lib/marketing/staging-planner-db-guard";

export const PREVIEW_FAIL_CLOSED_GUARD_ERROR =
  "Preview database connection is not on an approved staging Neon project.";

export type PreviewFailClosedGuardFailure =
  | "production-forbidden"
  | "probe-failed"
  | "timeout"
  | "mismatch";

export class PreviewFailClosedDatabaseGuardError extends Error {
  readonly category: PreviewFailClosedGuardFailure;

  constructor(category: PreviewFailClosedGuardFailure) {
    super(PREVIEW_FAIL_CLOSED_GUARD_ERROR);
    this.name = "PreviewFailClosedDatabaseGuardError";
    this.category = category;
  }
}

const FailClosedGuardError = PreviewFailClosedDatabaseGuardError as unknown as GuardErrorClass;

/**
 * Fail closed when a generic Preview deployment is not on an approved staging Neon project.
 * Production Neon and order-notifications routes use separate verified guard paths.
 */
export function previewFailClosedIdentityMatches(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0] === null || typeof rows[0] !== "object") {
    return false;
  }
  const row = rows[0] as Record<string, unknown>;
  const projectId = row.neon_project_id;
  if (typeof projectId !== "string" || !projectId.trim()) {
    return false;
  }
  if (projectId === PRODUCTION_NEON_PROJECT_ID) {
    return false;
  }
  return (STAGING_PLANNER_NEON_PROJECT_ALLOWLIST as readonly string[]).includes(projectId);
}

export function createPreviewFailClosedGuardedSql(
  raw: NeonQueryFunction<false, false>,
  options?: { timeoutMs?: number },
): NeonQueryFunction<false, false> {
  const timeoutMs = options?.timeoutMs ?? PREVIEW_DATABASE_GUARD_TIMEOUT_MS;
  return createIdentityProbeGuardedSql(raw, {
    timeoutMs,
    probeSql: PREVIEW_DB_IDENTITY_PROBE_SQL,
    identityMatches: previewFailClosedIdentityMatches,
    GuardError: FailClosedGuardError,
  });
}

type GuardablePool = {
  connect: () => Promise<GuardablePoolClient>;
};

let failClosedPoolProbeTimeoutMs = PREVIEW_DATABASE_GUARD_TIMEOUT_MS;

export function setPreviewFailClosedPoolProbeTimeoutForTests(timeoutMs: number | null): void {
  failClosedPoolProbeTimeoutMs = timeoutMs ?? PREVIEW_DATABASE_GUARD_TIMEOUT_MS;
}

function wrapFailClosedGuardedPoolClient<T extends GuardablePoolClient>(
  raw: T,
  timeoutMs: number,
): T {
  let verified = false;
  let pending: Promise<void> | null = null;

  const ensure = (): Promise<void> => {
    if (verified) return Promise.resolve();
    if (pending) return pending;
    pending = runIdentityProbeWithMatcher(
      () => raw.query(PREVIEW_DB_IDENTITY_PROBE_SQL),
      timeoutMs,
      previewFailClosedIdentityMatches,
      FailClosedGuardError,
    ).then(
      () => {
        pending = null;
        verified = true;
      },
      (error: unknown) => {
        pending = null;
        verified = false;
        throw error;
      },
    );
    return pending;
  };

  const wrapped: GuardablePoolClient = {
    query(text, values) {
      if (typeof text !== "string" || typeof values === "function") {
        return Promise.reject(new PreviewFailClosedDatabaseGuardError("probe-failed"));
      }
      if (values !== undefined && !Array.isArray(values)) {
        return Promise.reject(new PreviewFailClosedDatabaseGuardError("probe-failed"));
      }
      return ensure().then(() =>
        values === undefined ? raw.query(text) : raw.query(text, values),
      );
    },
    release(err) {
      verified = false;
      pending = null;
      raw.release(err);
    },
  };
  return wrapped as unknown as T;
}

export function connectPreviewFailClosedAwarePoolClient<T extends GuardablePoolClient>(pool: {
  connect: () => Promise<T>;
}): Promise<T> {
  return pool
    .connect()
    .then((client) => wrapFailClosedGuardedPoolClient(client, failClosedPoolProbeTimeoutMs));
}

export function guardPoolForPreviewFailClosed<T extends object>(pool: T): T {
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === "connect") {
        return (...args: unknown[]) => {
          if (typeof args[0] === "function") {
            const callback = args[0] as (error?: unknown) => void;
            callback(new PreviewFailClosedDatabaseGuardError("probe-failed"));
            return undefined;
          }
          return connectPreviewFailClosedAwarePoolClient(target as GuardablePool);
        };
      }
      if (prop === "query") {
        return (text: unknown, values?: unknown) => {
          if (typeof text !== "string" || typeof values === "function") {
            return Promise.reject(new PreviewFailClosedDatabaseGuardError("probe-failed"));
          }
          if (values !== undefined && !Array.isArray(values)) {
            return Promise.reject(new PreviewFailClosedDatabaseGuardError("probe-failed"));
          }
          return connectPreviewFailClosedAwarePoolClient(target as GuardablePool).then(
            async (client) => {
              try {
                return await client.query(text, values as readonly unknown[] | undefined);
              } finally {
                client.release();
              }
            },
          );
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}