import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  authorizeDispatcherWatchdogCron,
  handleMarketingDispatcherWatchdogCron,
  isMarketingDispatcherWatchdogEnabled,
  parseDispatcherWatchdogGithubRunMetadata,
} from "@/lib/marketing/reliability/dispatcher-watchdog/handle-marketing-dispatcher-watchdog-cron";
import { runWatchdogTick } from "@/lib/marketing/reliability/dispatcher-watchdog/run-watchdog-tick";
import {
  createMemoryWatchdogRepository,
  resetMemoryWatchdogRepositoryForTests,
} from "@/lib/marketing/reliability/dispatcher-watchdog/repository";
import { STALE_THRESHOLD_MS } from "@/lib/marketing/reliability/dispatcher-watchdog/constants";
import { POST } from "./route";

const SECRET = "watchdog-test-secret-value";
const ADMIN = "omari";
const BASE = new Date("2026-10-12T12:07:00.000Z");

function enabledEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  return {
    MARKETING_DISPATCHER_WATCHDOG_ENABLED: "true",
    DISPATCHER_WATCHDOG_SECRET: SECRET,
    MARKETING_DISPATCHER_WATCHDOG_ADMIN_USERNAME: ADMIN,
    VERCEL_ENV: "preview",
    ...overrides,
  };
}

function authRequest(overrides: { secret?: string; headers?: Record<string, string> } = {}) {
  const secret = overrides.secret ?? SECRET;
  const headers = new Headers({
    authorization: `Bearer ${secret}`,
    ...(overrides.headers ?? {}),
  });
  return new Request("https://example.com/api/cron/marketing-dispatcher-watchdog", {
    method: "POST",
    headers,
  });
}

afterEach(() => {
  resetMemoryWatchdogRepositoryForTests();
});

describe("marketing-dispatcher-watchdog route wiring", () => {
  it("route delegates to handleMarketingDispatcherWatchdogCron without publishDue", () => {
    const routePath = path.join(
      process.cwd(),
      "src/app/api/cron/marketing-dispatcher-watchdog/route.ts",
    );
    const source = readFileSync(routePath, "utf8");
    assert.match(source, /handleMarketingDispatcherWatchdogCron/);
    assert.doesNotMatch(source, /publishDue/);
    assert.doesNotMatch(source, /authorizeMarketingCron/);
    assert.doesNotMatch(source, /CRON_SECRET/);
  });
});

describe("authorizeDispatcherWatchdogCron", () => {
  it("rejects CRON_SECRET bearer", () => {
    const env = enabledEnv({ CRON_SECRET: "cron-only-secret" });
    const auth = authorizeDispatcherWatchdogCron(
      new Request("https://x", {
        headers: { authorization: "Bearer cron-only-secret" },
      }),
      env,
    );
    assert.equal(auth.ok, false);
  });
});

describe("parseDispatcherWatchdogGithubRunMetadata", () => {
  it("accepts numeric run metadata and rejects invalid values", () => {
    const valid = parseDispatcherWatchdogGithubRunMetadata(
      new Request("https://x", {
        headers: {
          "x-github-run-id": "12345",
          "x-github-run-attempt": "2",
        },
      }),
    );
    assert.deepEqual(valid, { githubRunId: "12345", githubRunAttempt: "2" });

    const invalid = parseDispatcherWatchdogGithubRunMetadata(
      new Request("https://x", {
        headers: {
          "x-github-run-id": "not-numeric",
          "x-github-run-attempt": "02",
        },
      }),
    );
    assert.deepEqual(invalid, { githubRunId: null, githubRunAttempt: "02" });
  });
});

describe("handleMarketingDispatcherWatchdogCron", () => {
  it("rejects missing authorization", async () => {
    let tickCalls = 0;
    const outcome = await handleMarketingDispatcherWatchdogCron(
      new Request("https://x", { method: "POST" }),
      {
        env: enabledEnv(),
        runTick: async () => {
          tickCalls += 1;
          throw new Error("should not run");
        },
      },
    );
    assert.equal(outcome.status, 401);
    assert.equal(tickCalls, 0);
  });

  it("rejects wrong secret", async () => {
    let tickCalls = 0;
    const outcome = await handleMarketingDispatcherWatchdogCron(authRequest({ secret: "wrong" }), {
      env: enabledEnv(),
      runTick: async () => {
        tickCalls += 1;
        throw new Error("should not run");
      },
    });
    assert.equal(outcome.status, 401);
    assert.equal(tickCalls, 0);
  });

  it("blocks when enablement gate is missing or not true", async () => {
    let repoCalls = 0;
    for (const env of [
      enabledEnv({ MARKETING_DISPATCHER_WATCHDOG_ENABLED: undefined }),
      enabledEnv({ MARKETING_DISPATCHER_WATCHDOG_ENABLED: "false" }),
      enabledEnv({ MARKETING_DISPATCHER_WATCHDOG_ENABLED: "1" }),
    ]) {
      const outcome = await handleMarketingDispatcherWatchdogCron(authRequest(), {
        env,
        createRepository: () => {
          repoCalls += 1;
          return createMemoryWatchdogRepository();
        },
      });
      assert.equal(outcome.status, 403);
      assert.equal(outcome.body.error, "Watchdog endpoint disabled.");
    }
    assert.equal(repoCalls, 0);
    assert.equal(isMarketingDispatcherWatchdogEnabled({}), false);
  });

  it("returns 503 when admin username is not configured", async () => {
    let tickCalls = 0;
    const outcome = await handleMarketingDispatcherWatchdogCron(authRequest(), {
      env: enabledEnv({ MARKETING_DISPATCHER_WATCHDOG_ADMIN_USERNAME: "" }),
      runTick: async () => {
        tickCalls += 1;
        throw new Error("should not run");
      },
    });
    assert.equal(outcome.status, 503);
    assert.equal(tickCalls, 0);
  });

  it("invokes runWatchdogTick after authorization with sanitized response", async () => {
    const now = BASE;
    const repo = createMemoryWatchdogRepository();
    let loadCalls = 0;
    const outcome = await handleMarketingDispatcherWatchdogCron(
      authRequest({
        headers: {
          "x-github-run-id": "999",
          "x-github-run-attempt": "1",
        },
      }),
      {
        env: enabledEnv(),
        now: () => now,
        createRepository: () => repo,
        loadPrimaryLastSeenAt: async () => {
          loadCalls += 1;
          return new Date(now.getTime() - 5 * 60_000).toISOString();
        },
        runTick: runWatchdogTick,
      },
    );
    assert.equal(outcome.status, 200);
    assert.equal(outcome.ok, true);
    assert.equal(loadCalls, 1);
    assert.equal(outcome.body.activationPending, true);
    assert.equal(outcome.body.push.outage.attempted, false);
    assert.equal(outcome.body.push.recovery.attempted, false);
    assert.equal("primaryLastSeenAt" in outcome.body, false);
    assert.equal("state" in outcome.body, false);
  });

  it("does not send outage alerts while activation is pending", async () => {
    const now = BASE;
    const staleLastSeen = new Date(now.getTime() - STALE_THRESHOLD_MS - 60_000).toISOString();
    const repo = createMemoryWatchdogRepository();
    const outcome = await handleMarketingDispatcherWatchdogCron(authRequest(), {
      env: enabledEnv(),
      now: () => now,
      createRepository: () => repo,
      loadPrimaryLastSeenAt: async () => staleLastSeen,
      runTick: runWatchdogTick,
    });
    assert.equal(outcome.status, 200);
    assert.equal(outcome.body.activationPending, true);
    assert.equal(outcome.body.push.outage.attempted, false);
  });

  it("maps database failures to 500 without ok success", async () => {
    const outcome = await handleMarketingDispatcherWatchdogCron(authRequest(), {
      env: enabledEnv(),
      createRepository: () => createMemoryWatchdogRepository(),
      loadPrimaryLastSeenAt: async () => null,
      runTick: async () => {
        throw new Error("db unavailable");
      },
    });
    assert.equal(outcome.status, 500);
    assert.equal(outcome.body.error, "Watchdog tick failed.");
  });

  it("POST handler returns JSON status when endpoint is disabled", async () => {
    const previous = process.env.MARKETING_DISPATCHER_WATCHDOG_ENABLED;
    delete process.env.MARKETING_DISPATCHER_WATCHDOG_ENABLED;
    try {
      const response = await POST(authRequest());
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.deepEqual(body, { error: "Watchdog endpoint disabled." });
    } finally {
      if (previous === undefined) {
        delete process.env.MARKETING_DISPATCHER_WATCHDOG_ENABLED;
      } else {
        process.env.MARKETING_DISPATCHER_WATCHDOG_ENABLED = previous;
      }
    }
  });
});
