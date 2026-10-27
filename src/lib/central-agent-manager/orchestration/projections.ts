import { registeredProjects } from "../registry";
import type { ProjectId } from "../types";
import { agentHasCapacity, DEFAULT_AGENT_STALE_MS } from "./agent-capacity";
import type { ManagerAgentRecord, ManagerAssignmentRecord, ManagerJobRecord } from "./contracts-v1";
import { jobRequiresLiveOwnerApproval } from "./approval-integration";
import type { ExternalExecutionReferences } from "./external-execution-refs";
import { projectExternalExecutionReferences } from "./external-execution-refs";

export type QueueProjectionJob = {
  id: string;
  projectId: ProjectId;
  description: string;
  state: ManagerJobRecord["state"];
  priority: number;
  blockReason: string | null;
  waitingForOwner: boolean;
  attemptCount: number;
  evidenceCount: number;
  externalRefs: ExternalExecutionReferences | null;
};

export type QueueProjectionAssignment = {
  id: string;
  jobId: string;
  projectId: ProjectId;
  agentId: string;
  state: ManagerAssignmentRecord["state"];
  leaseExpiresAt: string;
  externalRefs: ExternalExecutionReferences | null;
};

export type QueueProjectionAgent = {
  id: string;
  label: string;
  status: ManagerAgentRecord["status"];
  eligibleProjectIds: readonly ProjectId[];
  activeAssignments: number;
  capacityAvailable: boolean;
  lastObservedAt: string | null;
};

export type OwnerQueueProjection = {
  generatedAt: string;
  simulation: boolean;
  simulationNotice: string | null;
  queuedByProject: Record<ProjectId, QueueProjectionJob[]>;
  activeAssignments: QueueProjectionAssignment[];
  completedMilestones: { jobId: string; projectId: ProjectId; evidenceIds: readonly string[] }[];
  blockedTasks: { jobId: string; projectId: ProjectId; reason: string }[];
  agentAvailability: QueueProjectionAgent[];
  waitingForOwner: { jobId: string; projectId: ProjectId; operation: string | null }[];
  estimatedRemainingWork: {
    readyJobs: number;
    queuedJobs: number;
    disclaimer: string;
  };
  lastVerifiedActivity: string | null;
};

export function buildOwnerQueueProjection(input: {
  jobs: readonly ManagerJobRecord[];
  assignments: readonly ManagerAssignmentRecord[];
  agents: readonly ManagerAgentRecord[];
  now: string;
  simulation?: boolean;
  staleAfterMs?: number;
}): OwnerQueueProjection {
  const nowMs = Date.parse(input.now);
  const queuedByProject = Object.fromEntries(
    registeredProjects.map((p) => [p.id, [] as QueueProjectionJob[]]),
  ) as Record<ProjectId, QueueProjectionJob[]>;

  const waitingForOwner: OwnerQueueProjection["waitingForOwner"] = [];
  const blockedTasks: OwnerQueueProjection["blockedTasks"] = [];
  let lastVerified: string | null = null;

  for (const job of input.jobs) {
    const row: QueueProjectionJob = {
      id: job.id,
      projectId: job.projectId,
      description: job.description,
      state: job.state,
      priority: job.priority,
      blockReason: job.blockReason,
      waitingForOwner: jobRequiresLiveOwnerApproval(job, input.now),
      attemptCount: job.attemptCount,
      evidenceCount: job.evidenceIds.length,
      externalRefs: projectExternalExecutionReferences(job.externalRefs),
    };
    if (["queued", "ready", "assigned", "running", "awaiting_approval", "blocked"].includes(job.state)) {
      queuedByProject[job.projectId].push(row);
    }
    if (job.state === "blocked" && job.blockReason) {
      blockedTasks.push({ jobId: job.id, projectId: job.projectId, reason: job.blockReason });
    }
    if (jobRequiresLiveOwnerApproval(job, input.now)) {
      waitingForOwner.push({
        jobId: job.id,
        projectId: job.projectId,
        operation: job.requestedOperation,
      });
    }
    if (job.state === "completed" && job.evidenceIds.length) {
      if (!lastVerified || job.updatedAt > lastVerified) lastVerified = job.updatedAt;
    }
  }

  for (const projectId of registeredProjects.map((p) => p.id)) {
    queuedByProject[projectId].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  const activeAssignments = input.assignments
    .filter((a) => a.state === "active")
    .map((a) => ({
      id: a.id,
      jobId: a.jobId,
      projectId: a.projectId,
      agentId: a.agentId,
      state: a.state,
      leaseExpiresAt: a.lease.expiresAt,
      externalRefs: projectExternalExecutionReferences(a.externalRefs),
    }));

  const completedMilestones = input.jobs
    .filter((j) => j.state === "completed")
    .map((j) => ({ jobId: j.id, projectId: j.projectId, evidenceIds: j.evidenceIds }));

  const agentAvailability = input.agents.map((agent) => ({
    id: agent.id,
    label: agent.label,
    status: agent.status,
    eligibleProjectIds: agent.eligibleProjectIds,
    activeAssignments: agent.activeAssignmentIds.length,
    capacityAvailable: agentHasCapacity(agent, nowMs, input.staleAfterMs ?? DEFAULT_AGENT_STALE_MS),
    lastObservedAt: agent.lastObservedAt,
  }));

  const readyJobs = input.jobs.filter((j) => j.state === "ready").length;
  const queuedJobs = input.jobs.filter((j) => j.state === "queued" || j.state === "blocked").length;

  return {
    generatedAt: input.now,
    simulation: input.simulation ?? false,
    simulationNotice: input.simulation
      ? "Simulated queue data only. No workers are connected and no external execution occurred."
      : null,
    queuedByProject,
    activeAssignments,
    completedMilestones,
    blockedTasks,
    agentAvailability,
    waitingForOwner,
    estimatedRemainingWork: {
      readyJobs,
      queuedJobs,
      disclaimer:
        "Estimates count local queue states only; they are not predictions of real completion time.",
    },
    lastVerifiedActivity: lastVerified,
  };
}
