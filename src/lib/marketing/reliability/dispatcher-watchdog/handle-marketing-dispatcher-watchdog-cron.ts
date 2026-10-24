import { timingSafeEqual } from "node:crypto";
import { isProductionRuntime } from "../../config";
import { createPostgresWatchdogRepository } from "./repository";
import {
  loadVerifiedPrimaryLastSeenAtFromPool,
  runWatchdogTick,
  type RunWatchdogTickResult,
} from "./run-watchdog-tick";
import type { ObservationOutcome } from "./types";

export type DispatcherWatchdogCronAuth = { ok: boolean; reason: string };

export type SanitizedWatchdogTickBody = {
  ok: true;
  outcome: ObservationOutcome;
  observationSlotId: number;
  activationPending: boolean;
  stale: boolean;
  push: RunWatchdogTickResult["push"];
};

export type DispatcherWatchdogCronOutcome =
  | { ok: false; status: 401; body: { error: string } }
  | { ok: false; status: 403; body: { error: string } }
  | { ok: false; status: 503; body: { error: string } }
  | { ok: false; status: 500; body: { error: string } }
  | { ok: true; status: 200; body: SanitizedWatchdogTickBody };

export type EnvLike = Record<string, string | undefined>;

export function isMarketingDispatcherWatchdogEnabled(env: EnvLike = process.env): boolean {
  return env.MARKETING_DISPATCHER_WATCHDOG_ENABLED?.trim().toLowerCase() === "true";
}

export function getDispatcherWatchdogSecret(env: EnvLike = process.env): string | null {
  return env.DISPATCHER_WATCHDOG_SECRET?.trim() || null;
}

export function getDispatcherWatchdogAdminUsername(env: EnvLike = process.env): string | null {
  return env.MARKETING_DISPATCHER_WATCHDOG_ADMIN_USERNAME?.trim() || null;
}

function bearerSecretMatches(authorizationHeader: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const left = Buffer.from(authorizationHeader);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function authorizeDispatcherWatchdogCron(
  request: Request,
  env: EnvLike = process.env,
): DispatcherWatchdogCronAuth {
  const secret = getDispatcherWatchdogSecret(env);
  const header = request.headers.get("authorization")?.trim() ?? "";
  const bearerOk = Boolean(secret && bearerSecretMatches(header, secret));
  if (bearerOk) {
    return { ok: true, reason: "dispatcher_watchdog_secret" };
  }
  if (isProductionRuntime(env) && !secret) {
    return { ok: false, reason: "dispatcher_watchdog_secret_missing" };
  }
  return { ok: false, reason: "unauthorized" };
}

export function parseDispatcherWatchdogGithubRunMetadata(request: Request): {
  githubRunId: string | null;
  githubRunAttempt: string | null;
} {
  const normalize = (raw: string | null, maxLen: number): string | null => {
    const value = raw?.trim();
    if (!value || value.length > maxLen) {
      return null;
    }
    if (!/^[0-9]+$/.test(value)) {
      return null;
    }
    return value;
  };
  return {
    githubRunId: normalize(request.headers.get("x-github-run-id"), 32),
    githubRunAttempt: normalize(request.headers.get("x-github-run-attempt"), 8),
  };
}

function sanitizeTickResult(result: RunWatchdogTickResult): SanitizedWatchdogTickBody {
  return {
    ok: true,
    outcome: result.observation.outcome,
    observationSlotId: result.observation.observationSlotId,
    activationPending: result.observation.activationPending,
    stale: result.observation.stale,
    push: result.push,
  };
}

export type MarketingDispatcherWatchdogCronDeps = {
  env?: EnvLike;
  now?: () => Date;
  authorize?: (request: Request, env: EnvLike) => DispatcherWatchdogCronAuth;
  isEnabled?: (env: EnvLike) => boolean;
  getAdminUsername?: (env: EnvLike) => string | null;
  runTick?: typeof runWatchdogTick;
  createRepository?: () => ReturnType<typeof createPostgresWatchdogRepository>;
  loadPrimaryLastSeenAt?: () => Promise<string | null>;
};

export async function handleMarketingDispatcherWatchdogCron(
  request: Request,
  deps: MarketingDispatcherWatchdogCronDeps = {},
): Promise<DispatcherWatchdogCronOutcome> {
  const env = deps.env ?? process.env;
  const isEnabled = deps.isEnabled ?? isMarketingDispatcherWatchdogEnabled;
  const authorize = deps.authorize ?? authorizeDispatcherWatchdogCron;

  if (!isEnabled(env)) {
    return { ok: false, status: 403, body: { error: "Watchdog endpoint disabled." } };
  }

  const auth = authorize(request, env);
  if (!auth.ok) {
    return { ok: false, status: 401, body: { error: "Unauthorized." } };
  }

  const adminUsername = (deps.getAdminUsername ?? getDispatcherWatchdogAdminUsername)(env);
  if (!adminUsername) {
    return {
      ok: false,
      status: 503,
      body: { error: "Watchdog configuration incomplete." },
    };
  }

  const { githubRunId, githubRunAttempt } = parseDispatcherWatchdogGithubRunMetadata(request);
  const now = (deps.now ?? (() => new Date()))();

  try {
    const repo = (deps.createRepository ?? createPostgresWatchdogRepository)();
    const loadPrimary =
      deps.loadPrimaryLastSeenAt ?? loadVerifiedPrimaryLastSeenAtFromPool;
    const runTick = deps.runTick ?? runWatchdogTick;

    const result = await runTick(
      {
        now,
        githubRunId,
        githubRunAttempt,
        adminUsername,
      },
      {
        repo,
        loadPrimaryLastSeenAt: loadPrimary,
      },
    );

    return { ok: true, status: 200, body: sanitizeTickResult(result) };
  } catch {
    return { ok: false, status: 500, body: { error: "Watchdog tick failed." } };
  }
}
