import assert from "node:assert/strict";
import test from "node:test";
import { FakeCursorCloudApiTransport } from "../orchestration/cursor-bridge/fake-cursor-cloud-api-transport";
import { CursorCloudExecutionAdapter } from "../phase6d/cursor-cloud-execution-adapter";

test("cursor adapter cancellation is idempotent for same run", async () => {
  const adapter = new CursorCloudExecutionAdapter({
    transport: new FakeCursorCloudApiTransport(),
    env: {
      CAM_CURSOR_EXECUTION_ADAPTER_ENABLED: "true",
      CAM_CURSOR_EXECUTION_ADAPTER_MODE: "cloud_api",
      CAM_CURSOR_REAL_ADAPTER_ARMED: "true",
    },
  });
  const identity = await adapter.createRun({ promptText: "x", repoUrl: "https://example.com/r.git" });
  await adapter.cancelRun(identity, "stop");
  await adapter.cancelRun(identity, "stop");
  const progress = await adapter.pollRun(identity);
  assert.equal(progress.status, "cancelled");
});
