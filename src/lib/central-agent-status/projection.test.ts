import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCentralAgentStatusFromTasks,
  CENTRAL_AGENT_STATUS_CONTRACT_V1,
  serializeCentralAgentStatusDocument,
} from "./projection";
import type { StatusTask } from "./types";

const taskId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const runId = "11111111-2222-3333-4444-555555555555";

function sampleTask(overrides: Partial<StatusTask> = {}): StatusTask {
  return {
    id: taskId,
    status: "implementing",
    plan: { summary: "Bounded plan summary only" },
    attempts: [
      {
        id: runId,
        attemptNumber: 1,
        planVersion: 1,
        startedAt: "2026-01-10T12:00:00.000Z",
        finishedAt: null,
        disposition: "active",
        modelCalls: 1,
        tokens: 100,
        costUsd: "0.01",
        workerEnabled: true,
        workerLeaseActive: true,
      },
    ],
    updated_at: "2026-01-10T12:05:00.000Z",
    ...overrides,
  };
}

describe("central-agent-status projection", () => {
  it("emits contract v1 for medimori with null progressPercent", () => {
    const now = new Date("2026-01-10T12:06:00.000Z");
    const doc = buildCentralAgentStatusFromTasks([sampleTask()], now);
    assert.equal(doc.contractVersion, CENTRAL_AGENT_STATUS_CONTRACT_V1);
    assert.equal(doc.projectId, "medimori");
    assert.equal(doc.progressPercent, null);
    assert.equal(doc.reportingStatus, "live");
    assert.equal(doc.lastSuccessfulUpdate, now.toISOString());
    assert.equal(doc.lastMeaningfulStateChange, "2026-01-10T12:05:00.000Z");
  });

  it("never serializes raw request bodies or prompts", () => {
    const serialized = serializeCentralAgentStatusDocument(
      buildCentralAgentStatusFromTasks([sampleTask()]),
    );
    assert.equal(serialized.ok, true);
    if (!serialized.ok) return;
    assert.doesNotMatch(serialized.body, /SECRET PROMPT/);
    assert.doesNotMatch(serialized.body, /"request"/);
  });

  it("lists activeAgents only for in-flight worker attempts", () => {
    const withWorker = buildCentralAgentStatusFromTasks([sampleTask()]);
    assert.equal(withWorker.activeAgents.length, 1);
    assert.equal(withWorker.activeAgents[0]?.id, runId);

    const taskOnly = buildCentralAgentStatusFromTasks([
      sampleTask({
        status: "implementing",
        attempts: [
          {
            id: runId,
            attemptNumber: 1,
            planVersion: 1,
            startedAt: "2026-01-10T12:00:00.000Z",
            finishedAt: "2026-01-10T12:30:00.000Z",
            disposition: "succeeded",
            modelCalls: 1,
            tokens: 100,
            costUsd: "0.01",
          },
        ],
      }),
    ]);
    assert.equal(taskOnly.activeAgents.length, 0);
  });

  it("does not count authorized worker runs without an active lease", () => {
    const doc = buildCentralAgentStatusFromTasks([
      sampleTask({
        attempts: [
          {
            id: runId,
            attemptNumber: 1,
            planVersion: 1,
            startedAt: "2026-01-10T12:00:00.000Z",
            finishedAt: null,
            disposition: "active",
            modelCalls: 0,
            tokens: 0,
            costUsd: "0.00",
            workerEnabled: true,
            workerLeaseActive: false,
          },
        ],
      }),
    ]);
    assert.equal(doc.activeAgents.length, 0);
  });

  it("surfaces pending approvals from task status only", () => {
    const doc = buildCentralAgentStatusFromTasks([
      sampleTask({ status: "awaiting_approval", attempts: [] }),
    ]);
    assert.equal(doc.pendingApprovals.length, 1);
    assert.match(doc.pendingApprovals[0]?.summary ?? "", /plan approval/i);
    assert.equal(doc.checklistItem, "Review engineering plan approval.");
  });

  it("rejects oversized payloads", () => {
    const doc = buildCentralAgentStatusFromTasks([sampleTask()]);
    const serialized = serializeCentralAgentStatusDocument({
      ...doc,
      statusDetail: "x".repeat(300_000),
    });
    assert.equal(serialized.ok, false);
  });
});
