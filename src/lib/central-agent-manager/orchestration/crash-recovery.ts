import { SupervisorContractError } from "../supervisor/types";
import type { ManagerAssignmentRecord, ManagerJobRecord } from "./contracts-v1";
import { markAssignmentAmbiguous } from "./assignment-lifecycle";
import type { CrashRecoveryReport } from "./orchestration-queue-port";

export function assertRecoverFromCrashSafe(assignments: readonly ManagerAssignmentRecord[]): void {
  const active = assignments.filter((row) => row.state === "active");
  if (active.length > 0) {
    throw new SupervisorContractError(
      "recoverFromCrash refused: active assignments exist. Stop agent consumers and bridge runners first.",
    );
  }
}

export function recoverOrchestrationState(input: {
  jobs: ManagerJobRecord[];
  assignments: ManagerAssignmentRecord[];
  now: string;
}): {
  jobs: ManagerJobRecord[];
  assignments: ManagerAssignmentRecord[];
  report: CrashRecoveryReport;
} {
  const jobs = new Map(input.jobs.map((job) => [job.id, job]));
  const assignments = new Map(input.assignments.map((row) => [row.id, row]));
  let leasesReconciled = 0;
  let ambiguousBlocked = 0;
  let runningWithoutActiveLease = 0;

  const activeByJob = new Map<string, ManagerAssignmentRecord>();
  for (const assignment of assignments.values()) {
    if (assignment.state === "active") {
      activeByJob.set(assignment.jobId, assignment);
    }
  }

  for (const job of jobs.values()) {
    if (job.state !== "running" && job.state !== "assigned") continue;
    const active = activeByJob.get(job.id);
    if (!active) {
      runningWithoutActiveLease += 1;
      const synthetic = {
        id: `recovery-${job.id}`,
        jobId: job.id,
        projectId: job.projectId,
        agentId: "unknown",
        state: "active" as const,
        lease: {
          holderAgentId: "unknown",
          leasedAt: input.now,
          expiresAt: input.now,
          dispatchAttempt: job.attemptCount,
          fenceToken: job.activeLeaseFence ?? 0,
        },
        contractVersion: "central-agent-orchestration-assignment/v1" as const,
        createdAt: input.now,
        updatedAt: input.now,
      };
      const result = markAssignmentAmbiguous(
        synthetic,
        job,
        input.now,
        "Process restart detected running work without an active lease.",
      );
      jobs.set(job.id, result.job);
      assignments.set(synthetic.id, result.assignment);
      ambiguousBlocked += 1;
      leasesReconciled += 1;
    }
  }

  return {
    jobs: [...jobs.values()],
    assignments: [...assignments.values()],
    report: {
      recoveredAt: input.now,
      leasesReconciled,
      ambiguousBlocked,
      runningWithoutActiveLease,
    },
  };
}

export function assertNoStaleActiveLeaseAfterRecovery(
  jobs: readonly ManagerJobRecord[],
  assignments: readonly ManagerAssignmentRecord[],
): void {
  const active = assignments.filter((row) => row.state === "active");
  for (const job of jobs) {
    if (job.state === "running" && !active.some((row) => row.jobId === job.id)) {
      throw new SupervisorContractError("Running job remains without an active lease after recovery.");
    }
  }
}
