import { emptyUsage } from "../supervisor/types";
import { getSpecialistProfile } from "../supervisor/registry";
import { ORCHESTRATION_JOB_CONTRACT_V1, type ManagerAgentRecord, type ManagerJobRecord } from "./contracts-v1";

export const NOW = "2026-10-24T18:00:00.000Z";

export function baseJobFixture(overrides: Partial<ManagerJobRecord> = {}): ManagerJobRecord {
  const profile = getSpecialistProfile("engineering");
  return {
    contractVersion: ORCHESTRATION_JOB_CONTRACT_V1,
    id: "job-fixture",
    projectId: "medimori",
    goalId: "goal",
    description: "fixture",
    priority: 50,
    sequence: 1,
    state: "ready",
    dependsOnJobIds: [],
    requiredCapabilities: [],
    requestedOperation: null,
    ownerAuthorizationScope: "implementation_safe",
    budget: profile.defaultBudget,
    usage: emptyUsage(),
    attemptCount: 0,
    maxAttempts: 3,
    retryEligible: true,
    assignmentId: null,
    activeLeaseFence: null,
    supervisorTaskId: null,
    approvalBinding: null,
    evidenceIds: [],
    terminalOutcome: "none",
    failureReason: null,
    blockReason: null,
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "owner" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function createTestAgent(overrides: Partial<ManagerAgentRecord> = {}): ManagerAgentRecord {
  return {
    id: "agent-test",
    label: "Test agent",
    eligibleProjectIds: ["medimori"],
    capabilities: ["prepare_plan"],
    status: "available",
    maxConcurrentAssignments: 1,
    activeAssignmentIds: [],
    lastObservedAt: NOW,
    ...overrides,
  };
}
