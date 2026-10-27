import { serializeManagerJob, type ManagerAssignmentRecord, type ManagerJobRecord } from "./contracts-v1";
import type { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import type { OrchestrationSqlPort } from "./orchestration-sql-port";
import type { SchedulerTickResult } from "./scheduler";
import { attachAssignmentToAgent } from "./agent-capacity";

export class DurableOrchestrationPersistRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurableOrchestrationPersistRejectedError";
  }
}

export function snapshotJobFingerprints(
  memory: MemoryOrchestrationQueueStore,
): Map<string, string> {
  return new Map(
    memory.listJobsSync().map((job) => [
      job.id,
      `${job.state}|${job.updatedAt}|${job.blockReason ?? ""}|${job.approvalBinding?.approvalRecordId ?? ""}`,
    ]),
  );
}

export function snapshotActiveAssignments(
  memory: MemoryOrchestrationQueueStore,
): Map<string, { assignment: ManagerAssignmentRecord; job: ManagerJobRecord }> {
  const map = new Map<string, { assignment: ManagerAssignmentRecord; job: ManagerJobRecord }>();
  for (const assignment of memory.listAssignmentsSync()) {
    if (assignment.state !== "active") continue;
    const job = memory.getJobSync(assignment.jobId);
    if (!job) continue;
    map.set(assignment.id, { assignment, job });
  }
  return map;
}

export async function persistOwnerWritableJob(
  sql: OrchestrationSqlPort,
  job: ManagerJobRecord,
): Promise<boolean> {
  return sql.upsertJobIfOwnerWritable({
    id: job.id,
    payload_json: serializeManagerJob(job),
    updated_at: job.updatedAt,
  });
}

export async function persistOwnerWritableJobOrReject(
  sql: OrchestrationSqlPort,
  job: ManagerJobRecord,
  context: string,
): Promise<void> {
  const persisted = await persistOwnerWritableJob(sql, job);
  if (!persisted) {
    throw new DurableOrchestrationPersistRejectedError(
      `owner job persist rejected (${context}) for job ${job.id}`,
    );
  }
}

export async function persistJobsFromMemory(
  sql: OrchestrationSqlPort,
  memory: MemoryOrchestrationQueueStore,
  jobIds?: readonly string[],
): Promise<void> {
  const jobs = jobIds
    ? jobIds
        .map((id) => memory.getJobSync(id))
        .filter((row): row is ManagerJobRecord => row !== undefined)
    : memory.listJobsSync();
  for (const job of jobs) {
    await persistOwnerWritableJob(sql, job);
  }
}

export async function persistAgentsFromMemory(
  sql: OrchestrationSqlPort,
  memory: MemoryOrchestrationQueueStore,
  agentIds?: readonly string[],
): Promise<void> {
  const agents = agentIds
    ? agentIds
        .map((id) => memory.listAgentsSync().find((row) => row.id === id))
        .filter((row): row is NonNullable<typeof row> => row !== undefined)
    : memory.listAgentsSync();
  for (const agent of agents) {
    await sql.upsertAgent({
      id: agent.id,
      payload_json: JSON.stringify(agent),
      updated_at: agent.lastObservedAt ?? new Date(0).toISOString(),
    });
  }
}

export async function persistDependencyReadinessMutations(
  sql: OrchestrationSqlPort,
  memory: MemoryOrchestrationQueueStore,
  beforeJobs: Map<string, string>,
): Promise<void> {
  const changedJobIds: string[] = [];
  for (const job of memory.listJobsSync()) {
    const fingerprint = `${job.state}|${job.updatedAt}|${job.blockReason ?? ""}|${job.approvalBinding?.approvalRecordId ?? ""}`;
    if (beforeJobs.get(job.id) !== fingerprint) {
      changedJobIds.push(job.id);
    }
  }
  await persistJobsFromMemory(sql, memory, changedJobIds);
}

function assignmentPersistFingerprint(assignment: ManagerAssignmentRecord): string {
  return `${assignment.state}|${assignment.updatedAt}|${assignment.lease.fenceToken}`;
}

export async function persistReconcileLeaseMutations(
  sql: OrchestrationSqlPort,
  memory: MemoryOrchestrationQueueStore,
  beforeActive: Map<string, { assignment: ManagerAssignmentRecord; job: ManagerJobRecord }>,
): Promise<void> {
  const touchedAgents = new Set<string>();
  for (const [assignmentId, snap] of beforeActive) {
    const afterAssignment = memory.listAssignmentsSync().find((row) => row.id === assignmentId);
    if (!afterAssignment) continue;
    const afterJob = memory.getJobSync(afterAssignment.jobId);
    if (!afterJob) continue;
    if (
      assignmentPersistFingerprint(snap.assignment) === assignmentPersistFingerprint(afterAssignment) &&
      snap.job.updatedAt === afterJob.updatedAt
    ) {
      continue;
    }
    const persisted = await sql.updateAssignmentWithJobIfFence({
      assignmentId,
      assignmentJson: JSON.stringify(afterAssignment),
      fenceToken: snap.assignment.lease.fenceToken,
      jobId: afterJob.id,
      jobJson: serializeManagerJob(afterJob),
      now: afterAssignment.updatedAt,
      allowedAssignmentStates: ["active"],
    });
    if (!persisted) {
      throw new DurableOrchestrationPersistRejectedError(
        `reconcile lease persist rejected for assignment ${assignmentId}`,
      );
    }
    touchedAgents.add(afterAssignment.agentId);
  }
  if (touchedAgents.size > 0) {
    await persistAgentsFromMemory(sql, memory, [...touchedAgents]);
  }
}

export async function persistAmbiguousOutcomeMutation(
  sql: OrchestrationSqlPort,
  memory: MemoryOrchestrationQueueStore,
  assignmentId: string,
  fenceToken: number,
): Promise<void> {
  const assignment = memory.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) {
    throw new DurableOrchestrationPersistRejectedError("ambiguous outcome assignment missing from memory");
  }
  const job = memory.getJobSync(assignment.jobId);
  if (!job) {
    throw new DurableOrchestrationPersistRejectedError("ambiguous outcome job missing from memory");
  }
  const persisted = await sql.updateAssignmentWithJobIfFence({
    assignmentId,
    assignmentJson: JSON.stringify(assignment),
    fenceToken,
    jobId: job.id,
    jobJson: serializeManagerJob(job),
    now: assignment.updatedAt,
    allowedAssignmentStates: ["active"],
  });
  if (!persisted) {
    throw new DurableOrchestrationPersistRejectedError("ambiguous outcome persist rejected by fence");
  }
  await persistAgentsFromMemory(sql, memory, [assignment.agentId]);
}

export async function persistSchedulerTickMutations(
  sql: OrchestrationSqlPort,
  memory: MemoryOrchestrationQueueStore,
  tick: SchedulerTickResult,
  durableClaimsEnabled: boolean,
): Promise<void> {
  const claimedJobIds = new Set<string>();
  for (const assignment of tick.assignments) {
    const job = tick.updatedJobs.find((row) => row.id === assignment.jobId);
    if (!job) continue;
    const claimed = await claimReadyJobDurably(sql, memory, {
      job,
      assignment,
      now: assignment.updatedAt,
    });
    if (!claimed) continue;
    claimedJobIds.add(job.id);
    if (!durableClaimsEnabled) {
      const agent = memory.listAgentsSync().find((row) => row.id === assignment.agentId);
      if (agent) {
        memory.registerAgentSync(attachAssignmentToAgent(agent, assignment.id));
      }
    }
    const agent = memory.listAgentsSync().find((row) => row.id === assignment.agentId);
    if (agent) {
      await sql.upsertAgent({
        id: agent.id,
        payload_json: JSON.stringify(agent),
        updated_at: agent.lastObservedAt ?? assignment.updatedAt,
      });
    }
  }
  for (const job of tick.updatedJobs) {
    if (claimedJobIds.has(job.id)) continue;
    await persistOwnerWritableJob(sql, job);
  }
}

export async function claimReadyJobDurably(
  sql: OrchestrationSqlPort,
  memory: MemoryOrchestrationQueueStore,
  input: {
    job: ManagerJobRecord;
    assignment: ManagerAssignmentRecord;
    now: string;
  },
): Promise<boolean> {
  const claimed = await sql.tryClaimReadyJob({
    jobId: input.job.id,
    jobJson: serializeManagerJob(input.job),
    assignmentId: input.assignment.id,
    assignmentJson: JSON.stringify(input.assignment),
    assignmentJobId: input.job.id,
    now: input.now,
  });
  if (!claimed) return false;
  memory.restoreJob(input.job);
  memory.restoreAssignment(input.assignment);
  return true;
}

export async function persistRecoverFromCrashMutations(
  sql: OrchestrationSqlPort,
  memory: MemoryOrchestrationQueueStore,
  beforeAssignments: Map<string, ManagerAssignmentRecord>,
  beforeJobs: Map<string, string>,
): Promise<void> {
  for (const assignment of memory.listAssignmentsSync()) {
    const job = memory.getJobSync(assignment.jobId);
    if (!job) continue;
    const before = beforeAssignments.get(assignment.id);
    if (!before) {
      await sql.upsertAssignment({
        id: assignment.id,
        job_id: assignment.jobId,
        payload_json: JSON.stringify(assignment),
        updated_at: assignment.updatedAt,
      });
      const persistedJob = await persistOwnerWritableJob(sql, job);
      if (!persistedJob) {
        throw new DurableOrchestrationPersistRejectedError(
          `crash recovery job persist rejected for new assignment ${assignment.id}`,
        );
      }
      continue;
    }
    if (assignmentPersistFingerprint(before) === assignmentPersistFingerprint(assignment) && before.updatedAt === assignment.updatedAt) {
      continue;
    }
    if (before.state === "active") {
      const persisted = await sql.updateAssignmentWithJobIfFence({
        assignmentId: assignment.id,
        assignmentJson: JSON.stringify(assignment),
        fenceToken: before.lease.fenceToken,
        jobId: job.id,
        jobJson: serializeManagerJob(job),
        now: assignment.updatedAt,
        allowedAssignmentStates: ["active", "ambiguous"],
      });
      if (!persisted) {
        throw new DurableOrchestrationPersistRejectedError(
          `crash recovery persist rejected for assignment ${assignment.id}`,
        );
      }
      continue;
    }
    await sql.upsertAssignment({
      id: assignment.id,
      job_id: assignment.jobId,
      payload_json: JSON.stringify(assignment),
      updated_at: assignment.updatedAt,
    });
    const persistedJob = await persistOwnerWritableJob(sql, job);
    if (!persistedJob) {
      throw new DurableOrchestrationPersistRejectedError(
        `crash recovery job persist rejected for assignment ${assignment.id}`,
      );
    }
  }
  await persistDependencyReadinessMutations(sql, memory, beforeJobs);
}
