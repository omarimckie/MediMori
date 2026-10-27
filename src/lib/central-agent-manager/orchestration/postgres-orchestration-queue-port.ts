import type { ManagerAgentRecord, ManagerJobRecord } from "./contracts-v1";
import { serializeManagerJob } from "./contracts-v1";
import { MemoryOrchestrationQueueStore, type EnqueueJobInput } from "./memory-queue-store";
import type { OrchestrationQueuePort } from "./orchestration-queue-port";
import type { OrchestrationSqlPort } from "./orchestration-sql-port";
import { persistOwnerWritableJobOrReject } from "./durable-orchestration-persistence";

const DEPRECATED_OWNER_MUTATION =
  "createPostgresOrchestrationQueuePort is not cross-writer safe for owner mutations; use createDurableOrchestrationQueueStore instead.";

function persistAgent(sql: OrchestrationSqlPort, agent: ManagerAgentRecord): Promise<void> {
  return sql.upsertAgent({
    id: agent.id,
    payload_json: JSON.stringify(agent),
    updated_at: agent.lastObservedAt ?? new Date(0).toISOString(),
  });
}

/**
 * @deprecated Thin SQL upsert wrapper for enqueue/load tests only.
 * Production and cross-writer flows must use `createDurableOrchestrationQueueStore`.
 */
export function createPostgresOrchestrationQueuePort(sql: OrchestrationSqlPort): OrchestrationQueuePort {
  const memory = new MemoryOrchestrationQueueStore();

  return {
    listJobs: () => memory.listJobs(),
    getJob: (id) => memory.getJob(id),
    listAssignments: () => memory.listAssignments(),
    listAgents: () => memory.listAgents(),
    enqueueJob: async (input: EnqueueJobInput) => {
      const job = await memory.enqueueJob(input);
      await sql.upsertJob({ id: job.id, payload_json: serializeManagerJob(job), updated_at: job.updatedAt });
      return job;
    },
    cancelJob: async (jobId, now) => {
      const job = await memory.cancelJob(jobId, now);
      await persistOwnerWritableJobOrReject(sql, job, "cancelJob");
      return job;
    },
    bindApproval: async (jobId, binding, now) => {
      const job = await memory.bindApproval(jobId, binding, now);
      await persistOwnerWritableJobOrReject(sql, job, "bindApproval");
      return job;
    },
    registerAgent: async (agent) => {
      await memory.registerAgent(agent);
      await persistAgent(sql, agent);
    },
    observeAgentStatus: async (agentId, status, observedAt) => {
      await memory.observeAgentStatus(agentId, status, observedAt);
      const agent = memory.listAgentsSync().find((row) => row.id === agentId);
      if (agent) await persistAgent(sql, agent);
    },
    refreshDependencyReadiness: async () => {
      throw new Error(DEPRECATED_OWNER_MUTATION);
    },
    reconcileLeases: async () => {
      throw new Error(DEPRECATED_OWNER_MUTATION);
    },
    runScheduler: async () => {
      throw new Error(DEPRECATED_OWNER_MUTATION);
    },
    reportAmbiguousOutcome: async () => {
      throw new Error(DEPRECATED_OWNER_MUTATION);
    },
    completeAssignment: async () => {
      throw new Error(DEPRECATED_OWNER_MUTATION);
    },
    failAssignmentOutcome: async () => {
      throw new Error(DEPRECATED_OWNER_MUTATION);
    },
    recoverFromCrash: async () => {
      throw new Error(DEPRECATED_OWNER_MUTATION);
    },
  };
}

export async function loadOrchestrationFromSql(
  sql: OrchestrationSqlPort,
): Promise<MemoryOrchestrationQueueStore> {
  const { loadOrchestrationStateFromSql } = await import("./load-orchestration-persistence");
  const loaded = await loadOrchestrationStateFromSql(sql);
  return loaded.store;
}
