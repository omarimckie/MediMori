import assert from "node:assert/strict";
import test from "node:test";
import { isCursorCloudApiError } from "./cursor-rest-errors";
import {
  loadCursorRestTransportConfigFromEnv,
  readCursorApiKeyFromEnv,
} from "./cursor-rest-config";
import type { CursorRestHttpFetcher } from "./cursor-rest-http";
import { createCursorRestTransportFromEnv } from "./cursor-rest-factory";
import { createCursorRestCloudApiTransport } from "./cursor-rest-transport";

const API_KEY = "cursor-test-key-abcdefghijklmnopqrstuvwxyz";
const BASE = "https://api.cursor.test";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mockFetcher(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): CursorRestHttpFetcher {
  return async (url, init) => handler(url, init);
}

const REST_CONFIG = {
  apiKey: API_KEY,
  baseUrl: BASE,
  requestTimeoutMs: 5_000,
  maxResponseBytes: 256_000,
  maxReadRetries: 3,
  readRetryBaseMs: 10,
  readRetryMaxMs: 100,
};

test("REST config is absent without CURSOR_API_KEY", () => {
  const emptyEnv = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
  assert.equal(readCursorApiKeyFromEnv(emptyEnv), null);
  assert.equal(loadCursorRestTransportConfigFromEnv(emptyEnv), null);
  assert.equal(createCursorRestTransportFromEnv(emptyEnv), null);
});

test("create sends Bearer auth without logging the secret", async () => {
  let capturedAuth: string | undefined;
  const transport = createCursorRestCloudApiTransport({
    config: REST_CONFIG,
    fetchImpl: mockFetcher((_url, init) => {
      const headers = init?.headers as Headers | undefined;
      capturedAuth = headers?.get("Authorization") ?? undefined;
      return jsonResponse(200, {
        agent: { id: "bc-test-agent01" },
        run: { id: "run-test-run0001", agentId: "bc-test-agent01", status: "CREATING" },
      });
    }),
  });
  const result = await transport.createAgentWithInitialRun({
    promptText: "hello",
    repoUrl: "https://github.com/example/repo",
  });
  assert.equal(result.agentId, "bc-test-agent01");
  assert.equal(capturedAuth, `Bearer ${API_KEY}`);
  assert.match(capturedAuth ?? "", /^Bearer \S+$/);
});

test("create body uses documented prompt and repos fields only", async () => {
  let body: Record<string, unknown> | null = null;
  const transport = createCursorRestCloudApiTransport({
    config: REST_CONFIG,
    fetchImpl: mockFetcher((_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(200, {
        agent: { id: "bc-test-agent02" },
        run: { id: "run-test-run0002", agentId: "bc-test-agent02", status: "CREATING" },
      });
    }),
  });
  await transport.createAgentWithInitialRun({
    promptText: "task",
    repoUrl: "https://github.com/example/repo",
    startingRef: "main",
    correlationKey: "cam-only-not-sent",
  });
  assert.deepEqual(body, {
    prompt: { text: "task" },
    repos: [{ url: "https://github.com/example/repo", startingRef: "main" }],
  });
});

test("create rejects malformed success JSON", async () => {
  const transport = createCursorRestCloudApiTransport({
    config: REST_CONFIG,
    fetchImpl: mockFetcher(() => jsonResponse(200, { agent: { id: "x" } })),
  });
  await assert.rejects(
    () =>
      transport.createAgentWithInitialRun({
        promptText: "x",
        repoUrl: "https://github.com/example/repo",
      }),
    (error: unknown) => isCursorCloudApiError(error) && error.phase === "create",
  );
});

test("maps 401 and 403 to non-retryable auth errors", async () => {
  for (const status of [401, 403]) {
    const transport = createCursorRestCloudApiTransport({
      config: REST_CONFIG,
      fetchImpl: mockFetcher(() => jsonResponse(status, { message: "denied" })),
    });
    await assert.rejects(
      () =>
        transport.createAgentWithInitialRun({
          promptText: "x",
          repoUrl: "https://github.com/example/repo",
        }),
      (error: unknown) =>
        isCursorCloudApiError(error) && error.status === status && error.retryable === false,
    );
  }
});

test("maps 409 agent_busy on create as ambiguous", async () => {
  const transport = createCursorRestCloudApiTransport({
    config: REST_CONFIG,
    fetchImpl: mockFetcher(() => jsonResponse(409, { code: "agent_busy", message: "busy" })),
  });
  await assert.rejects(
    () =>
      transport.createAgentWithInitialRun({
        promptText: "x",
        repoUrl: "https://github.com/example/repo",
      }),
    (error: unknown) =>
      isCursorCloudApiError(error) &&
      error.status === 409 &&
      error.ambiguousCreateOutcome === true,
  );
});

test("getRun retries 429 with Retry-After then succeeds", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const transport = createCursorRestCloudApiTransport({
    config: REST_CONFIG,
    fetchImpl: mockFetcher(() => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(429, { message: "slow down" }, { "retry-after": "1" });
      }
      return jsonResponse(200, {
        id: "run-test-run0003",
        agentId: "bc-test-agent03",
        status: "FINISHED",
        result: "ok",
      });
    }),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  const snapshot = await transport.getRun("bc-test-agent03", "run-test-run0003");
  assert.equal(snapshot.status, "FINISHED");
  assert.equal(calls, 2);
  assert.equal(sleeps[0], 1000);
});

test("getRun does not retry 5xx beyond maxReadRetries", async () => {
  let calls = 0;
  const transport = createCursorRestCloudApiTransport({
    config: { ...REST_CONFIG, maxReadRetries: 2 },
    fetchImpl: mockFetcher(() => {
      calls += 1;
      return jsonResponse(503, { message: "unavailable" });
    }),
    sleep: async () => {},
  });
  await assert.rejects(
    () => transport.getRun("bc-test-agent04", "run-test-run0004"),
    (error: unknown) => isCursorCloudApiError(error) && error.status === 503,
  );
  assert.equal(calls, 3);
});

test("create does not retry on 503", async () => {
  let calls = 0;
  const transport = createCursorRestCloudApiTransport({
    config: REST_CONFIG,
    fetchImpl: mockFetcher(() => {
      calls += 1;
      return jsonResponse(503, { message: "unavailable" });
    }),
  });
  await assert.rejects(
    () =>
      transport.createAgentWithInitialRun({
        promptText: "x",
        repoUrl: "https://github.com/example/repo",
      }),
    (error: unknown) =>
      isCursorCloudApiError(error) && error.ambiguousCreateOutcome === true && error.status === 503,
  );
  assert.equal(calls, 1);
});

test("network abort on create is ambiguous", async () => {
  const transport = createCursorRestCloudApiTransport({
    config: REST_CONFIG,
    fetchImpl: mockFetcher(() => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }),
  });
  await assert.rejects(
    () =>
      transport.createAgentWithInitialRun({
        promptText: "x",
        repoUrl: "https://github.com/example/repo",
      }),
    (error: unknown) =>
      isCursorCloudApiError(error) && error.ambiguousCreateOutcome === true && error.phase === "create",
  );
});

test("getRun rejects unknown run status", async () => {
  const transport = createCursorRestCloudApiTransport({
    config: REST_CONFIG,
    fetchImpl: mockFetcher(() =>
      jsonResponse(200, {
        id: "run-test-run0005",
        agentId: "bc-test-agent05",
        status: "MYSTERY_STATUS",
      }),
    ),
  });
  await assert.rejects(
    () => transport.getRun("bc-test-agent05", "run-test-run0005"),
    (error: unknown) =>
      isCursorCloudApiError(error) && error.code === "unknown_run_status",
  );
});
