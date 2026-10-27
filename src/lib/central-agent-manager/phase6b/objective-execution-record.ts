import { SupervisorContractError } from "../supervisor/types";
import {
  createClosedLoopManager,
  type ClosedLoopManagerState,
} from "../phase6a/closed-loop-manager";
import { validateObjectivePlan, type ObjectivePlanV1 } from "../phase6a/objective-plan";

export const OBJECTIVE_EXECUTION_CONTRACT_V1 = "cam-objective-execution/v1" as const;

export type ObjectiveLifecycleState =
  | "submitted"
  | "executing"
  | "awaiting_owner_approval"
  | "blocked"
  | "completed";

export type TaskQueueBinding = {
  taskId: string;
  jobId: string;
  enqueuedAt: string;
  specialistRole: string;
  attemptNumber: number;
  outcomeIngested: boolean;
};

export type OwnerApprovalRequestV1 = {
  id: string;
  objectiveId: string;
  taskId: string;
  protectedOperation: string;
  reason: string;
  requestedAt: string;
  status: "pending" | "granted" | "denied" | "expired";
};

export type ObjectiveExecutionRecordV1 = {
  contractVersion: typeof OBJECTIVE_EXECUTION_CONTRACT_V1;
  objectiveId: string;
  idempotencyKey: string;
  planVersion: 1;
  plan: ObjectivePlanV1;
  closedLoop: ClosedLoopManagerState;
  lifecycleState: ObjectiveLifecycleState;
  taskBindings: TaskQueueBinding[];
  pendingApprovals: OwnerApprovalRequestV1[];
  processedAssignmentIds: string[];
  maxConcurrentTasks: number;
  startedAt: string;
  updatedAt: string;
  completionCriteriaMet: boolean;
};

export function validateObjectiveExecutionRecord(record: ObjectiveExecutionRecordV1): void {
  if (record.contractVersion !== OBJECTIVE_EXECUTION_CONTRACT_V1) {
    throw new SupervisorContractError("Unsupported objective execution contract.");
  }
  validateObjectivePlan(record.plan);
  if (record.objectiveId !== record.plan.objectiveId) {
    throw new SupervisorContractError("Objective id mismatch.");
  }
}

export function createObjectiveExecutionRecord(input: {
  plan: ObjectivePlanV1;
  idempotencyKey: string;
  now: string;
  maxConcurrentTasks?: number;
}): ObjectiveExecutionRecordV1 {
  validateObjectivePlan(input.plan);
  const closedLoop = createClosedLoopManager(input.plan);
  return {
    contractVersion: OBJECTIVE_EXECUTION_CONTRACT_V1,
    objectiveId: input.plan.objectiveId,
    idempotencyKey: input.idempotencyKey,
    planVersion: 1,
    plan: input.plan,
    closedLoop,
    lifecycleState: "submitted",
    taskBindings: [],
    pendingApprovals: [],
    processedAssignmentIds: [],
    maxConcurrentTasks: input.maxConcurrentTasks ?? 2,
    startedAt: input.now,
    updatedAt: input.now,
    completionCriteriaMet: false,
  };
}

export function syncLifecycleFromClosedLoop(record: ObjectiveExecutionRecordV1): ObjectiveExecutionRecordV1 {
  validateObjectiveExecutionRecord(record);
  let lifecycleState: ObjectiveLifecycleState = "executing";
  if (record.closedLoop.objectiveState === "completed") {
    lifecycleState = "completed";
  } else if (record.closedLoop.objectiveState === "awaiting_owner_approval") {
    lifecycleState = "awaiting_owner_approval";
  } else if (record.closedLoop.objectiveState === "blocked") {
    lifecycleState = "blocked";
  } else if (record.lifecycleState === "submitted") {
    lifecycleState = "executing";
  }
  const completionCriteriaMet =
    record.closedLoop.objectiveState === "completed" &&
    record.plan.tasks.every((t) => t.state === "completed");
  return {
    ...record,
    lifecycleState,
    completionCriteriaMet,
    updatedAt: record.updatedAt,
  };
}

export class InMemoryObjectiveExecutionStore {
  private records = new Map<string, ObjectiveExecutionRecordV1>();
  private idempotency = new Map<string, string>();

  get(objectiveId: string): ObjectiveExecutionRecordV1 | null {
    return this.records.get(objectiveId) ?? null;
  }

  list(): ObjectiveExecutionRecordV1[] {
    return [...this.records.values()].sort((a, b) => a.objectiveId.localeCompare(b.objectiveId));
  }

  put(record: ObjectiveExecutionRecordV1): void {
    validateObjectiveExecutionRecord(record);
    this.records.set(record.objectiveId, record);
    this.idempotency.set(record.idempotencyKey, record.objectiveId);
  }

  submitIdempotent(input: {
    plan: ObjectivePlanV1;
    idempotencyKey: string;
    now: string;
    maxConcurrentTasks?: number;
  }): { record: ObjectiveExecutionRecordV1; created: boolean } {
    const existingId = this.idempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.records.get(existingId);
      if (!existing) {
        throw new SupervisorContractError("Idempotency index corrupted.");
      }
      return { record: existing, created: false };
    }
    const record = createObjectiveExecutionRecord(input);
    record.lifecycleState = "executing";
    record.updatedAt = input.now;
    this.put(record);
    return { record, created: true };
  }

  toJson(): string {
    return JSON.stringify({ records: this.list() });
  }

  static fromJson(payload: string): InMemoryObjectiveExecutionStore {
    const parsed = JSON.parse(payload) as { records: ObjectiveExecutionRecordV1[] };
    const store = new InMemoryObjectiveExecutionStore();
    for (const record of parsed.records) {
      store.put(record);
    }
    return store;
  }

  getFence(_objectiveId: string): number {
    return 0;
  }

  getAcceptedOutcomeKeys(_objectiveId: string): readonly string[] {
    return [];
  }

  markOutcomeAccepted(_objectiveId: string, _outcomeKey: string): void {
    // Non-durable in-memory store does not track outcome keys.
  }

  getBudgetLedger(_objectiveId: string): null {
    return null;
  }

  updateBudgetLedger(): void {
    // No-op for in-memory store.
  }

  getPersistedOwnerReport(_objectiveId: string): null {
    return null;
  }

  setPersistedOwnerReport(): void {
    // No-op for in-memory store.
  }

  async flush(): Promise<void> {
    // No-op for in-memory store.
  }
}

export function jobIdForObjectiveTask(objectiveId: string, taskId: string, attemptNumber: number): string {
  return `obj-${objectiveId}--${taskId}--a${attemptNumber}`;
}

export function findBindingForJob(
  record: ObjectiveExecutionRecordV1,
  jobId: string,
): TaskQueueBinding | undefined {
  return record.taskBindings.find((b) => b.jobId === jobId);
}
