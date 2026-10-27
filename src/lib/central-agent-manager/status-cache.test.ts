import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManagerStatusWithCache,
  clearStatusCacheForTests,
  statusCacheConfigKey,
} from "./status-cache";

test("status cache stores mock responses for TTL and serves cached retrieval", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
  process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = "true";
  clearStatusCacheForTests();
  const now = new Date("2026-01-20T12:00:00.000Z");
  try {
    const first = await buildManagerStatusWithCache({
      ownerUsername: "omari",
      refresh: false,
      now,
    });
    assert.equal(first.retrieval, "fresh");
    assert.equal(first.mockDemonstration, true);
    assert.equal(first.cacheTtlMs, 60_000);

    const second = await buildManagerStatusWithCache({
      ownerUsername: "omari",
      refresh: false,
      now: new Date(now.getTime() + 5_000),
    });
    assert.equal(second.retrieval, "cached");
    assert.ok(second.cachedAt);
  } finally {
    clearStatusCacheForTests();
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
    else process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = previous;
  }
});

test("explicit refresh bypasses cache", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
  process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = "true";
  clearStatusCacheForTests();
  const now = new Date("2026-01-20T12:00:00.000Z");
  try {
    await buildManagerStatusWithCache({ ownerUsername: "omari", refresh: false, now });
    const refreshed = await buildManagerStatusWithCache({
      ownerUsername: "omari",
      refresh: true,
      now: new Date(now.getTime() + 1_000),
    });
    assert.equal(refreshed.retrieval, "fresh");
  } finally {
    clearStatusCacheForTests();
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
    else process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = previous;
  }
});

test("expired cache entries are not served as live", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
  process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = "true";
  clearStatusCacheForTests();
  const now = new Date("2026-01-20T12:00:00.000Z");
  try {
    await buildManagerStatusWithCache({ ownerUsername: "omari", refresh: false, now });
    const afterExpiry = await buildManagerStatusWithCache({
      ownerUsername: "omari",
      refresh: false,
      now: new Date(now.getTime() + 61_000),
    });
    assert.equal(afterExpiry.retrieval, "fresh");
  } finally {
    clearStatusCacheForTests();
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
    else process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = previous;
  }
});

test("cache entries are isolated per owner username", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
  process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = "true";
  clearStatusCacheForTests();
  const now = new Date("2026-01-20T12:00:00.000Z");
  try {
    await buildManagerStatusWithCache({ ownerUsername: "omari", refresh: false, now });
    const dale = await buildManagerStatusWithCache({
      ownerUsername: "dale",
      refresh: false,
      now: new Date(now.getTime() + 1_000),
    });
    assert.equal(dale.retrieval, "fresh");
  } finally {
    clearStatusCacheForTests();
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
    else process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = previous;
  }
});

test("cache is disabled outside mock harness", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
  delete process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
  clearStatusCacheForTests();
  try {
    const first = await buildManagerStatusWithCache({
      ownerUsername: "omari",
      refresh: false,
    });
    const second = await buildManagerStatusWithCache({
      ownerUsername: "omari",
      refresh: false,
    });
    assert.equal(first.cacheTtlMs, null);
    assert.equal(second.retrieval, "fresh");
    assert.equal(statusCacheConfigKey().startsWith("live|"), true);
  } finally {
    clearStatusCacheForTests();
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
    else process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = previous;
  }
});
