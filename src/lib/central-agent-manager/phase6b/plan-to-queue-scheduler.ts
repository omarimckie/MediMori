import { SupervisorContractError } from "../supervisor/types";
import type { MemoryOrchestrationQueueStore } from "../orchestration/memory-queue-store";
import { refreshPlanReadiness, type PlanTaskRecord } from "../phase6a/objective-plan";
import { matchWorkerForTask, type WorkerBackendAvailability } from "../phase6a/worker-matching";
import type { SpecialistTemplateRole } from "../phase6a/specialist-template-registry";
import {
  findBindingForJob,
  jobIdForObjectiveTask,
  syncLifecycleFromClosedLoop,
  type ObjectiveExecutionRecordV1,
  type TaskQueueBinding,
} from "./objective-execution-record";
import { orchestrationProjectId } from "./queue-agent-registry";
import type { BillableDispatchGate } from "../phase6f/billable-dispatch-budget-gate";
import { isBillableSpecialistRole } from "../phase6f/billable-dispatch-budget-gate";

export type SchedulePlanTasksResult = {
  record: ObjectiveExecutionRecordV1;
  enqueuedJobIds: string[];
  skippedReasons: string[];
};

function latestBindingByTask(bindings: readonly TaskQueueBinding[]): Map<string, TaskQueueBinding> {
  const map = new Map<string, TaskQueueBinding>();
  for (const binding of bindings) {
    const existing = map.get(binding.taskId);
    if (!existing || binding.attemptNumber >= existing.attemptNumber) {
      map.set(binding.taskId, binding);
    }
  }
  return map;
}

function resolveDependencyJobId(
  store: MemoryOrchestrationQueueStore,
  record: ObjectiveExecutionRecordV1,
  depTaskId: string,
): string | undefined {
  const candidates = record.taskBindings.filter(
    (b) => b.taskId === depTaskId || b.taskId.startsWith(`${depTaskId}-fix`),
  );
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const job = store.getJobSync(candidates[index].jobId);
    if (job?.state === "completed") return candidates[index].jobId;
  }
  return latestBindingByTask(record.taskBindings).get(depTaskId)?.jobId;
}

function taskAttemptNumber(record: ObjectiveExecutionRecordV1, taskId: string): number {
  const attempts = record.taskBindings.filter((b) => b.taskId === taskId).length;
  return attempts + 1;
}

function openJobIdsForRecord(
  store: MemoryOrchestrationQueueStore,
  record: ObjectiveExecutionRecordV1,
): Set<string> {
  const open = new Set<string>();
  for (const binding of record.taskBindings) {
    const job = store.getJobSync(binding.jobId);
    if (!job) continue;
    if (job.state !== "completed" && job.state !== "failed" && job.state !== "cancelled") {
      open.add(binding.jobId);
    }
  }
  return open;
}

function runningTaskCount(record: ObjectiveExecutionRecordV1): number {
  return record.closedLoop.plan.tasks.filter((t) => t.state === "running").length;
}

function blockTasksOnFailedDependencies(
  store: MemoryOrchestrationQueueStore,
  record: ObjectiveExecutionRecordV1,
  now: string,
): ObjectiveExecutionRecordV1 {
  let plan = record.closedLoop.plan;
  const failedJobIds = new Set(
    record.taskBindings
      .map((b) => store.getJobSync(b.jobId))
      .filter((job) => job && job.state === "failed")
      .map((job) => job!.id),
  );
  if (failedJobIds.size === 0) return record;
  const failedTasks = new Set(
    record.taskBindings.filter((b) => failedJobIds.has(b.jobId)).map((b) => b.taskId),
  );
  const tasks = plan.tasks.map((task) => {
    if (task.state !== "pending" && task.state !== "ready") return task;
    if (
      task.dependsOn.some((dep) => {
        const depTask = plan.tasks.find((row) => row.id === dep);
        if (depTask?.state === "completed") return false;
        return failedTasks.has(dep);
      })
    ) {
      return { ...task, state: "blocked" as const };
    }
    return task;
  });
  plan = { ...plan, tasks };
  return syncLifecycleFromClosedLoop({
    ...record,
    closedLoop: { ...record.closedLoop, plan },
    updatedAt: now,
  });
}

export async function scheduleEligiblePlanTasks(input: {
  store: MemoryOrchestrationQueueStore;
  record: ObjectiveExecutionRecordV1;
  backends: readonly WorkerBackendAvailability[];
  now: string;
  billableDispatchGate?: BillableDispatchGate;
  billableReservationUsd?: number;
}): Promise<SchedulePlanTasksResult> {
  let record = blockTasksOnFailedDependencies(input.store, input.record, input.now);
  const enqueuedJobIds: string[] = [];
  const skippedReasons: string[] = [];

  const refreshedPlan = refreshPlanReadiness(record.closedLoop.plan);
  record = syncLifecycleFromClosedLoop({
    ...record,
    closedLoop: { ...record.closedLoop, plan: refreshedPlan },
    updatedAt: input.now,
  });

  if (record.lifecycleState === "completed" || record.lifecycleState === "blocked") {
    return { record, enqueuedJobIds, skippedReasons };
  }

  const openJobs = openJobIdsForRecord(input.store, record);
  const latestByTask = latestBindingByTask(record.taskBindings);
  const readyTasks = record.closedLoop.plan.tasks.filter((t) => t.state === "ready");

  for (const task of readyTasks) {
    if (
      task.id === "task-implement" &&
      record.closedLoop.plan.tasks.some(
        (t) => t.id.startsWith("task-implement-fix") && t.state !== "completed",
      )
    ) {
      skippedReasons.push(`${task.id}:corrective_in_flight`);
      continue;
    }
    const latest = latestByTask.get(task.id);
    if (latest) {
      const job = input.store.getJobSync(latest.jobId);
      if (job && job.state !== "completed" && job.state !== "failed" && job.state !== "cancelled") {
        skippedReasons.push(`${task.id}:active_job`);
        continue;
      }
      if (job?.state === "completed" && task.state === "ready") {
        skippedReasons.push(`${task.id}:awaiting_outcome_ingestion`);
        continue;
      }
    }

    if (runningTaskCount(record) + openJobs.size >= record.maxConcurrentTasks) {
      skippedReasons.push(`${task.id}:concurrency_cap`);
      continue;
    }

    const role = (task.assignedRole ?? "engineering") as SpecialistTemplateRole;
    const implementerTaskIds = record.closedLoop.plan.tasks
      .filter((t) => t.assignedRole === "engineering")
      .map((t) => t.id);
    const match = matchWorkerForTask({
      projectId: record.plan.projectId,
      requiredCapabilities: task.requiredCapabilities,
      taskOperations: [...task.requiredCapabilities, ...task.protectedOperations],
      backends: input.backends,
      budgetRemainingUsd: record.closedLoop.budgetRemainingUsd,
      candidateTaskId: task.id,
      implementerTaskIds: role === "qa_independent_review" ? implementerTaskIds : undefined,
    });
    if (!match.ok) {
      skippedReasons.push(`${task.id}:${match.code}`);
      continue;
    }

    const dependsOnJobIds = task.dependsOn
      .map((depId) => resolveDependencyJobId(input.store, record, depId))
      .filter((id): id is string => Boolean(id));

    const attempt = taskAttemptNumber(record, task.id);
    const jobId = jobIdForObjectiveTask(record.objectiveId, task.id, attempt);
    if (input.store.getJobSync(jobId)) {
      skippedReasons.push(`${task.id}:duplicate_job_id`);
      continue;
    }

    const template = match.template;
    if (input.billableDispatchGate && isBillableSpecialistRole(role)) {
      try {
        await input.billableDispatchGate({
          objectiveId: record.objectiveId,
          taskId: task.id,
          jobId,
          attemptNumber: attempt,
          role,
          amountUsd: input.billableReservationUsd ?? 0.25,
        });
      } catch (error) {
        skippedReasons.push(`${task.id}:durable_budget_blocked`);
        continue;
      }
    }
    try {
      input.store.enqueueJobSync({
        id: jobId,
        projectId: orchestrationProjectId(record.plan.projectId),
        goalId: record.objectiveId,
        description: `${record.plan.parentObjective}: ${task.title}`,
        dependsOnJobIds,
        requiredCapabilities: [...task.requiredCapabilities],
        specialistId: template.linkedSpecialistId,
        provenance: { enqueuedBy: "manager_policy", enqueuedAt: input.now, source: "manager_policy" },
        externalRefs: { correlationKey: `objective:${record.objectiveId}:task:${task.id}` },
        now: input.now,
      });
    } catch (error) {
      if (error instanceof SupervisorContractError && error.message.includes("Duplicate")) {
        skippedReasons.push(`${task.id}:duplicate_enqueue`);
        continue;
      }
      throw error;
    }

    const binding: TaskQueueBinding = {
      taskId: task.id,
      jobId,
      enqueuedAt: input.now,
      specialistRole: role,
      attemptNumber: attempt,
      outcomeIngested: false,
    };
    record = {
      ...record,
      taskBindings: [...record.taskBindings, binding],
      updatedAt: input.now,
    };
    enqueuedJobIds.push(jobId);
    openJobs.add(jobId);
  }

  return { record, enqueuedJobIds, skippedReasons };
}

export function assertNoDuplicateOpenBindings(record: ObjectiveExecutionRecordV1, taskId: string): void {
  const open = record.taskBindings.filter((b) => b.taskId === taskId && !b.outcomeIngested);
  if (open.length > 1) {
    throw new SupervisorContractError(`Duplicate open bindings for task ${taskId}.`);
  }
}
