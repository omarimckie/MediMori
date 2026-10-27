import type { DurableOrchestrationQueueStore } from "../orchestration/durable-orchestration-queue-store";
import type { DurableObjectiveExecutionStore } from "../phase6c/durable-objective-execution-store";
import type { PostgresqlTransactionalClient } from "../orchestration/postgresql-sql-client";

/**
 * When objective and queue share one PostgreSQL database, flush objective rows then queue mutations
 * inside a single interactive transaction (not atomic with in-memory queue until persistMutations runs).
 */
export async function persistObjectiveThenQueue(
  client: PostgresqlTransactionalClient,
  input: {
    objectiveStore: DurableObjectiveExecutionStore;
    durableQueue: DurableOrchestrationQueueStore;
  },
): Promise<void> {
  await client.withTransaction(async () => {
    await input.objectiveStore.flush();
    await input.durableQueue.persistMutations();
  });
}
