import { SupervisorContractError } from "../supervisor/types";

export const OBJECTIVE_BUDGET_LEDGER_CONTRACT_V1 = "cam-objective-budget-ledger/v1" as const;

export type ObjectiveBudgetLedgerV1 = {
  contractVersion: typeof OBJECTIVE_BUDGET_LEDGER_CONTRACT_V1;
  objectiveBudgetUsd: number;
  plannedUsd: number;
  reservedUsd: number;
  consumedUsd: number;
  releasedUsd: number;
  retryCostUsd: number;
};

export function createObjectiveBudgetLedger(objectiveBudgetUsd: number): ObjectiveBudgetLedgerV1 {
  if (objectiveBudgetUsd <= 0) {
    throw new SupervisorContractError("Objective budget must be positive.");
  }
  return {
    contractVersion: OBJECTIVE_BUDGET_LEDGER_CONTRACT_V1,
    objectiveBudgetUsd,
    plannedUsd: 0,
    reservedUsd: 0,
    consumedUsd: 0,
    releasedUsd: 0,
    retryCostUsd: 0,
  };
}

export function reserveObjectiveBudget(
  ledger: ObjectiveBudgetLedgerV1,
  amountUsd: number,
): ObjectiveBudgetLedgerV1 {
  if (amountUsd <= 0) throw new SupervisorContractError("Reservation amount must be positive.");
  const available =
    ledger.objectiveBudgetUsd - ledger.reservedUsd - ledger.consumedUsd + ledger.releasedUsd;
  if (amountUsd > available) {
    throw new SupervisorContractError("Objective budget reservation exceeded.");
  }
  return { ...ledger, reservedUsd: ledger.reservedUsd + amountUsd, plannedUsd: ledger.plannedUsd + amountUsd };
}

export function consumeReservedBudget(
  ledger: ObjectiveBudgetLedgerV1,
  amountUsd: number,
): ObjectiveBudgetLedgerV1 {
  if (amountUsd <= 0) throw new SupervisorContractError("Consumption amount must be positive.");
  if (amountUsd > ledger.reservedUsd) {
    throw new SupervisorContractError("Cannot consume more than reserved budget.");
  }
  return {
    ...ledger,
    reservedUsd: ledger.reservedUsd - amountUsd,
    consumedUsd: ledger.consumedUsd + amountUsd,
  };
}

export function releaseUnusedReservation(
  ledger: ObjectiveBudgetLedgerV1,
  amountUsd: number,
): ObjectiveBudgetLedgerV1 {
  if (amountUsd <= 0) throw new SupervisorContractError("Release amount must be positive.");
  if (amountUsd > ledger.reservedUsd) {
    throw new SupervisorContractError("Cannot release more than reserved budget.");
  }
  return {
    ...ledger,
    reservedUsd: ledger.reservedUsd - amountUsd,
    releasedUsd: ledger.releasedUsd + amountUsd,
  };
}

export function recordRetryCost(ledger: ObjectiveBudgetLedgerV1, amountUsd: number): ObjectiveBudgetLedgerV1 {
  return { ...ledger, retryCostUsd: ledger.retryCostUsd + Math.max(0, amountUsd) };
}
