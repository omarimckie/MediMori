import type { NeonQueryFunction } from "@neondatabase/serverless";

export const PREVIEW_DATABASE_GUARD_REF = "feature/order-notifications";
export const PREVIEW_DATABASE_GUARD_ERROR = "Preview database isolation check failed.";
export const PREVIEW_DATABASE_GUARD_TIMEOUT_MS = 5_000;

export const PREVIEW_DB_EXPECTED_USER = "tf_preview_marketing_ro";
export const PREVIEW_DB_EXPECTED_DATABASE = "neondb";
export const PREVIEW_DB_EXPECTED_BRANCH = "br-quiet-fire-ausvjkg8";
export const PREVIEW_DB_EXPECTED_PROJECT = "solitary-leaf-77946642";

export const PREVIEW_DB_IDENTITY_PROBE_SQL = `
SELECT
  current_user,
  current_database() AS current_database,
  current_setting('neon.branch_id') AS neon_branch_id,
  current_setting('neon.project_id') AS neon_project_id,
  has_table_privilege(current_user, 'public.marketing_content', 'INSERT') AS marketing_content_insert_allowed
`.trim();

export type PreviewDatabaseGuardDecision = "skip" | "guard" | "reject";

export type PreviewDatabaseGuardFailure =
  | "mismatch"
  | "probe-failed"
  | "timeout"
  | "ambiguous-scope";

export class PreviewDatabaseGuardError extends Error {
  readonly category: PreviewDatabaseGuardFailure;

  constructor(category: PreviewDatabaseGuardFailure) {
    super(PREVIEW_DATABASE_GUARD_ERROR);
    this.name = "PreviewDatabaseGuardError";
    this.category = category;
  }
}

type EnvLike = Record<string, string | undefined>;

/**
 * Decide whether this process is the protected Preview deployment.
 * Platform variables only. Request headers are not consulted.
 * Production skips. Another known Preview branch skips.
 * Preview with no branch, or the protected branch without Preview, rejects.
 */
export function previewDatabaseGuardDecision(
  env: EnvLike = process.env,
): PreviewDatabaseGuardDecision {
  const vercelEnv = env.VERCEL_ENV?.trim() || undefined;
  const ref = env.VERCEL_GIT_COMMIT_REF?.trim() || undefined;

  if (vercelEnv === "production") return "skip";
  if (vercelEnv === "preview" && ref === PREVIEW_DATABASE_GUARD_REF) return "guard";
  if (ref === PREVIEW_DATABASE_GUARD_REF) return "reject";
  if (vercelEnv === "preview" && !ref) return "reject";
  if (!vercelEnv && !ref) return "skip";
  if (vercelEnv === "development" && !ref) return "skip";
  if (ref && ref !== PREVIEW_DATABASE_GUARD_REF) return "skip";
  return "reject";
}

export function previewDbIdentityMatches(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0] === null || typeof rows[0] !== "object") {
    return false;
  }
  const row = rows[0] as Record<string, unknown>;
  return (
    row.current_user === PREVIEW_DB_EXPECTED_USER &&
    row.current_database === PREVIEW_DB_EXPECTED_DATABASE &&
    row.neon_branch_id === PREVIEW_DB_EXPECTED_BRANCH &&
    row.neon_project_id === PREVIEW_DB_EXPECTED_PROJECT &&
    row.marketing_content_insert_allowed === false
  );
}

const GUARD_INNER = Symbol("previewDbGuardInner");

type QueryClient = NeonQueryFunction<false, false>;

type DeferredQuery = {
  then: PromiseLike<unknown>["then"];
  catch: (onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
  finally: (onFinally?: () => void) => Promise<unknown>;
  [GUARD_INNER]?: PromiseLike<unknown>;
};

/**
 * Wrap one Neon HTTP client.
 * Verification is cached only after success, and only for this client instance.
 * The Neon HTTP driver has no session to reconnect. A new client or connection
 * string creates a new wrapper and must probe again.
 * A failed probe is not remembered as success.
 */
export function createPreviewGuardedSql(
  raw: QueryClient,
  options?: { timeoutMs?: number },
): QueryClient {
  const timeoutMs = options?.timeoutMs ?? PREVIEW_DATABASE_GUARD_TIMEOUT_MS;
  let succeeded = false;
  let pending: Promise<void> | null = null;

  function ensure(): Promise<void> {
    if (succeeded) return Promise.resolve();
    if (!pending) {
      pending = runProbe(raw, timeoutMs).then(
        () => {
          succeeded = true;
          pending = null;
        },
        (error: unknown) => {
          pending = null;
          succeeded = false;
          throw error;
        },
      );
    }
    return pending;
  }

  function defer<T extends PromiseLike<unknown>>(inner: T): T {
    let started: Promise<unknown> | null = null;
    const start = () => {
      if (!started) started = ensure().then(() => inner);
      return started;
    };
    const guarded: DeferredQuery = {
      [GUARD_INNER]: inner,
      then(onFulfilled, onRejected) {
        return start().then(onFulfilled, onRejected);
      },
      catch(onRejected) {
        return start().catch(onRejected);
      },
      finally(onFinally) {
        return start().finally(onFinally);
      },
    };
    return guarded as unknown as T;
  }

  const guarded = ((strings: TemplateStringsArray, ...params: unknown[]) => {
    return defer(raw(strings, ...params));
  }) as QueryClient;

  guarded.query = ((query, params, queryOpts) => {
    return defer(raw.query(query, params, queryOpts));
  }) as QueryClient["query"];

  guarded.unsafe = ((rawSql: string) => raw.unsafe(rawSql)) as QueryClient["unsafe"];

  guarded.transaction = (async (queriesOrFn, opts) => {
    await ensure();
    const build = queriesOrFn as unknown as (sql: QueryClient) => unknown;
    const queries = typeof queriesOrFn === "function" ? build(guarded) : queriesOrFn;
    if (!Array.isArray(queries)) {
      throw new PreviewDatabaseGuardError("probe-failed");
    }
    const unwrapped = queries.map((query) => {
      if (query && typeof query === "object" && GUARD_INNER in query) {
        return (query as { [GUARD_INNER]?: unknown })[GUARD_INNER];
      }
      return query;
    });
    return (raw.transaction as (queries: unknown, opts?: unknown) => Promise<unknown>)(
      unwrapped,
      opts,
    );
  }) as QueryClient["transaction"];

  return guarded;
}

function runProbe(raw: QueryClient, timeoutMs: number): Promise<void> {
  return runIdentityProbe(() => raw.query(PREVIEW_DB_IDENTITY_PROBE_SQL), timeoutMs);
}

function runIdentityProbe(start: () => Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new PreviewDatabaseGuardError("timeout"));
    }, timeoutMs);

    const finish = (error?: PreviewDatabaseGuardError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    try {
      Promise.resolve()
        .then(start)
        .then((rows) => {
          if (!previewDbIdentityMatches(rows)) {
            finish(new PreviewDatabaseGuardError("mismatch"));
            return;
          }
          finish();
        })
        .catch((error: unknown) => {
          if (error instanceof PreviewDatabaseGuardError) {
            finish(error);
            return;
          }
          finish(new PreviewDatabaseGuardError("probe-failed"));
        });
    } catch {
      finish(new PreviewDatabaseGuardError("probe-failed"));
    }
  });
}

export type GuardablePoolClient = {
  query: (text: string, values?: readonly unknown[]) => Promise<unknown>;
  release: (err?: Error | boolean) => void;
};

type GuardablePool = {
  connect: () => Promise<GuardablePoolClient>;
};

const activePoolCheckout = new WeakMap<object, symbol>();
let poolProbeTimeoutMs = PREVIEW_DATABASE_GUARD_TIMEOUT_MS;

/** Test hook. Production uses the shared guard timeout. */
export function setPreviewPoolProbeTimeoutForTests(timeoutMs: number | null): void {
  poolProbeTimeoutMs = timeoutMs ?? PREVIEW_DATABASE_GUARD_TIMEOUT_MS;
}

/**
 * Check out one pooled connection.
 * Production and other branches receive the driver client unchanged.
 * The protected Preview branch receives a client that probes this connection
 * before its first statement. Verification is not stored on the pool and is
 * dropped when the client is released.
 */
export function connectPreviewAwarePoolClient<T extends GuardablePoolClient>(
  pool: { connect: () => Promise<T> },
): Promise<T> {
  const decision = previewDatabaseGuardDecision(process.env);
  if (decision === "reject") {
    return Promise.reject(new PreviewDatabaseGuardError("ambiguous-scope"));
  }
  if (decision === "skip") return pool.connect();
  return pool.connect().then((client) => wrapGuardedPoolClient(client, poolProbeTimeoutMs));
}

/**
 * Hide direct Pool.query and Pool.connect on the protected Preview branch.
 * Other Pool methods stay on the driver pool. Skip-scope callers should use
 * the driver pool itself.
 */
export function guardPoolForProtectedPreview<T extends object>(pool: T): T {
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === "connect") {
        return (...args: unknown[]) => {
          if (typeof args[0] === "function") {
            const callback = args[0] as (error?: unknown) => void;
            callback(new PreviewDatabaseGuardError("probe-failed"));
            return undefined;
          }
          return connectPreviewAwarePoolClient(target as GuardablePool);
        };
      }
      if (prop === "query") {
        return (text: unknown, values?: unknown) =>
          guardedPoolQuery(target as GuardablePool, text, values);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function driverRows(result: unknown): unknown {
  if (result !== null && typeof result === "object" && "rows" in result) {
    return (result as { rows: unknown }).rows;
  }
  return result;
}

function guardedPoolQuery(
  pool: GuardablePool,
  text: unknown,
  values: unknown,
): Promise<unknown> {
  if (typeof text !== "string" || typeof values === "function") {
    return Promise.reject(new PreviewDatabaseGuardError("probe-failed"));
  }
  if (values !== undefined && !Array.isArray(values)) {
    return Promise.reject(new PreviewDatabaseGuardError("probe-failed"));
  }
  return connectPreviewAwarePoolClient(pool).then(async (client) => {
    try {
      return await client.query(text, values);
    } finally {
      client.release();
    }
  });
}

function wrapGuardedPoolClient<T extends GuardablePoolClient>(raw: T, timeoutMs: number): T {
  const token = Symbol();
  if (activePoolCheckout.has(raw)) {
    const blocked: GuardablePoolClient = {
      query() {
        return Promise.reject(new PreviewDatabaseGuardError("probe-failed"));
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
    if (!stillOwns()) return Promise.reject(new PreviewDatabaseGuardError("probe-failed"));
    if (verified) return Promise.resolve();
    if (!pending) {
      pending = runIdentityProbe(async () => driverRows(await raw.query(PREVIEW_DB_IDENTITY_PROBE_SQL)), timeoutMs).then(
        () => {
          pending = null;
          if (!stillOwns()) {
            verified = false;
            throw new PreviewDatabaseGuardError("probe-failed");
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
        return Promise.reject(new PreviewDatabaseGuardError("probe-failed"));
      }
      if (values !== undefined && !Array.isArray(values)) {
        return Promise.reject(new PreviewDatabaseGuardError("probe-failed"));
      }
      return ensure().then(() => {
        if (!stillOwns() || !verified) {
          throw new PreviewDatabaseGuardError("probe-failed");
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
