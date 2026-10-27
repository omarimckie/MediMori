import { SupervisorContractError } from "../supervisor/types";
import type { ManagerJobRecord, ManagerJobState } from "./contracts-v1";

const transitions: Record<ManagerJobState, readonly ManagerJobState[]> = {
  queued: ["blocked", "ready", "cancelled"],
  blocked: ["ready", "cancelled", "queued"],
  ready: ["assigned", "blocked", "awaiting_approval", "cancelled"],
  assigned: ["running", "ready", "cancelled", "failed"],
  running: ["completed", "failed", "cancelled", "awaiting_approval", "assigned", "blocked", "ready"],
  awaiting_approval: ["ready", "cancelled", "blocked"],
  completed: ["blocked"],
  failed: ["ready", "cancelled"],
  cancelled: [],
};

export type JobTransitionContext = {
  now: string;
  evidenceIds?: readonly string[];
  failureReason?: string | null;
  blockReason?: string | null;
  assignmentId?: string | null;
  idempotent?: boolean;
  /** Recovery-only: completed jobs with unverifiable durable evidence may be blocked. */
  reconcileUnverifiableCompletion?: boolean;
};

export function canTransitionJob(job: ManagerJobRecord, to: ManagerJobState): boolean {
  return transitions[job.state].includes(to);
}

export function transitionManagerJob(
  job: ManagerJobRecord,
  to: ManagerJobState,
  context: JobTransitionContext,
): ManagerJobRecord {
  if (job.state === to && context.idempotent) {
    return job;
  }
  if (to === "completed") {
    const evidence = context.evidenceIds ?? job.evidenceIds;
    if (!evidence.length) {
      throw new SupervisorContractError("Terminal success requires evidence references.");
    }
  }
  if (job.state === "completed" && to === "blocked") {
    if (!context.reconcileUnverifiableCompletion) {
      throw new SupervisorContractError("Completed jobs cannot be blocked outside evidence reconciliation.");
    }
  } else if (!canTransitionJob(job, to)) {
    throw new SupervisorContractError(`Cannot transition job from ${job.state} to ${to}.`);
  }
  const terminalOutcome =
    job.state === "completed" && to === "blocked"
      ? "none"
      : to === "completed"
        ? "succeeded"
        : to === "failed"
          ? "failed"
          : to === "cancelled"
            ? "cancelled"
            : job.terminalOutcome;
  return {
    ...job,
    state: to,
    evidenceIds: context.evidenceIds ?? job.evidenceIds,
    failureReason: to === "failed" ? (context.failureReason ?? job.failureReason) : job.failureReason,
    blockReason:
      to === "blocked" ? (context.blockReason ?? job.blockReason) : to === "ready" ? null : job.blockReason,
    assignmentId:
      context.assignmentId !== undefined
        ? context.assignmentId
        : to === "ready" || to === "cancelled" || to === "failed"
          ? null
          : job.assignmentId,
    terminalOutcome,
    updatedAt: context.now,
  };
}

const dependencyBlockPrefix = "Waiting on dependencies:";

export function markJobReadyFromDependencies(
  job: ManagerJobRecord,
  completedJobIds: ReadonlySet<string>,
  now: string,
): ManagerJobRecord {
  if (job.state === "blocked" && !job.blockReason?.startsWith(dependencyBlockPrefix)) {
    return job;
  }
  if (job.state !== "queued" && job.state !== "blocked") return job;
  const pending = job.dependsOnJobIds.filter((id) => !completedJobIds.has(id));
  if (pending.length) {
    if (job.state === "blocked") return job;
    return transitionManagerJob(job, "blocked", {
      now,
      blockReason: `${dependencyBlockPrefix} ${pending.join(", ")}`,
    });
  }
  if (job.state === "blocked" || job.state === "queued") {
    return transitionManagerJob(job, "ready", { now, blockReason: null });
  }
  return job;
}
