import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerQueueResponse } from "./queue-handler";

test("queue handler returns simulation projection for owner", async () => {
  const response = await centralAgentManagerQueueResponse({
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    getUsername: async () => "omari",
    isOwner: () => true,
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { simulation: boolean; simulationNotice: string | null };
  assert.equal(body.simulation, true);
  assert.ok(body.simulationNotice);
});

test("queue handler fails closed for non-owner", async () => {
  const response = await centralAgentManagerQueueResponse({
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    getUsername: async () => "other",
    isOwner: () => false,
  });
  assert.equal(response.status, 403);
});
