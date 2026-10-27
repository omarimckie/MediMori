import { SupervisorContractError } from "../supervisor/types";
import type { MemoryOrchestrationQueueStore } from "../orchestration/memory-queue-store";
import type { ObjectiveExecutionRecordV1 } from "../phase6b/objective-execution-record";
import { jobIdForObjectiveTask } from "../phase6b/objective-execution-record";

export type QueueReconciliationResult =
  | { ok: true; warnings: string[] }
  | { ok: false; code: string; reason: string };

export function reconcileObjectiveWithQueue(input: {
  store: MemoryOrchestrationQueueStore;
  record: ObjectiveExecutionRecordV1;
  acceptedOutcomeKeys: readonly string[];
}): QueueReconciliationResult {
  const warnings: string[] = [];
  const bindingByJob = new Map(input.record.taskBindings.map((b) => [b.jobId, b]));
  const seenTaskAttempts = new Set<string>();

  for (const binding of input.record.taskBindings) {
    const attemptKey = `${binding.taskId}:a${binding.attemptNumber}`;
    if (seenTaskAttempts.has(attemptKey)) {
      return { ok: false, code: "duplicate_task_attempt", reason: `Duplicate binding for ${attemptKey}.` };
    }
    seenTaskAttempts.add(attemptKey);

    const job = input.store.getJobSync(binding.jobId);
    if (!job) {
      return { ok: false, code: "missing_job", reason: `Binding references missing job ${binding.jobId}.` };
    }
    const expectedId = jobIdForObjectiveTask(
      input.record.objectiveId,
      binding.taskId,
      binding.attemptNumber,
    );
    if (job.id !== expectedId && job.id !== binding.jobId) {
      return { ok: false, code: "job_identity_mismatch", reason: `Job id ${job.id} does not match binding.` };
    }

    if (binding.outcomeIngested) {
      const outcomeKey = `job:${binding.jobId}:terminal`;
      if (!input.acceptedOutcomeKeys.includes(outcomeKey) && job.state === "completed") {
        warnings.push(`completed_job_without_accepted_outcome:${binding.jobId}`);
      }
    }

    if (job.state === "completed" && binding.outcomeIngested === false) {
      const duplicateComplete = input.store
        .listAssignmentsSync()
        .filter((a) => a.jobId === binding.jobId && a.state === "completed").length;
      if (duplicateComplete > 1) {
        return {
          ok: false,
          code: "duplicate_completion",
          reason: `Multiple completed assignments for ${binding.jobId}.`,
        };
      }
    }
  }

  if (input.record.lifecycleState === "completed") {
    const incomplete = input.record.closedLoop.plan.tasks.filter((t) => t.state !== "completed");
    const qa = input.record.closedLoop.plan.tasks.find((t) => t.id === "task-qa");
    if (incomplete.length > 0) {
      return {
        ok: false,
        code: "premature_objective_completion",
        reason: "Objective marked completed while plan tasks remain open.",
      };
    }
    if (qa && qa.state !== "completed") {
      return { ok: false, code: "qa_not_completed", reason: "Independent QA is required before completion." };
    }
  }

  for (const job of input.store.listJobsSync()) {
    if (job.goalId !== input.record.objectiveId) continue;
    if (!bindingByJob.has(job.id)) {
      warnings.push(`orphan_queue_job:${job.id}`);
    }
  }

  return { ok: true, warnings };
}

export function assertReconciliationOrThrow(result: QueueReconciliationResult): void {
  if (!result.ok) {
    throw new SupervisorContractError(`Queue reconciliation failed: ${result.code} ${result.reason}`);
  }
}
