import assert from "node:assert/strict";
import test from "node:test";
import { createHttpStatusAdapter } from "./http-status";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("production HTTP adapter uses pinned HTTPS transport when fetchImpl is not injected", async () => {
  const previousUrl = process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
  const previousHosts = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = "https://mock.local/status";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "mock.local";

  let pinnedCalled = false;

  const pinnedGet = async () => {
    pinnedCalled = true;
    return {
      ok: true as const,
      status: 200,
      body: JSON.stringify({
        contractVersion: "central-agent-status/v1",
        projectId: "on-the-way",
        displayName: "On the Way",
        reportingStatus: "live",
        lastSuccessfulUpdate: "2026-01-01T00:00:00.000Z",
        workItems: [],
      }),
    };
  };

  try {
    const adapter = createHttpStatusAdapter(
      { projectId: "on-the-way", displayName: "On the Way", envKey: "ON_THE_WAY" },
      { lookup: publicLookup, pinnedGet },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(pinnedCalled, true);
    assert.equal(snapshot.connection, "connected");
  } finally {
    if (previousUrl === undefined) delete process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
    else process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = previousUrl;
    if (previousHosts === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previousHosts;
  }
});

test("pinned HTTPS transport keeps TLS verification enabled", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const source = readFileSync(
    join(process.cwd(), "src/lib/central-agent-manager/pinned-https-get.ts"),
    "utf8",
  );
  assert.match(source, /rejectUnauthorized:\s*true/);
  assert.match(source, /servername:\s*url\.hostname/);
});
