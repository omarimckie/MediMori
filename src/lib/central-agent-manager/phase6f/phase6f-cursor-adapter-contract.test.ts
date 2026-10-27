import assert from "node:assert/strict";
import test from "node:test";
import { FakeCursorCloudApiTransport } from "../orchestration/cursor-bridge/fake-cursor-cloud-api-transport";
import { CursorCloudExecutionAdapter } from "../phase6d/cursor-cloud-execution-adapter";

test("cursor cloud adapter contract: disabled without arm flag", async () => {
  const adapter = new CursorCloudExecutionAdapter({
    transport: new FakeCursorCloudApiTransport(),
    env: {
      CAM_CURSOR_EXECUTION_ADAPTER_ENABLED: "true",
      CAM_CURSOR_EXECUTION_ADAPTER_MODE: "cloud_api",
      CAM_CURSOR_REAL_ADAPTER_ARMED: "false",
    },
  });
  await assert.rejects(() => adapter.createRun({ promptText: "x", repoUrl: "https://example.com/r.git" }));
});

test("cursor cloud adapter contract: poll and cancel on fake transport when armed", async () => {
  const transport = new FakeCursorCloudApiTransport();
  const adapter = new CursorCloudExecutionAdapter({
    transport,
    env: {
      CAM_CURSOR_EXECUTION_ADAPTER_ENABLED: "true",
      CAM_CURSOR_EXECUTION_ADAPTER_MODE: "cloud_api",
      CAM_CURSOR_REAL_ADAPTER_ARMED: "true",
      CAM_CURSOR_EXECUTION_MAX_COST_USD: "1",
    },
  });
  const identity = await adapter.createRun({ promptText: "demo", repoUrl: "https://example.com/r.git" });
  const progress = await adapter.pollRun(identity);
  assert.ok(progress.status === "running" || progress.status === "finished");
  await adapter.cancelRun(identity, "manager_cancel");
  const cancelled = await adapter.pollRun(identity);
  assert.equal(cancelled.status, "cancelled");
});
