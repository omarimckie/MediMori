import type { ObjectivePlanV1 } from "../phase6a/objective-plan";
import type { ObjectiveExecutionRecordV1 } from "../phase6b/objective-execution-record";
import type { ObjectiveBudgetLedgerV1 } from "./objective-budget-ledger";
import type { PersistedClosedLoopManagerStateV1 } from "./closed-loop-persistence";
import type { OwnerProgressReportV1 } from "../phase6a/owner-progress-report";

export const PERSISTED_OBJECTIVE_RECORD_CONTRACT_V2 = "cam-persisted-objective/v2" as const;

export type PersistedObjectiveExecutionRecordV2 = {
  contractVersion: typeof PERSISTED_OBJECTIVE_RECORD_CONTRACT_V2;
  record: Omit<ObjectiveExecutionRecordV1, "closedLoop"> & {
    closedLoop: PersistedClosedLoopManagerStateV1;
  };
  recordFence: number;
  acceptedOutcomeKeys: string[];
  budgetLedger: ObjectiveBudgetLedgerV1;
  persistedOwnerReport: OwnerProgressReportV1 | null;
};

export type ObjectivePersistencePutOptions = {
  expectedFence?: number;
};

export type ObjectiveExecutionStorePort = {
  get(objectiveId: string): ObjectiveExecutionRecordV1 | null;
  getFence(objectiveId: string): number | null;
  put(record: ObjectiveExecutionRecordV1, options?: ObjectivePersistencePutOptions): void;
  submitIdempotent(input: {
    plan: ObjectivePlanV1;
    idempotencyKey: string;
    now: string;
    maxConcurrentTasks?: number;
  }): { record: ObjectiveExecutionRecordV1; created: boolean };
  getAcceptedOutcomeKeys(objectiveId: string): readonly string[];
  markOutcomeAccepted(objectiveId: string, outcomeKey: string, options?: ObjectivePersistencePutOptions): void;
  getBudgetLedger(objectiveId: string): ObjectiveBudgetLedgerV1 | null;
  updateBudgetLedger(objectiveId: string, ledger: ObjectiveBudgetLedgerV1, options?: ObjectivePersistencePutOptions): void;
  setPersistedOwnerReport(objectiveId: string, report: OwnerProgressReportV1 | null, options?: ObjectivePersistencePutOptions): void;
  getPersistedOwnerReport(objectiveId: string): OwnerProgressReportV1 | null;
  flush(): Promise<void>;
};
