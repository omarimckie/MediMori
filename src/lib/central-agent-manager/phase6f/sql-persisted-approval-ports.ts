import type { PostgresqlTransactionalClient } from "../orchestration/postgresql-sql-client";
import type {
  ApprovalAuthorityPersistencePort,
  ApprovalExecutorPersistencePort,
} from "../adapter/approval-persistence-port";
import {
  createMemoryApprovalStore,
  type MemoryApprovalSnapshot,
} from "../supervisor/trusted-approval";

const SNAPSHOT_ID = "cam-approval-v1";
const SCHEMA = "central_agent_manager";

async function loadSnapshot(client: PostgresqlTransactionalClient): Promise<MemoryApprovalSnapshot | null> {
  const result = await client.query(
    `SELECT snapshot_json FROM ${SCHEMA}.approval_persistence_snapshot WHERE id = $1`,
    [SNAPSHOT_ID],
  );
  if (result.rows.length === 0) return null;
  return JSON.parse(String(result.rows[0].snapshot_json)) as MemoryApprovalSnapshot;
}

async function saveSnapshot(client: PostgresqlTransactionalClient, body: MemoryApprovalSnapshot): Promise<void> {
  await client.query(
    `INSERT INTO ${SCHEMA}.approval_persistence_snapshot (id, snapshot_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, updated_at = NOW()`,
    [SNAPSHOT_ID, JSON.stringify(body)],
  );
}

export function createSqlPersistedApprovalPorts(client: PostgresqlTransactionalClient): {
  authority: ApprovalAuthorityPersistencePort;
  executor: ApprovalExecutorPersistencePort;
} {
  const memory = createMemoryApprovalStore();

  async function withSqlPersistence<T>(work: () => Promise<T>): Promise<T> {
    return client.withTransaction(async () => {
      const snap = await loadSnapshot(client);
      if (snap) await memory.importSnapshot(snap);
      const outcome = await work();
      const exported = await memory.exportSnapshot();
      await saveSnapshot(client, exported);
      return outcome;
    });
  }

  const authority: ApprovalAuthorityPersistencePort = {
    readTask: (taskId) => withSqlPersistence(() => memory.readTask(taskId)),
    saveTask: (task) => withSqlPersistence(() => memory.saveTask(task)),
    commitApproval: (attempt) => withSqlPersistence(() => memory.commitApproval(attempt)),
    readApproval: (id) => withSqlPersistence(() => memory.readApproval(id)),
    revokeApproval: (id, now) => withSqlPersistence(() => memory.revokeApproval(id, now)),
  };

  const executor: ApprovalExecutorPersistencePort = {
    readTask: (taskId) => withSqlPersistence(() => memory.readTask(taskId)),
    readApproval: (id) => withSqlPersistence(() => memory.readApproval(id)),
    markTaskRunning: (attempt) => withSqlPersistence(() => memory.markTaskRunning(attempt)),
  };

  return { authority, executor };
}
