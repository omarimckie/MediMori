export type ObjectiveSqlRow = {
  objective_id: string;
  idempotency_key: string;
  record_fence: number;
  document_json: string;
  checksum: string;
  updated_at: string;
};

export type ObjectiveOutboxSqlRow = {
  id: string;
  objective_id: string;
  kind: "enqueue_job" | "objective_snapshot";
  payload_json: string;
  status: "pending" | "applied";
  created_at: string;
};

export type ObjectiveSqlPort = {
  withTransaction<T>(work: (port: ObjectiveSqlPort) => Promise<T>): Promise<T>;
  loadObjectives(): Promise<ObjectiveSqlRow[]>;
  loadOutbox(objectiveId?: string): Promise<ObjectiveOutboxSqlRow[]>;
  upsertObjective(input: { row: ObjectiveSqlRow; expectedFence: number | null }): Promise<boolean>;
  insertOutbox(row: ObjectiveOutboxSqlRow): Promise<void>;
  markOutboxApplied(id: string): Promise<void>;
};
