import type { ObjectiveOutboxSqlRow, ObjectiveSqlPort, ObjectiveSqlRow } from "./objective-sql-port";

export function createInMemoryObjectiveSqlPort(): ObjectiveSqlPort & {
  tables: { objectives: Map<string, ObjectiveSqlRow>; outbox: Map<string, ObjectiveOutboxSqlRow> };
} {
  const objectives = new Map<string, ObjectiveSqlRow>();
  const outbox = new Map<string, ObjectiveOutboxSqlRow>();
  let chain = Promise.resolve();

  const port: ObjectiveSqlPort = {
    withTransaction(work) {
      const run = chain.then(() => work(port));
      chain = run.then(() => undefined).catch(() => undefined);
      return run;
    },
    loadObjectives: async () => [...objectives.values()],
    loadOutbox: async (objectiveId) =>
      [...outbox.values()].filter((row) => !objectiveId || row.objective_id === objectiveId),
    upsertObjective: async ({ row, expectedFence }) =>
      port.withTransaction(async () => {
        const existing = objectives.get(row.objective_id);
        if (existing) {
          if (expectedFence === null || existing.record_fence !== expectedFence) {
            return false;
          }
        } else if (expectedFence !== null && expectedFence !== 0) {
          return false;
        }
        objectives.set(row.objective_id, row);
        return true;
      }),
    insertOutbox: async (row) => {
      outbox.set(row.id, row);
    },
    markOutboxApplied: async (id) => {
      const row = outbox.get(id);
      if (!row) return;
      outbox.set(id, { ...row, status: "applied" });
    },
  };

  return { ...port, tables: { objectives, outbox } };
}
