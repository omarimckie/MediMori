import type { MemoryOrchestrationQueueStore } from "../orchestration/memory-queue-store";
import { offlineObjectivePlanner, refreshPlanReadiness } from "../phase6a/objective-plan";
import { buildOwnerProgressReport } from "../phase6a/owner-progress-report";
import type { WorkerBackendAvailability } from "../phase6a/worker-matching";
import type { ObjectivePlannerPort } from "../phase6a/objective-plan";
import {
  InMemoryObjectiveExecutionStore,
  syncLifecycleFromClosedLoop,
  type ObjectiveExecutionRecordV1,
} from "./objective-execution-record";
import type { ObjectiveExecutionStorePort } from "../phase6c/objective-persistence-port";
import { scheduleEligiblePlanTasks } from "./plan-to-queue-scheduler";
import { registerPhase6bAgents } from "./queue-agent-registry";
import {
  ingestQueueOutcomes,
  syncRunningTasksFromAssignments,
} from "./queue-outcome-ingestion";
import {
  createPhase6bMockClients,
  resetFakeWorkerScriptCounters,
  runFakeWorkerForActiveAssignment,
  type FakeWorkerScript,
} from "./fake-queue-worker";
import type { SpecialistTemplateRole } from "../phase6a/specialist-template-registry";
import { findBindingForJob } from "./objective-execution-record";

import type { BillableDispatchGate } from "../phase6f/billable-dispatch-budget-gate";

export type ObjectiveQueueManagerOptions = {
  store: MemoryOrchestrationQueueStore;
  objectiveStore?: ObjectiveExecutionStorePort;
  backends: readonly WorkerBackendAvailability[];
  planner?: ObjectivePlannerPort;
  now: () => string;
  bearerByRole?: Record<SpecialistTemplateRole, string>;
  billableDispatchGate?: BillableDispatchGate;
  billableReservationUsd?: number;
};

export class ObjectiveQueueManager {
  readonly store: MemoryOrchestrationQueueStore;
  readonly objectiveStore: ObjectiveExecutionStorePort;
  readonly backends: readonly WorkerBackendAvailability[];
  readonly planner: ObjectivePlannerPort;
  readonly now: () => string;
  readonly bearerByRole: Record<SpecialistTemplateRole, string>;
  readonly billableDispatchGate?: BillableDispatchGate;
  readonly billableReservationUsd: number;

  constructor(options: ObjectiveQueueManagerOptions) {
    this.store = options.store;
    this.objectiveStore = options.objectiveStore ?? new InMemoryObjectiveExecutionStore();
    this.backends = options.backends;
    this.planner = options.planner ?? offlineObjectivePlanner;
    this.now = options.now;
    this.bearerByRole = options.bearerByRole ?? {
      research_planning: "token-research",
      engineering: "token-eng",
      qa_independent_review: "token-qa",
      devops: "token-devops",
    };
    this.billableDispatchGate = options.billableDispatchGate;
    this.billableReservationUsd = options.billableReservationUsd ?? 0.25;
  }

  bootstrapAgents(): void {
    registerPhase6bAgents(this.store, this.now());
  }

  submitObjective(input: {
    objectiveId: string;
    parentObjective: string;
    projectId: ObjectiveExecutionRecordV1["plan"]["projectId"];
    idempotencyKey: string;
  }): { record: ObjectiveExecutionRecordV1; created: boolean } {
    const plan = this.planner.createPlan({
      objectiveId: input.objectiveId,
      projectId: input.projectId,
      parentObjective: input.parentObjective,
      now: this.now(),
    });
    const result = this.objectiveStore.submitIdempotent({
      plan,
      idempotencyKey: input.idempotencyKey,
      now: this.now(),
    });
    return result;
  }

  getObjective(objectiveId: string): ObjectiveExecutionRecordV1 | null {
    return this.objectiveStore.get(objectiveId);
  }

  async managerTick(objectiveId: string): Promise<ObjectiveExecutionRecordV1> {
    const record = this.objectiveStore.get(objectiveId);
    if (!record) throw new Error("Unknown objective.");
    let next = this.unstickQaWhenImplementationComplete(record);
    next = this.releaseRunningParentWhenCorrectiveExists(next);

    const scheduled = await scheduleEligiblePlanTasks({
      store: this.store,
      record: next,
      backends: this.backends,
      now: this.now(),
      billableDispatchGate: this.billableDispatchGate,
      billableReservationUsd: this.billableReservationUsd,
    });
    next = scheduled.record;
    this.store.runSchedulerSync(this.now());
    next = syncRunningTasksFromAssignments({
      store: this.store,
      record: next,
      backends: this.backends,
      now: this.now(),
    });
    next = ingestQueueOutcomes({
      store: this.store,
      record: next,
      backends: this.backends,
      now: this.now(),
      acceptedOutcomeKeys: this.objectiveStore.getAcceptedOutcomeKeys(objectiveId),
      onOutcomeAccepted: (outcomeKey) => {
        this.objectiveStore.markOutcomeAccepted(objectiveId, outcomeKey);
      },
    });
    next = this.autoCompleteParentAfterCorrective(next);
    this.refreshQaDependencyOnImplementJob(next);
    next = syncLifecycleFromClosedLoop({ ...next, updatedAt: this.now() });
    this.objectiveStore.put(next);
    return next;
  }

  async runFakeWorkersForObjective(input: {
    objectiveId: string;
    script: FakeWorkerScript;
    maxPasses?: number;
  }): Promise<ObjectiveExecutionRecordV1> {
    resetFakeWorkerScriptCounters();
    const clients = createPhase6bMockClients({
      store: this.store,
      now: this.now,
      bearerByRole: this.bearerByRole,
    });
    const maxPasses = input.maxPasses ?? 48;
    let record = this.objectiveStore.get(input.objectiveId);
    if (!record) throw new Error("Unknown objective.");

    for (let pass = 0; pass < maxPasses; pass += 1) {
      record = await this.managerTick(input.objectiveId);
      if (record.lifecycleState === "completed" || record.lifecycleState === "blocked") {
        break;
      }

      const activeAssignments = this.store
        .listAssignmentsSync()
        .filter((a) => a.state === "active");
      if (activeAssignments.length === 0) {
        continue;
      }

      for (const assignment of activeAssignments) {
        const binding = findBindingForJob(record, assignment.jobId);
        if (!binding) continue;
        const role = binding.specialistRole as SpecialistTemplateRole;
        const client = clients.get(role);
        if (!client) continue;
        await runFakeWorkerForActiveAssignment({
          store: this.store,
          client,
          role,
          taskId: binding.taskId,
          jobId: assignment.jobId,
          script: input.script,
          now: this.now(),
        });
      }
      record = await this.managerTick(input.objectiveId);
      if (record.lifecycleState === "completed") break;
    }

    return this.objectiveStore.get(input.objectiveId) ?? record;
  }

  buildOwnerReport(objectiveId: string) {
    const record = this.objectiveStore.get(objectiveId);
    if (!record) throw new Error("Unknown objective.");
    const progress = buildOwnerProgressReport(record.closedLoop);
    return {
      ...progress,
      queueBindings: record.taskBindings,
      pendingApprovals: record.pendingApprovals,
      lifecycleState: record.lifecycleState,
    };
  }

  /** Mark research/plan task complete when plan-only work is satisfied offline. */
  completePlanTaskOffline(objectiveId: string, taskId: string): void {
    const record = this.objectiveStore.get(objectiveId);
    if (!record) throw new Error("Unknown objective.");
    const tasks = record.closedLoop.plan.tasks.map((t) =>
      t.id === taskId ? { ...t, state: "completed" as const } : t,
    );
    const plan = refreshPlanReadiness({ ...record.closedLoop.plan, tasks });
    this.objectiveStore.put(
      syncLifecycleFromClosedLoop({
        ...record,
        closedLoop: { ...record.closedLoop, plan },
        updatedAt: this.now(),
      }),
    );
  }

  persistObjectiveStoreSnapshot(): string {
    if (!(this.objectiveStore instanceof InMemoryObjectiveExecutionStore)) {
      throw new Error("Snapshot export requires InMemoryObjectiveExecutionStore.");
    }
    return this.objectiveStore.toJson();
  }

  restoreObjectiveStoreSnapshot(payload: string): void {
    if (!(this.objectiveStore instanceof InMemoryObjectiveExecutionStore)) {
      throw new Error("Snapshot restore requires InMemoryObjectiveExecutionStore.");
    }
    const restored = InMemoryObjectiveExecutionStore.fromJson(payload);
    for (const row of restored.list()) {
      this.objectiveStore.put(row);
    }
  }

  private unstickQaWhenImplementationComplete(
    record: ObjectiveExecutionRecordV1,
  ): ObjectiveExecutionRecordV1 {
    const implement = record.closedLoop.plan.tasks.find((t) => t.id === "task-implement");
    const qa = record.closedLoop.plan.tasks.find((t) => t.id === "task-qa");
    if (!implement || !qa || implement.state !== "completed" || qa.state !== "blocked") {
      return record;
    }
    const tasks = record.closedLoop.plan.tasks.map((t) =>
      t.id === "task-qa" ? { ...t, state: "ready" as const } : t,
    );
    const plan = refreshPlanReadiness({ ...record.closedLoop.plan, tasks });
    return {
      ...record,
      closedLoop: { ...record.closedLoop, plan, objectiveState: "active" },
      updatedAt: this.now(),
    };
  }

  private releaseRunningParentWhenCorrectiveExists(
    record: ObjectiveExecutionRecordV1,
  ): ObjectiveExecutionRecordV1 {
    const openFix = record.closedLoop.plan.tasks.find(
      (t) => t.id.startsWith("task-implement-fix") && t.state !== "completed",
    );
    if (!openFix) return record;
    const tasks = record.closedLoop.plan.tasks.map((t) => {
      if (t.id === "task-implement" && t.state !== "completed") {
        return { ...t, state: "running" as const };
      }
      return t;
    });
    const plan = refreshPlanReadiness({ ...record.closedLoop.plan, tasks });
    return { ...record, closedLoop: { ...record.closedLoop, plan }, updatedAt: this.now() };
  }

  private refreshQaDependencyOnImplementJob(record: ObjectiveExecutionRecordV1): void {
    const qaBinding = record.taskBindings.find((b) => b.taskId === "task-qa");
    if (!qaBinding) return;
    const qaJob = this.store.getJobSync(qaBinding.jobId);
    if (!qaJob || qaJob.state === "completed") return;
    const fixBinding = record.taskBindings.find(
      (b) => b.taskId.startsWith("task-implement-fix") && this.store.getJobSync(b.jobId)?.state === "completed",
    );
    if (!fixBinding) return;
    const updated = {
      ...qaJob,
      dependsOnJobIds: [fixBinding.jobId],
      updatedAt: this.now(),
    };
    this.store.restoreJob(updated);
    this.store.refreshDependencyReadinessSync(this.now());
  }

  private autoCompleteParentAfterCorrective(record: ObjectiveExecutionRecordV1): ObjectiveExecutionRecordV1 {
    const completedFix = record.closedLoop.plan.tasks.find(
      (t) => t.id.startsWith("task-implement-fix") && t.state === "completed",
    );
    if (!completedFix) return record;
    const parent = record.closedLoop.plan.tasks.find((t) => t.id === "task-implement");
    if (!parent || parent.state === "completed") return record;
    const tasks = record.closedLoop.plan.tasks.map((t) =>
      t.id === "task-implement" ? { ...t, state: "completed" as const } : t,
    );
    const plan = refreshPlanReadiness({ ...record.closedLoop.plan, tasks });
    return {
      ...record,
      closedLoop: { ...record.closedLoop, plan },
      updatedAt: this.now(),
    };
  }
}
