import assert from "node:assert/strict";
import test from "node:test";
import { createHttpStatusAdapter } from "./adapters/http-status";
import {
  reconfirmPinnedAddresses,
  validateHttpsStatusDestination,
} from "./destination-policy";

test("reconfirmPinnedAddresses fails when DNS answers change", async () => {
  let calls = 0;
  const lookup = async () => {
    calls += 1;
    if (calls === 1) return [{ address: "93.184.216.34", family: 4 }];
    return [{ address: "127.0.0.1", family: 4 }];
  };

  const previousHosts = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "status.example.com";
  try {
    const validated = await validateHttpsStatusDestination(
      "https://status.example.com/status",
      lookup,
    );
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const confirmed = await reconfirmPinnedAddresses(
      "status.example.com",
      validated.pinnedAddresses,
      lookup,
    );
    assert.equal(confirmed, false);
  } finally {
    if (previousHosts === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previousHosts;
  }
});

test("http adapter aborts when DNS reconfirmation fails before fetch", async () => {
  let lookupCalls = 0;
  const lookup = async () => {
    lookupCalls += 1;
    if (lookupCalls === 1) return [{ address: "93.184.216.34", family: 4 }];
    return [{ address: "10.0.0.8", family: 4 }];
  };

  const previousUrl = process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
  const previousHosts = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = "https://example.test/status";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "example.test";

  let fetchCalled = false;
  const fetchImpl: typeof fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };

  try {
    const adapter = createHttpStatusAdapter(
      {
        projectId: "on-the-way",
        displayName: "On the Way",
        envKey: "ON_THE_WAY",
      },
      { fetchImpl, lookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(snapshot.connection, "unavailable");
    assert.match(snapshot.connectionDetail, /DNS confirmation failed/i);
    assert.equal(fetchCalled, false);
  } finally {
    if (previousUrl === undefined) delete process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
    else process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = previousUrl;
    if (previousHosts === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previousHosts;
  }
});
