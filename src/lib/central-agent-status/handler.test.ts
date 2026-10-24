import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  CENTRAL_AGENT_STATUS_BEARER_ENV,
  CENTRAL_AGENT_STATUS_ENDPOINT_ENV,
} from "./auth";
import { centralAgentStatusGet, centralAgentStatusMethodNotAllowed } from "./handler";
import type { StatusTask } from "./types";

const taskId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function authRequest(token: string): Request {
  return new Request("https://example.test/api/internal/central-agent-status/v1", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("central-agent-status handler", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env[CENTRAL_AGENT_STATUS_ENDPOINT_ENV] = "true";
    process.env[CENTRAL_AGENT_STATUS_BEARER_ENV] = "test-read-bearer";
    process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("returns 503 when endpoint feature flag is off", async () => {
    const response = await centralAgentStatusGet(authRequest("test-read-bearer"), {
      isEnabled: () => false,
    });
    assert.equal(response.status, 503);
  });

  it("returns 503 when bearer is not configured", async () => {
    const response = await centralAgentStatusGet(authRequest("test-read-bearer"), {
      isBearerConfigured: () => false,
    });
    assert.equal(response.status, 503);
  });

  it("returns 401 for missing or invalid bearer", async () => {
    const missing = await centralAgentStatusGet(
      new Request("https://example.test/api/internal/central-agent-status/v1"),
    );
    assert.equal(missing.status, 401);

    const wrong = await centralAgentStatusGet(authRequest("wrong-token"));
    assert.equal(wrong.status, 401);
  });

  it("returns disconnected contract when control plane is disabled", async () => {
    const response = await centralAgentStatusGet(authRequest("test-read-bearer"), {
      isControlPlaneEnabled: () => false,
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.reportingStatus, "disconnected");
    assert.equal(body.contractVersion, "central-agent-status/v1");
  });

  it("returns live snapshot from listTasksForStatus without mutating", async () => {
    let listCalls = 0;
    const tasks: StatusTask[] = [
      {
        id: taskId,
        status: "planned",
        plan: { summary: "Plan title" },
        updated_at: new Date().toISOString(),
      },
    ];
    const response = await centralAgentStatusGet(authRequest("test-read-bearer"), {
      listTasksForStatusImpl: async () => {
        listCalls += 1;
        return tasks;
      },
    });
    assert.equal(listCalls, 1);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.reportingStatus, "live");
    assert.equal((body.workItems as Array<{ title: string }>)[0]?.title, "Plan title");
  });

  it("returns unavailable contract when listTasksForStatus fails", async () => {
    const response = await centralAgentStatusGet(authRequest("test-read-bearer"), {
      listTasksForStatusImpl: async () => {
        throw new Error("db down");
      },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.reportingStatus, "unavailable");
  });

  it("rejects non-GET methods via helper", () => {
    const response = centralAgentStatusMethodNotAllowed();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET");
  });
});
