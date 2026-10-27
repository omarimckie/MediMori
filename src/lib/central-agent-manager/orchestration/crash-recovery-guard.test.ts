import assert from "node:assert/strict";
import test from "node:test";
import { assertRecoverFromCrashSafe } from "./crash-recovery";
import { baseJobFixture, NOW } from "./test-fixtures";
import type { ManagerAssignmentRecord } from "./contracts-v1";

test("assertRecoverFromCrashSafe allows empty assignment set", () => {
  assertRecoverFromCrashSafe([]);
});

test("assertRecoverFromCrashSafe rejects active assignments", () => {
  const job = baseJobFixture({ id: "job-1", state: "running" });
  const active: ManagerAssignmentRecord = {
    id: "asgn-1",
    jobId: job.id,
    projectId: job.projectId,
    agentId: "agent-a",
    state: "active",
    lease: {
      holderAgentId: "agent-a",
      leasedAt: NOW,
      expiresAt: NOW,
      dispatchAttempt: 1,
      fenceToken: 1,
    },
    contractVersion: "central-agent-orchestration-assignment/v1",
    createdAt: NOW,
    updatedAt: NOW,
  };
  assert.throws(() => assertRecoverFromCrashSafe([active]), /refused/);
});
