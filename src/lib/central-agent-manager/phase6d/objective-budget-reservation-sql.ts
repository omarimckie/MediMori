import { SupervisorContractError } from "../supervisor/types";
import type { ObjectiveBudgetLedgerV1 } from "../phase6c/objective-budget-ledger";
import { createObjectiveBudgetLedger, reserveObjectiveBudget, consumeReservedBudget, releaseUnusedReservation } from "../phase6c/objective-budget-ledger";

export type BudgetReservationRow = {
  reservation_id: string;
  objective_id: string;
  amount_usd: number;
  status: "reserved" | "consumed" | "released";
  created_at: string;
  updated_at: string;
};

export type BudgetReservationSqlPort = {
  withTransaction<T>(work: (port: BudgetReservationSqlPort) => Promise<T>): Promise<T>;
  listReservations(objectiveId: string): Promise<BudgetReservationRow[]>;
  insertReservation(row: BudgetReservationRow): Promise<boolean>;
  updateReservationStatus(reservationId: string, status: BudgetReservationRow["status"], updatedAt: string): Promise<boolean>;
  ensureBudgetCap?(objectiveId: string, authorizedUsd: number): Promise<void>;
  tryReserveWithCap?(input: {
    objectiveId: string;
    reservationId: string;
    amountUsd: number;
    now: string;
  }): Promise<boolean>;
  applyReservationConsume?(input: {
    objectiveId: string;
    reservationId: string;
    consumedMinor: number;
    reservedMinor: number;
    now: string;
  }): Promise<boolean>;
  applyReservationRelease?(input: {
    objectiveId: string;
    reservationId: string;
    amountMinor: number;
    now: string;
  }): Promise<boolean>;
};

export function createInMemoryBudgetReservationSqlPort(): BudgetReservationSqlPort & {
  table: Map<string, BudgetReservationRow>;
} {
  const table = new Map<string, BudgetReservationRow>();
  let chain = Promise.resolve();
  const port: BudgetReservationSqlPort = {
    withTransaction(work) {
      const run = chain.then(() => work(port));
      chain = run.then(() => undefined).catch(() => undefined);
      return run;
    },
    listReservations: async (objectiveId) =>
      [...table.values()].filter((row) => row.objective_id === objectiveId),
    insertReservation: async (row) =>
      port.withTransaction(async () => {
        if (table.has(row.reservation_id)) return false;
        table.set(row.reservation_id, row);
        return true;
      }),
    updateReservationStatus: async (reservationId, status, updatedAt) =>
      port.withTransaction(async () => {
        const row = table.get(reservationId);
        if (!row) return false;
        table.set(reservationId, { ...row, status, updated_at: updatedAt });
        return true;
      }),
  };
  return { ...port, table };
}

export function reconcileLedgerWithReservations(
  ledger: ObjectiveBudgetLedgerV1,
  reservations: readonly BudgetReservationRow[],
): ObjectiveBudgetLedgerV1 {
  const reserved = reservations
    .filter((row) => row.status === "reserved")
    .reduce((sum, row) => sum + row.amount_usd, 0);
  const consumed = reservations
    .filter((row) => row.status === "consumed")
    .reduce((sum, row) => sum + row.amount_usd, 0);
  const released = reservations
    .filter((row) => row.status === "released")
    .reduce((sum, row) => sum + row.amount_usd, 0);
  return {
    ...ledger,
    reservedUsd: reserved,
    consumedUsd: consumed,
    releasedUsd: released,
  };
}

export async function reserveBudgetDurably(input: {
  port: BudgetReservationSqlPort;
  objectiveId: string;
  reservationId: string;
  amountUsd: number;
  ledger: ObjectiveBudgetLedgerV1;
  now: string;
}): Promise<ObjectiveBudgetLedgerV1> {
  const nextLedger = reserveObjectiveBudget(input.ledger, input.amountUsd);
  const inserted = await input.port.insertReservation({
    reservation_id: input.reservationId,
    objective_id: input.objectiveId,
    amount_usd: input.amountUsd,
    status: "reserved",
    created_at: input.now,
    updated_at: input.now,
  });
  if (!inserted) {
    throw new SupervisorContractError("Duplicate budget reservation id.");
  }
  return nextLedger;
}

export async function consumeBudgetReservationDurably(input: {
  port: BudgetReservationSqlPort;
  reservationId: string;
  amountUsd: number;
  ledger: ObjectiveBudgetLedgerV1;
  now: string;
}): Promise<ObjectiveBudgetLedgerV1> {
  const updated = await input.port.updateReservationStatus(input.reservationId, "consumed", input.now);
  if (!updated) throw new SupervisorContractError("Unknown budget reservation.");
  const afterConsume = consumeReservedBudget(input.ledger, input.amountUsd);
  const unused = input.ledger.reservedUsd - input.amountUsd;
  return releaseUnusedReservation(afterConsume, Math.max(0, unused));
}

export function emptyLedgerForObjective(budgetUsd: number): ObjectiveBudgetLedgerV1 {
  return createObjectiveBudgetLedger(budgetUsd);
}
