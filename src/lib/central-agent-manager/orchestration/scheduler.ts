import { budgetBlockReason } from "../supervisor/budget";
import { SupervisorContractError } from "../supervisor/types";
import type { ProjectId } from "../types";
import {
  agentEligibleForProject,
  agentHasCapabilities,
  agentHasCapacity,
} from "./agent-capacity";
import type { ManagerAgentRecord, ManagerAssignmentRecord, ManagerJobRecord } from "./contracts-v1";
import { jobRequiresLiveOwnerApproval } from "./approval-integration";
import { createAssignmentRecord } from "./assignment-lifecycle";
import { transitionManagerJob } from "./job-state";

export type SchedulerTickResult = {
  assignments: ManagerAssignmentRecord[];
  updatedJobs: ManagerJobRecord[];
};

export type SchedulerOptions = {
  now: string;
  leaseMs?: number;
  staleAfterMs?: number;
  /** Round-robin cursor per tick for fairness across projects. */
  projectCursor?: number;
};

function jobSortKey(job: ManagerJobRecord): [number, number, string] {
  return [job.priority, job.sequence, job.id];
}

function compareJobs(a: ManagerJobRecord, b: ManagerJobRecord): number {
  const [ap, as, aid] = jobSortKey(a);
  const [bp, bs, bid] = jobSortKey(b);
  if (ap !== bp) return ap - bp;
  if (as !== bs) return as - bs;
  return aid.localeCompare(bid);
}

export function listReadyJobs(jobs: readonly ManagerJobRecord[]): ManagerJobRecord[] {
  return jobs.filter((job) => job.state === "ready").sort(compareJobs);
}

export function selectAgentForJob(
  job: ManagerJobRecord,
  agents: readonly ManagerAgentRecord[],
  assignedAgentIds: ReadonlySet<string>,
  now: string,
  staleAfterMs?: number,
): ManagerAgentRecord | null {
  const nowMs = Date.parse(now);
  const candidates = agents
    .filter((agent) => agentEligibleForProject(agent, job.projectId))
    .filter((agent) => agentHasCapabilities(agent, job.requiredCapabilities))
    .filter((agent) => agentHasCapacity(agent, nowMs, staleAfterMs))
    .filter((agent) => !assignedAgentIds.has(agent.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/**
 * Deterministic assignment: priority, FIFO sequence, stable job id; agents sorted by id.
 * Jobs are considered in round-robin project order when projectCursor is supplied.
 */
export function runSchedulerTick(
  jobs: readonly ManagerJobRecord[],
  agents: readonly ManagerAgentRecord[],
  existingAssignments: readonly ManagerAssignmentRecord[],
  options: SchedulerOptions,
): SchedulerTickResult {
  const activeByJob = new Set(
    existingAssignments.filter((a) => a.state === "active").map((a) => a.jobId),
  );
  const activeByAgent = new Set(
    existingAssignments.filter((a) => a.state === "active").map((a) => a.agentId),
  );

  const ready = listReadyJobs(jobs).filter((job) => !activeByJob.has(job.id));
  const projectOrder: ProjectId[] = [
    "medimori",
    "twilight-feather",
    "real-estate-analyzer",
    "on-the-way",
    "ai-trainer-fitness",
  ];
  const cursor = options.projectCursor ?? 0;
  const rotated = [...projectOrder.slice(cursor), ...projectOrder.slice(0, cursor)];

  const ordered: ManagerJobRecord[] = [];
  const byProject = new Map<ProjectId, ManagerJobRecord[]>();
  for (const job of ready) {
    const list = byProject.get(job.projectId) ?? [];
    list.push(job);
    byProject.set(job.projectId, list);
  }
  for (const projectId of rotated) {
    const list = (byProject.get(projectId) ?? []).sort(compareJobs);
    ordered.push(...list);
  }

  const assignments: ManagerAssignmentRecord[] = [];
  const updatedJobs: ManagerJobRecord[] = [];
  const assignedAgents = new Set(activeByAgent);

  for (const job of ordered) {
    if (jobRequiresLiveOwnerApproval(job, options.now)) {
      continue;
    }
    if (budgetBlockReason(job.budget, job.usage)) {
      continue;
    }
    const agent = selectAgentForJob(job, agents, assignedAgents, options.now, options.staleAfterMs);
    if (!agent) continue;

    const assignmentId = `asgn-${job.id}-${job.attemptCount + 1}`;
    if (existingAssignments.some((a) => a.id === assignmentId)) {
      throw new SupervisorContractError("Duplicate assignment id would be issued.");
    }
    const assignedJob = transitionManagerJob(job, "assigned", {
      now: options.now,
      assignmentId,
      idempotent: false,
    });
    const fenceToken = (job.activeLeaseFence ?? 0) + 1;
    const runningJob = transitionManagerJob(
      { ...assignedJob, activeLeaseFence: fenceToken },
      "running",
      {
        now: options.now,
        assignmentId,
        idempotent: false,
      },
    );
    const record = createAssignmentRecord({
      id: assignmentId,
      job: runningJob,
      agentId: agent.id,
      now: options.now,
      leaseMs: options.leaseMs,
      dispatchAttempt: runningJob.attemptCount + 1,
      fenceToken,
      externalRefs: runningJob.externalRefs,
    });
    assignments.push(record);
    updatedJobs.push(runningJob);
    assignedAgents.add(agent.id);
  }

  return { assignments, updatedJobs };
}
