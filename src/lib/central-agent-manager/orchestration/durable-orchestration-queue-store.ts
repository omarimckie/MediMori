import { SupervisorContractError } from "../supervisor/types";
import {
  applyPlannedAssignmentClaim,
  heartbeatAssignmentSync,
  planNextAssignmentClaim,
} from "./agent-consumer-operations";
import { serializeManagerJob, type ManagerAssignmentRecord } from "./contracts-v1";
import { completeAssignmentSuccess } from "./assignment-lifecycle";
import { isDurableSchedulerClaimsEnabled } from "./flags";
import { loadOrchestrationStateFromSql } from "./load-orchestration-persistence";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import type { OrchestrationQueuePort } from "./orchestration-queue-port";
import type { OrchestrationSqlPort } from "./orchestration-sql-port";
import {
  claimReadyJobDurably,
  persistAmbiguousOutcomeMutation,
  persistAgentsFromMemory,
  persistDependencyReadinessMutations,
  persistJobsFromMemory,
  persistOwnerWritableJobOrReject,
  persistRecoverFromCrashMutations,
  persistReconcileLeaseMutations,
  persistSchedulerTickMutations,
  snapshotActiveAssignments,
  snapshotJobFingerprints,
} from "./durable-orchestration-persistence";

export { claimReadyJobDurably } from "./durable-orchestration-persistence";

export type DurableOrchestrationQueueStore = OrchestrationQueuePort & {
  quarantinedCount(): number;
  reloadFromSql(): Promise<void>;
  getMemoryStore(): MemoryOrchestrationQueueStore;
  persistMutations(): Promise<void>;
  claimNextAssignmentForAgent(
    agentId: string,
    now: string,
    options?: { jobId?: string; leaseMs?: number; staleAfterMs?: number },
  ): Promise<ManagerAssignmentRecord | null>;
  heartbeatAssignmentForAgent(
    agentId: string,
    assignmentId: string,
    fenceToken: number,
    now: string,
    progress?: { diagnostic?: string | null; artifactRef?: string | null },
  ): Promise<ManagerAssignmentRecord>;
  persistAssignmentJobMutation(
    assignmentId: string,
    fenceToken: number,
    allowedAssignmentStates?: readonly string[],
  ): Promise<void>;
};

export async function createDurableOrchestrationQueueStore(
  sql: OrchestrationSqlPort,
): Promise<DurableOrchestrationQueueStore> {
  const loaded = await loadOrchestrationStateFromSql(sql);
  let memory = loaded.store;
  let quarantinedCount = loaded.quarantined.length;

  async function reloadMemoryFromSql(): Promise<void> {
    const reloaded = await loadOrchestrationStateFromSql(sql);
    memory = reloaded.store;
    quarantinedCount = reloaded.quarantined.length;
  }

  const api: DurableOrchestrationQueueStore = {
    quarantinedCount: () => quarantinedCount,
    reloadFromSql: reloadMemoryFromSql,
    getMemoryStore: () => memory,
    persistMutations: async () => {
      await persistJobsFromMemory(sql, memory);
      await persistAgentsFromMemory(sql, memory);
    },
    listJobs: () => memory.listJobs(),
    getJob: (id) => memory.getJob(id),
    listAssignments: () => memory.listAssignments(),
    listAgents: () => memory.listAgents(),
    enqueueJob: async (input) => {
      const job = await memory.enqueueJob(input);
      await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: job.updatedAt });
      return job;
    },
    cancelJob: async (jobId, now) => {
      await reloadMemoryFromSql();
      const job = await memory.cancelJob(jobId, now);
      await persistOwnerWritableJobOrReject(sql, job, "cancelJob");
      return job;
    },
    bindApproval: async (jobId, binding, now) => {
      await reloadMemoryFromSql();
      const job = await memory.bindApproval(jobId, binding, now);
      await persistOwnerWritableJobOrReject(sql, job, "bindApproval");
      return job;
    },
    registerAgent: async (agent) => {
      await memory.registerAgent(agent);
      await sql.upsertAgent({
        id: agent.id,
        payload_json: JSON.stringify(agent),
        updated_at: agent.lastObservedAt ?? new Date(0).toISOString(),
      });
    },
    observeAgentStatus: async (agentId, status, observedAt) => {
      await memory.observeAgentStatus(agentId, status, observedAt);
      const agent = memory.listAgentsSync().find((row) => row.id === agentId);
      if (agent) {
        await sql.upsertAgent({
          id: agent.id,
          payload_json: JSON.stringify(agent),
          updated_at: agent.lastObservedAt ?? observedAt,
        });
      }
    },
    refreshDependencyReadiness: async (now) => {
      await reloadMemoryFromSql();
      const beforeJobs = snapshotJobFingerprints(memory);
      await memory.refreshDependencyReadiness(now);
      await persistDependencyReadinessMutations(sql, memory, beforeJobs);
    },
    reconcileLeases: async (now) => {
      await reloadMemoryFromSql();
      const beforeActive = snapshotActiveAssignments(memory);
      await memory.reconcileLeases(now);
      await persistReconcileLeaseMutations(sql, memory, beforeActive);
    },
    runScheduler: async (now) => {
      await reloadMemoryFromSql();
      const tick = memory.planSchedulerTick(now);
      await persistSchedulerTickMutations(sql, memory, tick, isDurableSchedulerClaimsEnabled());
    },
    reportAmbiguousOutcome: async (assignmentId, now, reason) => {
      await reloadMemoryFromSql();
      const assignment = memory.listAssignmentsSync().find((row) => row.id === assignmentId);
      if (!assignment) {
        await memory.reportAmbiguousOutcome(assignmentId, now, reason);
        await persistJobsFromMemory(sql, memory);
        return;
      }
      const fenceToken = assignment.lease.fenceToken;
      await memory.reportAmbiguousOutcome(assignmentId, now, reason);
      await persistAmbiguousOutcomeMutation(sql, memory, assignmentId, fenceToken);
    },
    completeAssignment: async (assignmentId, now, evidenceIds) => {
      await reloadMemoryFromSql();
      const assignment = memory.listAssignmentsSync().find((row) => row.id === assignmentId);
      if (!assignment) {
        await memory.completeAssignment(assignmentId, now, evidenceIds);
        await persistJobsFromMemory(sql, memory);
        return;
      }
      if (assignment.state === "completed") return;
      const job = memory.getJobSync(assignment.jobId);
      if (!job) {
        await memory.completeAssignment(assignmentId, now, evidenceIds);
        await persistJobsFromMemory(sql, memory);
        return;
      }
      const fenceToken = assignment.lease.fenceToken;
      const preview = completeAssignmentSuccess(assignment, job, now, evidenceIds);
      const outcome = await sql.completeAssignmentIdempotent({
        assignmentId,
        assignmentJson: JSON.stringify(preview.assignment),
        jobId: preview.job.id,
        jobJson: serializeManagerJob(preview.job),
        fenceToken,
        now,
      });
      if (outcome === "rejected") {
        await reloadMemoryFromSql();
        throw new Error("Assignment completion rejected by durable store fence validation.");
      }
      if (outcome === "already_completed") {
        await reloadMemoryFromSql();
        return;
      }
      memory.completeAssignmentSync(assignmentId, now, evidenceIds);
    },
    failAssignmentOutcome: async (assignmentId, now, reason) => {
      await reloadMemoryFromSql();
      const before = memory.listAssignmentsSync().find((row) => row.id === assignmentId);
      if (!before) {
        await memory.failAssignmentOutcome(assignmentId, now, reason);
        await persistJobsFromMemory(sql, memory);
        return;
      }
      const fenceToken = before.lease.fenceToken;
      await memory.failAssignmentOutcome(assignmentId, now, reason);
      const assignment = memory.listAssignmentsSync().find((row) => row.id === assignmentId);
      const job = assignment ? memory.getJobSync(assignment.jobId) : null;
      if (!assignment || !job) {
        await persistJobsFromMemory(sql, memory);
        return;
      }
      const persisted = await sql.updateAssignmentWithJobIfFence({
        assignmentId,
        assignmentJson: JSON.stringify(assignment),
        fenceToken,
        jobId: job.id,
        jobJson: serializeManagerJob(job),
        now,
        allowedAssignmentStates: ["active"],
      });
      if (!persisted) {
        await reloadMemoryFromSql();
        throw new Error("Assignment failure rejected by durable store fence validation.");
      }
      const agent = memory.listAgentsSync().find((row) => row.id === assignment.agentId);
      if (agent) {
        await sql.upsertAgent({
          id: agent.id,
          payload_json: JSON.stringify(agent),
          updated_at: agent.lastObservedAt ?? now,
        });
      }
    },
    recoverFromCrash: async (now) => {
      await reloadMemoryFromSql();
      const beforeAssignments = new Map(memory.listAssignmentsSync().map((row) => [row.id, row]));
      const beforeJobs = snapshotJobFingerprints(memory);
      const report = memory.recoverFromCrashSync(now);
      await persistRecoverFromCrashMutations(sql, memory, beforeAssignments, beforeJobs);
      return report;
    },
    claimNextAssignmentForAgent: async (agentId, now, options) => {
      const maxRounds = 8;
      for (let round = 0; round < maxRounds; round += 1) {
        await reloadMemoryFromSql();
        memory.reconcileLeasesSync(now);
        memory.refreshDependencyReadinessSync(now);
        const plan = planNextAssignmentClaim(memory, agentId, now, options);
        if (!plan) return null;
        const held = memory
          .listAssignmentsSync()
          .find((row) => row.id === plan.record.id && row.state === "active");
        if (held) return held;
        const claimed = await claimReadyJobDurably(sql, memory, {
          job: plan.runningJob,
          assignment: plan.record,
          now,
        });
        if (!claimed) continue;
        applyPlannedAssignmentClaim(memory, agentId, plan);
        const agent = memory.listAgentsSync().find((row) => row.id === agentId);
        if (agent) {
          await sql.upsertAgent({
            id: agent.id,
            payload_json: JSON.stringify(agent),
            updated_at: agent.lastObservedAt ?? now,
          });
        }
        return plan.record;
      }
      return null;
    },
    heartbeatAssignmentForAgent: async (agentId, assignmentId, fenceToken, now, progress) => {
      await reloadMemoryFromSql();
      const assignment = heartbeatAssignmentSync(
        memory,
        agentId,
        assignmentId,
        fenceToken,
        now,
        progress,
      );
      const renewed = await sql.renewAssignmentLease({
        assignmentId,
        assignmentJson: JSON.stringify(assignment),
        fenceToken,
        now,
      });
      if (!renewed) {
        await reloadMemoryFromSql();
        throw new SupervisorContractError("Assignment lease fence token is stale.");
      }
      return assignment;
    },
    persistAssignmentJobMutation: async (assignmentId, fenceToken, allowedAssignmentStates) => {
      const assignment = memory.listAssignmentsSync().find((row) => row.id === assignmentId);
      if (!assignment) throw new SupervisorContractError("Unknown assignment.");
      const job = memory.getJobSync(assignment.jobId);
      if (!job) throw new SupervisorContractError("Unknown job.");
      const persisted = await sql.updateAssignmentWithJobIfFence({
        assignmentId,
        assignmentJson: JSON.stringify(assignment),
        fenceToken,
        jobId: job.id,
        jobJson: serializeManagerJob(job),
        now: assignment.updatedAt,
        allowedAssignmentStates,
      });
      if (!persisted) {
        await reloadMemoryFromSql();
        throw new SupervisorContractError("Assignment lease fence token is stale.");
      }
    },
  };

  return api;
}
