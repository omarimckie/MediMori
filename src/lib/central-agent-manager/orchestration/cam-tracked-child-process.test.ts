import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNeverBroadNodeTermination,
  createTrackedChildOwnershipEnv,
  trackedChildTerminationPids,
} from "./cam-tracked-child-process";

test("tracked child termination targets explicit pid only", () => {
  const pids = trackedChildTerminationPids({ pid: 4242, kill: () => {} } as import("node:child_process").ChildProcess);
  assert.deepEqual(pids, [4242]);
});

test("assertNeverBroadNodeTermination rejects taskkill by image name", () => {
  assert.throws(() => assertNeverBroadNodeTermination("taskkill /IM node.exe /F"), /forbidden/);
  assert.throws(() => assertNeverBroadNodeTermination("pkill node"), /forbidden/);
});

test("createTrackedChildOwnershipEnv marks owner pid", () => {
  const env = createTrackedChildOwnershipEnv(12345);
  assert.equal(env.CAM_TRACKED_CHILD_OWNER_PID, "12345");
});
