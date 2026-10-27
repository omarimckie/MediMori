import type { MemoryOrchestrationQueueStore } from "../orchestration/memory-queue-store";
import type { DurableOrchestrationQueueStore } from "../orchestration/durable-orchestration-queue-store";
import { ObjectiveQueueManager, type ObjectiveQueueManagerOptions } from "../phase6b/objective-queue-manager";
import type { ObjectiveExecutionRecordV1 } from "../phase6b/objective-execution-record";
import type { OwnerProgressReportV1 } from "../phase6a/owner-progress-report";
import {
  assertReconciliationOrThrow,
  reconcileObjectiveWithQueue,
} from "./queue-reconciliation";
import { DurableObjectiveExecutionStore } from "./durable-objective-execution-store";
import type { ObjectiveExecutionStorePort } from "./objective-persistence-port";
import { reserveObjectiveBudget, consumeReservedBudget, releaseUnusedReservation } from "./objective-budget-ledger";
import { coordinatedObjectiveBeforeQueue } from "../phase6d/objective-commit-coordinator";
import type { ObjectiveSqlPort } from "../phase6d/objective-sql-port";
import type { BudgetReservationSqlPort } from "../phase6d/objective-budget-reservation-sql";
import { createSqlBillableDispatchGate } from "../phase6f/billable-dispatch-budget-gate";
import { reconcileSqlBudgetLifecycle } from "../phase6g/budget-lifecycle-reconciler";
import {
  createPhase6bMockClients,
  resetFakeWorkerScriptCounters,
  runFakeWorkerForActiveAssignment,
  type FakeWorkerScript,
} from "../phase6b/fake-queue-worker";
import { findBindingForJob } from "../phase6b/objective-execution-record";
import type { SpecialistTemplateRole } from "../phase6a/specialist-template-registry";

export type DurableObjectiveQueueManagerOptions = Omit<ObjectiveQueueManagerOptions, "objectiveStore"> & {
  objectiveStore: ObjectiveExecutionStorePort;
  durableQueue?: DurableOrchestrationQueueStore;
  taskReservationUsd?: number;
  objectiveSqlPort?: ObjectiveSqlPort;
  budgetReservationPort?: BudgetReservationSqlPort;
  requireSqlBudgetForBillableDispatch?: boolean;
};

export class DurableObjectiveQueueManager {
  private readonly core: ObjectiveQueueManager;
  readonly objectiveStore: ObjectiveExecutionStorePort;
  readonly durableQueue?: DurableOrchestrationQueueStore;
  private readonly taskReservationUsd: number;
  private readonly objectiveSqlPort?: ObjectiveSqlPort;
  private readonly budgetReservationPort?: BudgetReservationSqlPort;
  private readonly requireSqlBudget: boolean;

  constructor(options: DurableObjectiveQueueManagerOptions) {
    this.objectiveStore = options.objectiveStore;
    this.durableQueue = options.durableQueue;
    this.taskReservationUsd = options.taskReservationUsd ?? 0.25;
    this.objectiveSqlPort = options.objectiveSqlPort;
    this.budgetReservationPort = options.budgetReservationPort;
    this.requireSqlBudget = options.requireSqlBudgetForBillableDispatch ?? Boolean(options.budgetReservationPort);
    const billableDispatchGate =
      options.billableDispatchGate ??
      (options.budgetReservationPort
        ? createSqlBillableDispatchGate({
            budgetPort: options.budgetReservationPort,
            objectiveStore: options.objectiveStore,
            now: options.now,
            requireSqlCap: this.requireSqlBudget,
          })
        : undefined);
    this.core = new ObjectiveQueueManager({
      ...options,
      objectiveStore: this.objectiveStore,
      billableDispatchGate,
      billableReservationUsd: this.taskReservationUsd,
    });
  }

  static async recover(input: {
    options: DurableObjectiveQueueManagerOptions;
  }): Promise<DurableObjectiveQueueManager> {
    if (input.options.durableQueue) {
      await input.options.durableQueue.reloadFromSql();
    }
    if (input.options.objectiveStore instanceof DurableObjectiveExecutionStore) {
      await input.options.objectiveStore.reloadFromBackend();
    }
    return new DurableObjectiveQueueManager(input.options);
  }

  bootstrapAgents(): void {
    this.core.bootstrapAgents();
  }

  submitObjective(
    input: Parameters<ObjectiveQueueManager["submitObjective"]>[0],
  ): ReturnType<ObjectiveQueueManager["submitObjective"]> {
    const result = this.core.submitObjective(input);
    void this.persistAll();
    return result;
  }

  getObjective(objectiveId: string): ObjectiveExecutionRecordV1 | null {
    return this.core.getObjective(objectiveId);
  }

  async managerTick(objectiveId: string): Promise<ObjectiveExecutionRecordV1> {
    const record = this.objectiveStore.get(objectiveId);
    if (!record) throw new Error("Unknown objective.");
    assertReconciliationOrThrow(
      reconcileObjectiveWithQueue({
        store: this.core.store,
        record,
        acceptedOutcomeKeys: this.objectiveStore.getAcceptedOutcomeKeys(objectiveId),
      }),
    );
    await coordinatedObjectiveBeforeQueue({
      objectiveStore: this.objectiveStore,
      sqlPort: this.objectiveSqlPort,
      objectiveId,
      now: this.core.now(),
    });
    const bindingsBefore = record.taskBindings;
    const next = await this.core.managerTick(objectiveId);
    if (this.budgetReservationPort && this.requireSqlBudget) {
      await reconcileSqlBudgetLifecycle({
        budgetPort: this.budgetReservationPort,
        objectiveStore: this.objectiveStore,
        store: this.core.store,
        taskReservationUsd: this.taskReservationUsd,
        now: this.core.now(),
        objectiveId,
        bindingsBefore,
        bindingsAfter: next.taskBindings,
      });
    }
    void this.persistAll();
    return next;
  }

  async persistAll(): Promise<void> {
    await this.objectiveStore.flush();
    await this.durableQueue?.persistMutations();
  }

  async simulateCrashRecovery(): Promise<DurableObjectiveQueueManager> {
    await this.persistAll();
    return DurableObjectiveQueueManager.recover({
      options: {
        store: this.core.store,
        objectiveStore: this.objectiveStore,
        durableQueue: this.durableQueue,
        backends: this.core.backends,
        now: this.core.now,
        bearerByRole: this.core.bearerByRole,
        taskReservationUsd: this.taskReservationUsd,
        objectiveSqlPort: this.objectiveSqlPort,
        budgetReservationPort: this.budgetReservationPort,
        requireSqlBudgetForBillableDispatch: this.requireSqlBudget,
      },
    });
  }

  reserveBudgetForTask(objectiveId: string): void {
    const ledger = this.objectiveStore.getBudgetLedger(objectiveId);
    if (!ledger) return;
    const fence = this.objectiveStore.getFence(objectiveId) ?? 0;
    this.objectiveStore.updateBudgetLedger(
      objectiveId,
      reserveObjectiveBudget(ledger, this.taskReservationUsd),
      { expectedFence: fence },
    );
  }

  finalizeTaskBudget(objectiveId: string, consumedUsd: number): void {
    const ledger = this.objectiveStore.getBudgetLedger(objectiveId);
    if (!ledger) return;
    const fence = this.objectiveStore.getFence(objectiveId) ?? 0;
    const reserved = Math.min(consumedUsd, ledger.reservedUsd);
    const afterConsume = consumeReservedBudget(ledger, reserved);
    const unused = ledger.reservedUsd - reserved;
    const released = releaseUnusedReservation(afterConsume, unused);
    this.objectiveStore.updateBudgetLedger(objectiveId, released, { expectedFence: fence });
  }

  buildOwnerReport(objectiveId: string) {
    return this.core.buildOwnerReport(objectiveId);
  }

  async persistFinalOwnerReport(objectiveId: string): Promise<OwnerProgressReportV1> {
    const report = this.buildOwnerReport(objectiveId) as OwnerProgressReportV1;
    const fence = this.objectiveStore.getFence(objectiveId) ?? 0;
    this.objectiveStore.setPersistedOwnerReport(objectiveId, report, { expectedFence: fence });
    await this.persistAll();
    return report;
  }

  reconstructOwnerStatus(objectiveId: string) {
    const persisted = this.objectiveStore.getPersistedOwnerReport(objectiveId);
    const live = this.buildOwnerReport(objectiveId);
    return {
      ...live,
      persistedSnapshot: persisted,
      budgetLedger: this.objectiveStore.getBudgetLedger(objectiveId),
      acceptedOutcomes: this.objectiveStore.getAcceptedOutcomeKeys(objectiveId),
      recordFence: this.objectiveStore.getFence(objectiveId),
    };
  }

  get memoryStore(): MemoryOrchestrationQueueStore {
    return this.core.store;
  }

  async runFakeWorkersForObjective(input: {
    objectiveId: string;
    script: FakeWorkerScript;
    maxPasses?: number;
  }): Promise<ObjectiveExecutionRecordV1> {
    resetFakeWorkerScriptCounters();
    const clients = createPhase6bMockClients({
      store: this.core.store,
      now: this.core.now,
      bearerByRole: this.core.bearerByRole,
    });
    const maxPasses = input.maxPasses ?? 48;
    let record = this.objectiveStore.get(input.objectiveId);
    if (!record) throw new Error("Unknown objective.");

    for (let pass = 0; pass < maxPasses; pass += 1) {
      record = await this.managerTick(input.objectiveId);
      if (record.lifecycleState === "completed" || record.lifecycleState === "blocked") break;

      const activeAssignments = this.core.store
        .listAssignmentsSync()
        .filter((a) => a.state === "active");
      if (activeAssignments.length === 0) continue;

      for (const assignment of activeAssignments) {
        const binding = findBindingForJob(record, assignment.jobId);
        if (!binding) continue;
        const role = binding.specialistRole as SpecialistTemplateRole;
        const client = clients.get(role);
        if (!client) continue;
        await runFakeWorkerForActiveAssignment({
          store: this.core.store,
          client,
          role,
          taskId: binding.taskId,
          jobId: assignment.jobId,
          script: input.script,
          now: this.core.now(),
        });
      }
      record = await this.managerTick(input.objectiveId);
      if (record.lifecycleState === "completed") break;
    }
    await this.persistAll();
    return this.objectiveStore.get(input.objectiveId) ?? record;
  }
}
