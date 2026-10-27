import type { OrchestrationSqlPort, OrchestrationSqlQuarantineRow, OrchestrationSqlRow } from "./orchestration-sql-port";

export function createInMemoryOrchestrationSqlPort(): OrchestrationSqlPort & {
  tables: {
    jobs: Map<string, OrchestrationSqlRow>;
    assignments: Map<string, OrchestrationSqlRow & { job_id: string }>;
    agents: Map<string, OrchestrationSqlRow>;
    quarantine: Map<string, OrchestrationSqlQuarantineRow>;
  };
} {
  const jobs = new Map<string, OrchestrationSqlRow>();
  const assignments = new Map<string, OrchestrationSqlRow & { job_id: string }>();
  const agents = new Map<string, OrchestrationSqlRow>();
  const quarantine = new Map<string, OrchestrationSqlQuarantineRow>();
  let transactionChain = Promise.resolve();

  const port: OrchestrationSqlPort = {
    withTransaction(work) {
      const run = transactionChain.then(() => work(port));
      transactionChain = run.then(() => undefined).catch(() => undefined);
      return run;
    },
    loadJobs: async () => [...jobs.values()],
    loadAssignments: async () => [...assignments.values()],
    loadAgents: async () => [...agents.values()],
    loadQuarantined: async () => [...quarantine.values()],
    upsertJob: async (row) => {
      jobs.set(row.id, row);
    },
    upsertJobIfOwnerWritable: async (row) => {
      const existing = jobs.get(row.id);
      if (!existing) {
        jobs.set(row.id, row);
        return true;
      }
      const state = (JSON.parse(existing.payload_json) as { state?: string }).state;
      if (state === "running" || state === "assigned") return false;
      for (const assignment of assignments.values()) {
        if (assignment.job_id !== row.id) continue;
        const assignmentState = (JSON.parse(assignment.payload_json) as { state?: string }).state;
        if (assignmentState === "active") return false;
      }
      jobs.set(row.id, row);
      return true;
    },
    upsertAssignment: async (row) => {
      const jobId =
        row.job_id ?? (JSON.parse(row.payload_json) as { jobId: string }).jobId;
      assignments.set(row.id, { ...row, job_id: jobId });
    },
    upsertAgent: async (row) => {
      agents.set(row.id, row);
    },
    deleteJob: async (id) => {
      jobs.delete(id);
    },
    quarantineRecord: async (row) => {
      const existing = quarantine.get(row.id);
      if (
        existing &&
        existing.reason === row.reason &&
        existing.payload_json === row.payload_json &&
        existing.source_table === row.source_table
      ) {
        return;
      }
      quarantine.set(row.id, row);
    },
    tryClaimReadyJob: async (input) =>
      port.withTransaction(async () => {
        const job = jobs.get(input.jobId);
        if (!job) return false;
        const state = (JSON.parse(job.payload_json) as { state: string }).state;
        if (state !== "ready") return false;
        for (const assignment of assignments.values()) {
          if (assignment.job_id !== input.jobId) continue;
          const payload = JSON.parse(assignment.payload_json) as { state: string };
          if (payload.state === "active") return false;
        }
        jobs.set(input.jobId, { id: input.jobId, payload_json: input.jobJson, updated_at: input.now });
        assignments.set(input.assignmentId, {
          id: input.assignmentId,
          job_id: input.assignmentJobId,
          payload_json: input.assignmentJson,
          updated_at: input.now,
        });
        return true;
      }),
    renewAssignmentLease: async (input) =>
      port.withTransaction(async () => {
        const row = assignments.get(input.assignmentId);
        if (!row) return false;
        const parsed = JSON.parse(row.payload_json) as {
          state: string;
          lease: { fenceToken: number };
        };
        if (parsed.state !== "active" || parsed.lease.fenceToken !== input.fenceToken) return false;
        assignments.set(input.assignmentId, {
          ...row,
          payload_json: input.assignmentJson,
          updated_at: input.now,
        });
        return true;
      }),
    updateAssignmentWithJobIfFence: async (input) =>
      port.withTransaction(async () => {
        const row = assignments.get(input.assignmentId);
        if (!row) return false;
        const parsed = JSON.parse(row.payload_json) as {
          state: string;
          lease?: { fenceToken?: number };
        };
        if (parsed.lease?.fenceToken !== input.fenceToken) return false;
        if (
          input.allowedAssignmentStates?.length &&
          !input.allowedAssignmentStates.includes(parsed.state)
        ) {
          return false;
        }
        assignments.set(input.assignmentId, {
          ...row,
          payload_json: input.assignmentJson,
          updated_at: input.now,
        });
        jobs.set(input.jobId, { id: input.jobId, payload_json: input.jobJson, updated_at: input.now });
        return true;
      }),
    completeAssignmentIdempotent: async (input) =>
      port.withTransaction(async () => {
        const row = assignments.get(input.assignmentId);
        if (!row) return "rejected";
        const parsed = JSON.parse(row.payload_json) as {
          state: string;
          lease: { fenceToken: number };
        };
        if (parsed.state === "completed") return "already_completed";
        if (parsed.state !== "active" || parsed.lease.fenceToken !== input.fenceToken) return "rejected";
        assignments.set(input.assignmentId, {
          ...row,
          payload_json: input.assignmentJson,
          updated_at: input.now,
        });
        jobs.set(input.jobId, { id: input.jobId, payload_json: input.jobJson, updated_at: input.now });
        return "completed";
      }),
  };

  return { ...port, tables: { jobs, assignments, agents, quarantine } };
}
