import { isProjectId } from "../registry";
import {
  ORCHESTRATION_ASSIGNMENT_CONTRACT_V1,
  ORCHESTRATION_JOB_CONTRACT_V1,
  managerJobStates,
  type ManagerAssignmentRecord,
  type ManagerJobRecord,
} from "./contracts-v1";
import { validateCursorDispatchIntent } from "./cursor-dispatch-intent";
import { validateExternalExecutionReferences } from "./external-execution-refs";
import { validatePersistedEvidenceOnAssignment } from "./orchestration-evidence-lifecycle";

export type QuarantinedRecord = {
  id: string;
  sourceTable: "orchestration_jobs" | "orchestration_assignments" | "orchestration_agents";
  payloadJson: string;
  reason: string;
};

export function validateManagerJobPayload(payloadJson: string): ManagerJobRecord {
  const parsed = JSON.parse(payloadJson) as ManagerJobRecord;
  if (parsed.contractVersion !== ORCHESTRATION_JOB_CONTRACT_V1) {
    throw new Error("Unsupported job contract version.");
  }
  if (!parsed.id?.trim()) throw new Error("Job id is required.");
  if (!isProjectId(parsed.projectId)) throw new Error("Invalid project id.");
  if (!managerJobStates.includes(parsed.state)) throw new Error("Invalid job state.");
  if (typeof parsed.activeLeaseFence !== "number" && parsed.activeLeaseFence !== null) {
    throw new Error("Invalid active lease fence.");
  }
  parsed.externalRefs = validateExternalExecutionReferences(parsed.externalRefs);
  const cursorDispatchIntent = validateCursorDispatchIntent(
    (parsed as { cursorDispatchIntent?: unknown }).cursorDispatchIntent,
  );
  if (cursorDispatchIntent) {
    parsed.cursorDispatchIntent = cursorDispatchIntent;
  } else {
    delete parsed.cursorDispatchIntent;
  }
  return parsed;
}

export function validateManagerAssignmentPayload(payloadJson: string): ManagerAssignmentRecord {
  const parsed = JSON.parse(payloadJson) as ManagerAssignmentRecord;
  if (parsed.contractVersion !== ORCHESTRATION_ASSIGNMENT_CONTRACT_V1) {
    throw new Error("Unsupported assignment contract version.");
  }
  if (!parsed.id?.trim() || !parsed.jobId?.trim()) throw new Error("Assignment id and job id are required.");
  if (typeof parsed.lease?.fenceToken !== "number") throw new Error("Assignment fence token is required.");
  parsed.externalRefs = validateExternalExecutionReferences(parsed.externalRefs);
  const cursorDispatchIntent = validateCursorDispatchIntent(
    (parsed as { cursorDispatchIntent?: unknown }).cursorDispatchIntent,
  );
  if (cursorDispatchIntent) {
    parsed.cursorDispatchIntent = cursorDispatchIntent;
  } else {
    delete parsed.cursorDispatchIntent;
  }
  const persistedEvidence = validatePersistedEvidenceOnAssignment(
    (parsed as { persistedEvidence?: unknown }).persistedEvidence,
  );
  if (persistedEvidence) {
    parsed.persistedEvidence = persistedEvidence;
  } else {
    delete parsed.persistedEvidence;
  }
  return parsed;
}

export function validateManagerAgentPayload(payloadJson: string): import("./contracts-v1").ManagerAgentRecord {
  const parsed = JSON.parse(payloadJson) as import("./contracts-v1").ManagerAgentRecord;
  if (!parsed.id?.trim()) throw new Error("Agent id is required.");
  if (!Array.isArray(parsed.eligibleProjectIds) || !parsed.eligibleProjectIds.every(isProjectId)) {
    throw new Error("Invalid agent project eligibility.");
  }
  return parsed;
}
