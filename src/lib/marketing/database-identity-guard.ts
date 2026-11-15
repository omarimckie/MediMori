import type { NeonQueryFunction } from "@neondatabase/serverless";
import { PREVIEW_DATABASE_GUARD_TIMEOUT_MS } from "@/lib/marketing/preview-db-guard";

const GUARD_INNER = Symbol("previewDbGuardInner");

type QueryClient = NeonQueryFunction<false, false>;

type DeferredQuery = {
  then: PromiseLike<unknown>["then"];
  catch: (onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
  finally: (onFinally?: () => void) => Promise<unknown>;
  [GUARD_INNER]?: PromiseLike<unknown>;
};

export type GuardErrorClass = new (
  category: "mismatch" | "probe-failed" | "timeout" | "ambiguous-scope",
) => Error;

export function runIdentityProbeWithMatcher(
  start: () => Promise<unknown>,
  timeoutMs: number,
  identityMatches: (rows: unknown) => boolean,
  GuardError: GuardErrorClass,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new GuardError("timeout"));
    }, timeoutMs);

    const finish = (error?: InstanceType<GuardErrorClass>) => {
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
          if (!identityMatches(rows)) {
            finish(new GuardError("mismatch"));
            return;
          }
          finish();
        })
        .catch((error: unknown) => {
          if (error instanceof GuardError) {
            finish(error as InstanceType<GuardErrorClass>);
            return;
          }
          finish(new GuardError("probe-failed"));
        });
    } catch {
      finish(new GuardError("probe-failed"));
    }
  });
}

/**
 * Wrap one Neon HTTP client with an identity probe before the first statement.
 */
export function createIdentityProbeGuardedSql(
  raw: QueryClient,
  options: {
    timeoutMs?: number;
    probeSql: string;
    identityMatches: (rows: unknown) => boolean;
    GuardError: GuardErrorClass;
  },
): QueryClient {
  const timeoutMs = options.timeoutMs ?? PREVIEW_DATABASE_GUARD_TIMEOUT_MS;
  let succeeded = false;
  let pending: Promise<void> | null = null;

  const runProbe = (): Promise<void> =>
    runIdentityProbeWithMatcher(
      () => raw.query(options.probeSql),
      timeoutMs,
      options.identityMatches,
      options.GuardError,
    );

  function ensure(): Promise<void> {
    if (succeeded) return Promise.resolve();
    if (!pending) {
      pending = runProbe().then(
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
      throw new options.GuardError("probe-failed");
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