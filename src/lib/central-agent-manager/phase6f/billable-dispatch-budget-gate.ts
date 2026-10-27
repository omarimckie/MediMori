import { SupervisorContractError } from "../supervisor/types";
import type { ObjectiveExecutionStorePort } from "../phase6c/objective-persistence-port";
import type { BudgetReservationSqlPort } from "../phase6d/objective-budget-reservation-sql";
import {
  consumeBudgetReservationDurably,
  reconcileLedgerWithReservations,
} from "../phase6d/objective-budget-reservation-sql";
import type { SpecialistTemplateRole } from "../phase6a/specialist-template-registry";

const BILLABLE_ROLES = new Set<SpecialistTemplateRole>(["engineering", "qa_independent_review", "devops"]);

export type BillableDispatchGateInput = {
  objectiveId: string;
  taskId: string;
  jobId: string;
  attemptNumber: number;
  role: SpecialistTemplateRole;
  amountUsd: number;
};

export type BillableDispatchGate = (input: BillableDispatchGateInput) => Promise<void>;

export function isBillableSpecialistRole(role: SpecialistTemplateRole): boolean {
  return BILLABLE_ROLES.has(role);
}

export function dispatchReservationId(input: BillableDispatchGateInput): string {
  return `dispatch:${input.objectiveId}:${input.taskId}:${input.attemptNumber}`;
}

export function createSqlBillableDispatchGate(input: {
  budgetPort: BudgetReservationSqlPort & {
    ensureBudgetCap?: (objectiveId: string, authorizedUsd: number) => Promise<void>;
    tryReserveWithCap?: (args: {
      objectiveId: string;
      reservationId: string;
      amountUsd: number;
      now: string;
    }) => Promise<boolean>;
  };
  objectiveStore: ObjectiveExecutionStorePort;
  now: () => string;
  requireSqlCap: boolean;
}): BillableDispatchGate {
  return async (dispatch) => {
    if (!isBillableSpecialistRole(dispatch.role)) return;
    if (!input.requireSqlCap) return;
    if (!input.budgetPort.tryReserveWithCap || !input.budgetPort.ensureBudgetCap) {
      throw new SupervisorContractError("Durable SQL budget store is required for billable dispatch.");
    }
    const ledger = input.objectiveStore.getBudgetLedger(dispatch.objectiveId);
    if (!ledger) {
      throw new SupervisorContractError("Objective budget ledger is missing.");
    }
    await input.budgetPort.ensureBudgetCap(dispatch.objectiveId, ledger.objectiveBudgetUsd);
    const reservationId = dispatchReservationId(dispatch);
    const reserved = await input.budgetPort.tryReserveWithCap({
      objectiveId: dispatch.objectiveId,
      reservationId,
      amountUsd: dispatch.amountUsd,
      now: input.now(),
    });
    if (!reserved) {
      const existing = (await input.budgetPort.listReservations(dispatch.objectiveId)).find(
        (row) => row.reservation_id === reservationId && row.status === "reserved",
      );
      if (!existing) {
        throw new SupervisorContractError("Insufficient durable budget for billable dispatch.");
      }
    }
    const fence = input.objectiveStore.getFence(dispatch.objectiveId) ?? 0;
    const reservations = await input.budgetPort.listReservations(dispatch.objectiveId);
    const reconciled = reconcileLedgerWithReservations(ledger, reservations);
    input.objectiveStore.updateBudgetLedger(dispatch.objectiveId, reconciled, { expectedFence: fence });
  };
}

export async function finalizeSqlDispatchReservation(input: {
  budgetPort: BudgetReservationSqlPort;
  objectiveStore: ObjectiveExecutionStorePort;
  dispatch: BillableDispatchGateInput;
  consumedUsd: number;
  now: string;
}): Promise<void> {
  const reservationId = dispatchReservationId(input.dispatch);
  const ledger = input.objectiveStore.getBudgetLedger(input.dispatch.objectiveId);
  if (!ledger) return;
  const fence = input.objectiveStore.getFence(input.dispatch.objectiveId) ?? 0;
  const next = await consumeBudgetReservationDurably({
    port: input.budgetPort,
    reservationId,
    amountUsd: input.consumedUsd,
    ledger,
    now: input.now,
  });
  input.objectiveStore.updateBudgetLedger(input.dispatch.objectiveId, next, { expectedFence: fence });
}
