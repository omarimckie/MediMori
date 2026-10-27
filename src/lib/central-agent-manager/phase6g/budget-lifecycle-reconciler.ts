import type { TaskQueueBinding } from "../phase6b/objective-execution-record";
import type { MemoryOrchestrationQueueStore } from "../orchestration/memory-queue-store";
import type { ObjectiveExecutionStorePort } from "../phase6c/objective-persistence-port";
import type { BudgetReservationSqlPort } from "../phase6d/objective-budget-reservation-sql";
import { reconcileLedgerWithReservations } from "../phase6d/objective-budget-reservation-sql";
import {
  dispatchReservationId,
  finalizeSqlDispatchReservation,
  isBillableSpecialistRole,
  type BillableDispatchGateInput,
} from "../phase6f/billable-dispatch-budget-gate";
import type { SpecialistTemplateRole } from "../phase6a/specialist-template-registry";

export type BudgetLifecycleOptions = {
  budgetPort: BudgetReservationSqlPort;
  objectiveStore: ObjectiveExecutionStorePort;
  store: MemoryOrchestrationQueueStore;
  taskReservationUsd: number;
  now: string;
};

function bindingDispatchInput(
  objectiveId: string,
  binding: TaskQueueBinding,
  amountUsd: number,
): BillableDispatchGateInput {
  return {
    objectiveId,
    taskId: binding.taskId,
    jobId: binding.jobId,
    attemptNumber: binding.attemptNumber,
    role: binding.specialistRole as SpecialistTemplateRole,
    amountUsd,
  };
}

export async function reconcileSqlBudgetLifecycle(input: BudgetLifecycleOptions & {
  objectiveId: string;
  bindingsBefore: readonly TaskQueueBinding[];
  bindingsAfter: readonly TaskQueueBinding[];
}): Promise<void> {
  const port = input.budgetPort;
  if (!port.tryReserveWithCap) return;

  const beforeIngested = new Set(
    input.bindingsBefore.filter((b) => b.outcomeIngested).map((b) => b.jobId),
  );

  for (const binding of input.bindingsAfter) {
    if (!binding.outcomeIngested || beforeIngested.has(binding.jobId)) continue;
    if (!isBillableSpecialistRole(binding.specialistRole as SpecialistTemplateRole)) continue;

    const job = input.store.getJobSync(binding.jobId);
    const dispatch = bindingDispatchInput(input.objectiveId, binding, input.taskReservationUsd);
    const reservationId = dispatchReservationId(dispatch);

    if (job?.state === "completed") {
      const consumedUsd = input.taskReservationUsd;
      if (port.applyReservationConsume) {
        await port.applyReservationConsume({
          objectiveId: input.objectiveId,
          reservationId,
          consumedMinor: Math.round(consumedUsd * 10_000),
          reservedMinor: Math.round(input.taskReservationUsd * 10_000),
          now: input.now,
        });
      } else {
        await finalizeSqlDispatchReservation({
          budgetPort: port,
          objectiveStore: input.objectiveStore,
          dispatch,
          consumedUsd,
          now: input.now,
        });
      }
      const ledger = input.objectiveStore.getBudgetLedger(input.objectiveId);
      if (ledger) {
        const fence = input.objectiveStore.getFence(input.objectiveId) ?? 0;
        const reservations = await port.listReservations(input.objectiveId);
        input.objectiveStore.updateBudgetLedger(
          input.objectiveId,
          reconcileLedgerWithReservations(ledger, reservations),
          { expectedFence: fence },
        );
      }
      continue;
    }

    if (
      job?.state === "failed" ||
      job?.state === "cancelled" ||
      job?.failureReason?.startsWith("cam6b:outcome:")
    ) {
      if (port.applyReservationRelease) {
        await port.applyReservationRelease({
          objectiveId: input.objectiveId,
          reservationId,
          amountMinor: Math.round(input.taskReservationUsd * 10_000),
          now: input.now,
        });
      } else {
        await port.updateReservationStatus(reservationId, "released", input.now);
      }
      const ledger = input.objectiveStore.getBudgetLedger(input.objectiveId);
      if (ledger) {
        const fence = input.objectiveStore.getFence(input.objectiveId) ?? 0;
        const reservations = await port.listReservations(input.objectiveId);
        input.objectiveStore.updateBudgetLedger(
          input.objectiveId,
          reconcileLedgerWithReservations(ledger, reservations),
          { expectedFence: fence },
        );
      }
    }
  }

  await releaseOrphanReservedJobs(input);
}

async function releaseOrphanReservedJobs(input: BudgetLifecycleOptions & { objectiveId: string }): Promise<void> {
  const record = input.objectiveStore.get(input.objectiveId);
  if (!record) return;
  const reservations = await input.budgetPort.listReservations(input.objectiveId);
  for (const row of reservations.filter((r) => r.status === "reserved")) {
    const binding = record.taskBindings.find(
      (b) =>
        dispatchReservationId(bindingDispatchInput(input.objectiveId, b, row.amount_usd)) === row.reservation_id,
    );
    if (!binding) continue;
    const job = input.store.getJobSync(binding.jobId);
    if (!job || job.state === "cancelled" || job.state === "failed") {
      if (input.budgetPort.applyReservationRelease) {
        await input.budgetPort.applyReservationRelease({
          objectiveId: input.objectiveId,
          reservationId: row.reservation_id,
          amountMinor: Math.round(row.amount_usd * 10_000),
          now: input.now,
        });
      } else {
        await input.budgetPort.updateReservationStatus(row.reservation_id, "released", input.now);
      }
    }
  }
}
