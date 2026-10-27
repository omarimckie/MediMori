import type { ManagerAssignmentRecord, ManagerJobRecord } from "../orchestration/contracts-v1";
import type { MemoryOrchestrationQueueStore } from "../orchestration/memory-queue-store";
import {
  applyWorkerOutcome,
  startTaskWorker,
  type WorkerOutcome,
  type WorkerOutcomeReport,
} from "../phase6a/closed-loop-manager";
import type { SpecialistTemplateRole } from "../phase6a/specialist-template-registry";
import type { WorkerBackendAvailability } from "../phase6a/worker-matching";
import {
  findBindingForJob,
  syncLifecycleFromClosedLoop,
  type ObjectiveExecutionRecordV1,
} from "./objective-execution-record";
import { roleForAgentId } from "./queue-agent-registry";
import { buildTerminalOutcomeKey, hasAcceptedOutcome } from "../phase6c/outcome-idempotency";

export const CAM6B_OUTCOME_PREFIX = "cam6b:outcome:" as const;

export function encodeCam6bFailureOutcome(outcome: WorkerOutcome): string {
  return `${CAM6B_OUTCOME_PREFIX}${outcome}`;
}

export function decodeCam6bFailureOutcome(reason: string | null | undefined): WorkerOutcome | null {
  if (!reason?.startsWith(CAM6B_OUTCOME_PREFIX)) return null;
  const outcome = reason.slice(CAM6B_OUTCOME_PREFIX.length) as WorkerOutcome;
  return outcome;
}

export function mapCompletedJobToOutcomeReport(input: {
  record: ObjectiveExecutionRecordV1;
  job: ManagerJobRecord;
  assignment: ManagerAssignmentRecord | null;
  evidenceIds: readonly string[];
}): WorkerOutcomeReport | null {
  const binding = findBindingForJob(input.record, input.job.id);
  if (!binding || binding.outcomeIngested) return null;
  const role = (binding.specialistRole ?? "engineering") as SpecialistTemplateRole;
  const workerId =
    input.record.closedLoop.workers
      .list()
      .find((w) => w.taskId === binding.taskId && w.state !== "retired")?.workerId ??
    `worker-queue-${binding.jobId}`;
  return {
    taskId: binding.taskId,
    workerId,
    role,
    outcome: "completed_success",
    evidenceIds: [...input.evidenceIds],
  };
}

export function mapFailedJobToOutcomeReport(input: {
  record: ObjectiveExecutionRecordV1;
  job: ManagerJobRecord;
}): WorkerOutcomeReport | null {
  const binding = findBindingForJob(input.record, input.job.id);
  if (!binding || binding.outcomeIngested) return null;
  const decoded = decodeCam6bFailureOutcome(input.job.failureReason);
  if (!decoded) return null;
  const role = (binding.specialistRole ?? "engineering") as SpecialistTemplateRole;
  const workerId =
    input.record.closedLoop.workers
      .list()
      .find((w) => w.taskId === binding.taskId)?.workerId ?? `worker-queue-${binding.jobId}`;
  return {
    taskId: binding.taskId,
    workerId,
    role,
    outcome: decoded,
  };
}

export function ingestQueueOutcomes(input: {
  store: MemoryOrchestrationQueueStore;
  record: ObjectiveExecutionRecordV1;
  backends: readonly WorkerBackendAvailability[];
  now: string;
  acceptedOutcomeKeys?: readonly string[];
  onOutcomeAccepted?: (outcomeKey: string) => void;
}): ObjectiveExecutionRecordV1 {
  let record = input.record;
  const assignments = input.store.listAssignmentsSync();

  for (const binding of record.taskBindings) {
    if (binding.outcomeIngested) continue;
    const job = input.store.getJobSync(binding.jobId);
    if (!job) continue;

    const assignment =
      assignments.find((a) => a.jobId === job.id && a.state !== "active") ??
      assignments.find((a) => a.jobId === job.id) ??
      null;

    if (job.state === "completed") {
      const outcomeKey = buildTerminalOutcomeKey(binding.jobId, "completed");
      if (hasAcceptedOutcome(input.acceptedOutcomeKeys ?? [], outcomeKey)) {
        record = markBindingIngested(record, binding.jobId, input.now);
        continue;
      }
      const report = mapCompletedJobToOutcomeReport({
        record,
        job,
        assignment,
        evidenceIds: job.evidenceIds,
      });
      if (!report) continue;
      record = applyOutcomeToRecord(record, report, input.backends, input.now);
      record = markBindingIngested(record, binding.jobId, input.now);
      input.onOutcomeAccepted?.(outcomeKey);
      if (report.outcome === "recoverable_technical_failure") {
        try {
          input.store.cancelJobSync(binding.jobId, input.now);
        } catch {
          // Job may already be terminal.
        }
      }
      continue;
    }

    const failedAssignment = assignment && assignment.state === "failed";
    const carriesCamOutcome = Boolean(decodeCam6bFailureOutcome(job.failureReason));
    if (job.state === "failed" || failedAssignment || (carriesCamOutcome && !binding.outcomeIngested)) {
      const outcomeKey = buildTerminalOutcomeKey(binding.jobId, "failed");
      if (hasAcceptedOutcome(input.acceptedOutcomeKeys ?? [], outcomeKey)) {
        record = markBindingIngested(record, binding.jobId, input.now);
        continue;
      }
      const report = mapFailedJobToOutcomeReport({ record, job });
      if (!report) continue;
      record = applyOutcomeToRecord(record, report, input.backends, input.now);
      record = markBindingIngested(record, binding.jobId, input.now);
      input.onOutcomeAccepted?.(outcomeKey);
    }
  }

  return syncLifecycleFromClosedLoop(record);
}

function markBindingIngested(
  record: ObjectiveExecutionRecordV1,
  jobId: string,
  now: string,
): ObjectiveExecutionRecordV1 {
  return {
    ...record,
    taskBindings: record.taskBindings.map((b) =>
      b.jobId === jobId ? { ...b, outcomeIngested: true } : b,
    ),
    updatedAt: now,
  };
}

function applyOutcomeToRecord(
  record: ObjectiveExecutionRecordV1,
  report: WorkerOutcomeReport,
  backends: readonly WorkerBackendAvailability[],
  now: string,
): ObjectiveExecutionRecordV1 {
  let closedLoop = { ...record.closedLoop };
  let workerId = report.workerId;
  const activeWorker = closedLoop.workers
    .list()
    .find((w) => w.taskId === report.taskId && w.state !== "retired" && w.state !== "failed" && w.state !== "blocked");
  if (!activeWorker) {
    const started = startTaskWorker(closedLoop, report.taskId, [...backends], record.plan.projectId, now);
    if ("error" in started) {
      return record;
    }
    closedLoop = started.state;
    workerId = started.workerId;
  } else {
    workerId = activeWorker.workerId;
  }
  closedLoop = applyWorkerOutcome(
    closedLoop,
    { ...report, workerId },
    [...backends],
    now,
  );
  return syncLifecycleFromClosedLoop({
    ...record,
    closedLoop,
    updatedAt: now,
  });
}

export function syncRunningTasksFromAssignments(input: {
  store: MemoryOrchestrationQueueStore;
  record: ObjectiveExecutionRecordV1;
  backends: readonly WorkerBackendAvailability[];
  now: string;
}): ObjectiveExecutionRecordV1 {
  let record = input.record;
  const activeAssignments = input.store.listAssignmentsSync().filter((a) => a.state === "active");
  for (const assignment of activeAssignments) {
    if (record.processedAssignmentIds.includes(assignment.id)) continue;
    const binding = findBindingForJob(record, assignment.jobId);
    if (!binding) continue;
    const task = record.closedLoop.plan.tasks.find((t) => t.id === binding.taskId);
    if (!task || task.state === "running") {
      record = {
        ...record,
        processedAssignmentIds: [...record.processedAssignmentIds, assignment.id],
      };
      continue;
    }
    const role = roleForAgentId(assignment.agentId);
    if (!role) continue;
    const started = startTaskWorker(record.closedLoop, binding.taskId, [...input.backends], record.plan.projectId, input.now);
    if ("error" in started) continue;
    record = syncLifecycleFromClosedLoop({
      ...record,
      closedLoop: started.state,
      processedAssignmentIds: [...record.processedAssignmentIds, assignment.id],
      updatedAt: input.now,
    });
  }
  return record;
}
