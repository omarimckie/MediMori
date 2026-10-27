import { scrubSecretsFromString } from "../scrub-response";
import {
  assertIdentifier,
  assertTimestamp,
  SupervisorContractError,
  type EvidenceKind,
  type EvidenceRecord,
  type SupervisorTask,
} from "./types";

const artifactPattern = /^[\w./-]{1,240}$/;
const evidenceSources = ["model", "executor", "validator", "owner", "policy"] as const;

function isEvidenceSource(value: string): value is EvidenceRecord["source"] {
  return (evidenceSources as readonly string[]).includes(value);
}

export function acceptEvidence(
  input: Omit<EvidenceRecord, "diagnostic" | "verification"> & {
    diagnostic?: string;
    verification: EvidenceRecord["verification"];
  },
  task: SupervisorTask,
): EvidenceRecord {
  assertIdentifier(input.id, "Evidence id");
  assertTimestamp(input.createdAt, "Evidence time");
  if (!isEvidenceKind(input.kind)) {
    throw new SupervisorContractError("Evidence kind is invalid.");
  }
  if (!isEvidenceSource(input.source)) {
    throw new SupervisorContractError("Evidence source is unsupported.");
  }
  if (input.taskId !== task.id) {
    throw new SupervisorContractError("Evidence task reference is invalid.");
  }
  if (input.sessionId !== null) {
    assertIdentifier(input.sessionId, "Evidence session id");
    if (!task.sessionId || input.sessionId !== task.sessionId) {
      throw new SupervisorContractError("Evidence session reference is invalid.");
    }
  }
  if (input.artifactRef !== null && !artifactPattern.test(input.artifactRef)) {
    throw new SupervisorContractError("Evidence artifact reference is invalid.");
  }
  const diagnostic = scrubSecretsFromString(input.diagnostic ?? "").slice(0, 240);
  const modelSuccess =
    input.source === "model" &&
    (input.kind === "work_completed" || input.kind === "validation_passed");
  const failureClaim = input.kind === "validation_failed" || input.kind === "execution_blocked";
  const verification =
    (modelSuccess || failureClaim) && input.verification === "verified"
      ? "unverified"
      : input.verification;
  return {
    id: input.id,
    taskId: input.taskId,
    sessionId: input.sessionId,
    kind: input.kind,
    source: input.source,
    createdAt: input.createdAt,
    verification,
    artifactRef: input.artifactRef,
    diagnostic,
  };
}

export function hasVerifiedCompletion(task: SupervisorTask, evidence: readonly EvidenceRecord[]): boolean {
  if (!task.sessionId) return false;
  const owned = evidence.filter(
    (item) => item.taskId === task.id && item.sessionId === task.sessionId,
  );
  const verifiedWork = owned.some(
    (item) =>
      item.kind === "work_completed" &&
      item.verification === "verified" &&
      item.source === "executor",
  );
  if (!verifiedWork) return false;
  if (!task.validationRequired) return true;
  return owned.some(
    (item) =>
      item.kind === "validation_passed" &&
      item.verification === "verified" &&
      item.source === "validator",
  );
}

export function isEvidenceKind(value: string): value is EvidenceKind {
  return (
    value === "proposed" ||
    value === "work_started" ||
    value === "work_completed" ||
    value === "validation_performed" ||
    value === "validation_passed" ||
    value === "validation_failed" ||
    value === "approval_received" ||
    value === "execution_blocked" ||
    value === "session_terminated"
  );
}
