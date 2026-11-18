import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  PREVIEW_DATABASE_GUARD_TIMEOUT_MS,
  PREVIEW_DB_IDENTITY_PROBE_SQL,
  type GuardablePoolClient,
  type PreviewDatabaseGuardFailure,
} from "@/lib/marketing/preview-db-guard";
import { createIdentityProbeGuardedSql, runIdentityProbeWithMatcher } from "@/lib/marketing/database-identity-guard";

export const STAGING_PLANNER_PREVIEW_GUARD_REF = "integration/twilight-feather-add-to-planner";
export const STAGING_PLANNER_DATABASE_GUARD_ERROR = "Staging planner database isolation check failed.";
export const STAGING_PLANNER_DB_EXPECTED_DATABASE = "neondb";
export const STAGING_PLANNER_NEON_PROJECT_ALLOWLIST = ["small-frost-27394379"] as const;
export const PRODUCTION_NEON_PROJECT_ID = "solitary-leaf-77946642";

export const MARKETING_STAGING_NEON_PROJECT_ID_ENV = "MARKETING_STAGING_NEON_PROJECT_ID";

export type StagingPlannerDatabaseGuardDecision = "skip" | "guard" | "reject";

export type StagingPlannerDatabaseGuardFailure =
  | PreviewDatabaseGuardFailure
  | "missing-config"
  | "invalid-config"
  | "production-forbidden";

export class StagingPlannerDatabaseGuardError extends Error {
  readonly category: StagingPlannerDatabaseGuardFailure;

  constructor(category: StagingPlannerDatabaseGuardFailure) {
    super(STAGING_PLANNER_DATABASE_GUARD_ERROR);
    this.name = "StagingPlannerDatabaseGuardError";
    this.category = category;
  }
}

type EnvLike = Record<string, string | undefined>;

export function resolveConfiguredStagingNeonProjectId(
  env: EnvLike = process.env,
): string | null | "invalid" {
  const raw = env[MARKETING_STAGING_NEON_PROJECT_ID_ENV]?.trim();
  if (!raw) return null;
  if (!(STAGING_PLANNER_NEON_PROJECT_ALLOWLIST as readonly string[]).includes(raw)) return "invalid";
  return raw;
}

/**
 * Staging planner Preview guard applies only on integration/twilight-feather-add-to-planner
 * when MARKETING_STAGING_NEON_PROJECT_ID is set to an allowlisted verification project.
 */
export function stagingPlannerPreviewDatabaseGuardDecision(
  env: EnvLike = process.env,
): StagingPlannerDatabaseGuardDecision {
  const vercelEnv = env.VERCEL_ENV?.trim() || undefined;
  const ref = env.VERCEL_GIT_COMMIT_REF?.trim() || undefined;

  if (vercelEnv === "production") return "skip";
  if (ref !== STAGING_PLANNER_PREVIEW_GUARD_REF) {
    return "skip";
  }

  const configured = resolveConfiguredStagingNeonProjectId(env);
  if (vercelEnv === "preview") {
    if (configured === null || configured === "invalid") return "reject";
    return "guard";
  }

  if (ref === STAGING_PLANNER_PREVIEW_GUARD_REF) return "reject";
  if (!vercelEnv && !ref) return "skip";
  if (vercelEnv === "development" && !ref) return "skip";
  return "reject";
}

export function stagingPlannerDbIdentityMatches(
  rows: unknown,
  expectedProjectId: string,
): boolean {
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0] === null || typeof rows[0] !== "object") {
    return false;
  }
  const row = rows[0] as Record<string, unknown>;
  const projectId = row.neon_project_id;
  if (projectId === PRODUCTION_NEON_PROJECT_ID) return false;
  if (projectId !== expectedProjectId) return false;
  if (
    !(STAGING_PLANNER_NEON_PROJECT_ALLOWLIST as readonly string[]).includes(String(projectId))
  ) {
    return false;
  }
  return (
    row.current_database === STAGING_PLANNER_DB_EXPECTED_DATABASE &&
    row.marketing_content_insert_allowed === true
  );
}

type QueryClient = NeonQueryFunction<false, false>;

export function createStagingPlannerGuardedSql(
  raw: QueryClient,
  expectedProjectId: string,
  options?: { timeoutMs?: number },
): QueryClient {
  const timeoutMs = options?.timeoutMs ?? PREVIEW_DATABASE_GUARD_TIMEOUT_MS;
  return createIdentityProbeGuardedSql(raw, {
    timeoutMs,
    probeSql: PREVIEW_DB_IDENTITY_PROBE_SQL,
    identityMatches: (rows) => stagingPlannerDbIdentityMatches(rows, expectedProjectId),
    GuardError: StagingPlannerDatabaseGuardError,
  });
}

type GuardablePool = {
  connect: () => Promise<GuardablePoolClient>;
};

let stagingPoolProbeTimeoutMs = PREVIEW_DATABASE_GUARD_TIMEOUT_MS;

/** Test hook. */
export function setStagingPlannerPoolProbeTimeoutForTests(timeoutMs: number | null): void {
  stagingPoolProbeTimeoutMs = timeoutMs ?? PREVIEW_DATABASE_GUARD_TIMEOUT_MS;
}

function driverRows(result: unknown): unknown {
  if (result !== null && typeof result === "object" && "rows" in result) {
    return (result as { rows: unknown }).rows;
  }
  return result;
}

const activePoolCheckout = new WeakMap<object, symbol>();

function wrapStagingGuardedPoolClient<T extends GuardablePoolClient>(
  raw: T,
  expectedProjectId: string,
  timeoutMs: number,
): T {
  const token = Symbol();
  if (activePoolCheckout.has(raw)) {
    const blocked: GuardablePoolClient = {
      query() {
        return Promise.reject(new StagingPlannerDatabaseGuardError("probe-failed"));
      },
      release() {
        return undefined;
      },
    };
    return blocked as unknown as T;
  }
  activePoolCheckout.set(raw, token);

  let open = true;
  let verified = false;
  let pending: Promise<void> | null = null;

  const stillOwns = () => open && activePoolCheckout.get(raw) === token;

  const invalidate = () => {
    open = false;
    verified = false;
    pending = null;
    if (activePoolCheckout.get(raw) === token) activePoolCheckout.delete(raw);
  };

  const ensure = (): Promise<void> => {
    if (!stillOwns()) return Promise.reject(new StagingPlannerDatabaseGuardError("probe-failed"));
    if (verified) return Promise.resolve();
    if (!pending) {
      pending = runIdentityProbeWithMatcher(
        async () => driverRows(await raw.query(PREVIEW_DB_IDENTITY_PROBE_SQL)),
        timeoutMs,
        (rows) => stagingPlannerDbIdentityMatches(rows, expectedProjectId),
        StagingPlannerDatabaseGuardError,
      ).then(
        () => {
          pending = null;
          if (!stillOwns()) {
            verified = false;
            throw new StagingPlannerDatabaseGuardError("probe-failed");
          }
          verified = true;
        },
        (error: unknown) => {
          pending = null;
          verified = false;
          throw error;
        },
      );
    }
    return pending;
  };

  const wrapped: GuardablePoolClient = {
    query(text, values) {
      if (typeof text !== "string" || typeof values === "function") {
        return Promise.reject(new StagingPlannerDatabaseGuardError("probe-failed"));
      }
      if (values !== undefined && !Array.isArray(values)) {
        return Promise.reject(new StagingPlannerDatabaseGuardError("probe-failed"));
      }
      return ensure().then(() => {
        if (!stillOwns() || !verified) {
          throw new StagingPlannerDatabaseGuardError("probe-failed");
        }
        return values === undefined ? raw.query(text) : raw.query(text, values);
      });
    },
    release(err) {
      if (!stillOwns()) return;
      invalidate();
      raw.release(err);
    },
  };
  return wrapped as unknown as T;
}

export function connectStagingPlannerAwarePoolClient<T extends GuardablePoolClient>(
  pool: { connect: () => Promise<T> },
): Promise<T> {
  const decision = stagingPlannerPreviewDatabaseGuardDecision(process.env);
  if (decision === "reject") {
    const configured = resolveConfiguredStagingNeonProjectId(process.env);
    if (configured === null) {
      return Promise.reject(new StagingPlannerDatabaseGuardError("missing-config"));
    }
    if (configured === "invalid") {
      return Promise.reject(new StagingPlannerDatabaseGuardError("invalid-config"));
    }
    return Promise.reject(new StagingPlannerDatabaseGuardError("ambiguous-scope"));
  }
  if (decision === "skip") return pool.connect();
  const expectedProjectId = resolveConfiguredStagingNeonProjectId(process.env);
  if (!expectedProjectId || expectedProjectId === "invalid") {
    return Promise.reject(new StagingPlannerDatabaseGuardError("missing-config"));
  }
  return pool
    .connect()
    .then((client) => wrapStagingGuardedPoolClient(client, expectedProjectId, stagingPoolProbeTimeoutMs));
}

export function guardPoolForStagingPlannerPreview<T extends object>(pool: T): T {
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === "connect") {
        return (...args: unknown[]) => {
          if (typeof args[0] === "function") {
            const callback = args[0] as (error?: unknown) => void;
            callback(new StagingPlannerDatabaseGuardError("probe-failed"));
            return undefined;
          }
          return connectStagingPlannerAwarePoolClient(target as GuardablePool);
        };
      }
      if (prop === "query") {
        return (text: unknown, values?: unknown) => {
          if (typeof text !== "string" || typeof values === "function") {
            return Promise.reject(new StagingPlannerDatabaseGuardError("probe-failed"));
          }
          if (values !== undefined && !Array.isArray(values)) {
            return Promise.reject(new StagingPlannerDatabaseGuardError("probe-failed"));
          }
          return connectStagingPlannerAwarePoolClient(target as GuardablePool).then(async (client) => {
            try {
              return await client.query(text, values as readonly unknown[] | undefined);
            } finally {
              client.release();
            }
          });
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}