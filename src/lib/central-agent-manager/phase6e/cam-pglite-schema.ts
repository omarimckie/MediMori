import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { applyOrchestrationSchemaToPglite, createPgliteTransactionalClient } from "../orchestration/pglite-orchestration-client";
import { createPostgresqlOrchestrationSqlPort } from "../orchestration/postgresql-orchestration-sql-port";
import { createPostgresqlObjectiveSqlPort } from "./postgresql-objective-sql-port";
import { createPostgresqlBudgetReservationSqlPort } from "./postgresql-budget-reservation-sql-port";
import type { ObjectiveSqlPort } from "../phase6d/objective-sql-port";
import type { OrchestrationSqlPort } from "../orchestration/orchestration-sql-port";
import type { PostgresqlBudgetReservationSqlPort } from "./postgresql-budget-reservation-sql-port";
import type { PostgresqlTransactionalClient } from "../orchestration/postgresql-sql-client";

const orchestrationSql = readFileSync(join(process.cwd(), "sql", "central-agent-manager-orchestration.sql"), "utf8");
const objectiveSql = readFileSync(join(process.cwd(), "sql", "cam-objective-executions.migration.sql"), "utf8");
const budgetSql = readFileSync(join(process.cwd(), "sql", "cam-objective-budget-reservations.migration.sql"), "utf8");
const approvalSql = readFileSync(join(process.cwd(), "sql", "cam-approval-pglite-snapshot.migration.sql"), "utf8");

export type CamPgliteBundle = {
  db: PGlite;
  client: PostgresqlTransactionalClient;
  orchestrationSql: OrchestrationSqlPort;
  objectiveSql: ObjectiveSqlPort;
  budgetSql: PostgresqlBudgetReservationSqlPort;
};

export async function createCamPgliteBundle(): Promise<CamPgliteBundle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await applyOrchestrationSchemaToPglite(db, orchestrationSql);
  await applyOrchestrationSchemaToPglite(db, objectiveSql);
  await applyOrchestrationSchemaToPglite(db, budgetSql);
  await applyOrchestrationSchemaToPglite(db, approvalSql);
  const client = createPgliteTransactionalClient(db);
  return {
    db,
    client,
    orchestrationSql: createPostgresqlOrchestrationSqlPort(client),
    objectiveSql: createPostgresqlObjectiveSqlPort(client),
    budgetSql: createPostgresqlBudgetReservationSqlPort(client),
  };
}
