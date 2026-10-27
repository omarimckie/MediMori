import type { ObjectiveSqlPort } from "./objective-sql-port";
import type { ObjectiveExecutionStorePort } from "../phase6c/objective-persistence-port";

/**
 * Objective-first commit ordering: persist objective state before queue side effects when outbox is enabled.
 */
export async function coordinatedObjectiveBeforeQueue(input: {
  objectiveStore: ObjectiveExecutionStorePort;
  sqlPort?: ObjectiveSqlPort;
  objectiveId: string;
  now: string;
}): Promise<void> {
  await input.objectiveStore.flush();
  if (!input.sqlPort) return;
  await input.sqlPort.insertOutbox({
    id: `outbox-${input.objectiveId}-${Date.parse(input.now)}`,
    objective_id: input.objectiveId,
    kind: "objective_snapshot",
    payload_json: JSON.stringify({ objectiveId: input.objectiveId, at: input.now }),
    status: "pending",
    created_at: input.now,
  });
}
