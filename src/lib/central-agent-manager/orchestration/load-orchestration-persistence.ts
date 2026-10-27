import type { ManagerAgentRecord, ManagerAssignmentRecord, ManagerJobRecord } from "./contracts-v1";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import type { OrchestrationSqlPort } from "./orchestration-sql-port";
import {
  orchestrationQuarantineId,
  indexQuarantinedSourceKeys,
  quarantinedRecordKey,
} from "./quarantine-audit";
import {
  validateManagerAgentPayload,
  validateManagerAssignmentPayload,
  validateManagerJobPayload,
  type QuarantinedRecord,
} from "./record-validation";

export type OrchestrationLoadResult = {
  store: MemoryOrchestrationQueueStore;
  quarantined: QuarantinedRecord[];
};

async function recordQuarantineIfNeeded(
  sql: OrchestrationSqlPort,
  existingKeys: Set<string>,
  input: {
    sourceTable: "orchestration_jobs" | "orchestration_assignments" | "orchestration_agents";
    recordId: string;
    payloadJson: string;
    reason: string;
  },
): Promise<void> {
  const key = quarantinedRecordKey(input.sourceTable, input.recordId);
  if (existingKeys.has(key)) return;
  existingKeys.add(key);
  await sql.quarantineRecord({
    id: orchestrationQuarantineId(input.sourceTable, input.recordId),
    source_table: input.sourceTable,
    payload_json: input.payloadJson,
    reason: input.reason,
    quarantined_at: new Date().toISOString(),
  });
}

export async function loadOrchestrationStateFromSql(sql: OrchestrationSqlPort): Promise<OrchestrationLoadResult> {
  const store = new MemoryOrchestrationQueueStore();
  const quarantined: QuarantinedRecord[] = [];
  const existingQuarantineKeys = indexQuarantinedSourceKeys(await sql.loadQuarantined());

  for (const row of await sql.loadAgents()) {
    try {
      const agent = validateManagerAgentPayload(row.payload_json);
      store.registerAgentSync(agent);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Invalid agent payload.";
      quarantined.push({
        id: row.id,
        sourceTable: "orchestration_agents",
        payloadJson: row.payload_json,
        reason,
      });
      await recordQuarantineIfNeeded(sql, existingQuarantineKeys, {
        sourceTable: "orchestration_agents",
        recordId: row.id,
        payloadJson: row.payload_json,
        reason,
      });
    }
  }

  for (const row of await sql.loadJobs()) {
    try {
      const job = validateManagerJobPayload(row.payload_json);
      store.restoreJob(job);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Invalid job payload.";
      quarantined.push({
        id: row.id,
        sourceTable: "orchestration_jobs",
        payloadJson: row.payload_json,
        reason,
      });
      await recordQuarantineIfNeeded(sql, existingQuarantineKeys, {
        sourceTable: "orchestration_jobs",
        recordId: row.id,
        payloadJson: row.payload_json,
        reason,
      });
    }
  }

  for (const row of await sql.loadAssignments()) {
    try {
      const assignment = validateManagerAssignmentPayload(row.payload_json);
      const job = store.getJobSync(assignment.jobId);
      if (!job) {
        throw new Error("Assignment references a missing job.");
      }
      store.restoreAssignment(assignment);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Invalid assignment payload.";
      quarantined.push({
        id: row.id,
        sourceTable: "orchestration_assignments",
        payloadJson: row.payload_json,
        reason,
      });
      await recordQuarantineIfNeeded(sql, existingQuarantineKeys, {
        sourceTable: "orchestration_assignments",
        recordId: row.id,
        payloadJson: row.payload_json,
        reason,
      });
    }
  }

  store.finalizeOrchestrationLoadSync(new Date().toISOString());
  return { store, quarantined };
}

export function exportOrchestrationState(store: MemoryOrchestrationQueueStore): {
  jobs: ManagerJobRecord[];
  assignments: ManagerAssignmentRecord[];
  agents: ManagerAgentRecord[];
} {
  return {
    jobs: store.listJobsSync(),
    assignments: store.listAssignmentsSync(),
    agents: store.listAgentsSync(),
  };
}
