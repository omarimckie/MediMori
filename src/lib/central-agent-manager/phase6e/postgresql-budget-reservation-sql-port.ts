import type { PostgresqlSqlClient, PostgresqlTransactionalClient } from "../orchestration/postgresql-sql-client";
import type { BudgetReservationRow, BudgetReservationSqlPort } from "../phase6d/objective-budget-reservation-sql";

const SCHEMA = "central_agent_manager";

function createBudgetPort(client: PostgresqlSqlClient): PostgresqlBudgetReservationSqlPort {
  return {
    withTransaction(work) {
      if ("withTransaction" in client && typeof (client as PostgresqlTransactionalClient).withTransaction === "function") {
        return (client as PostgresqlTransactionalClient).withTransaction((tx) => work(createBudgetPort(tx)));
      }
      return work(createBudgetPort(client));
    },
    listReservations: async (objectiveId) => {
      const result = await client.query(
        `SELECT reservation_id, objective_id, amount_usd::float8 AS amount_usd, status, created_at, updated_at
         FROM ${SCHEMA}.objective_budget_reservations WHERE objective_id = $1 ORDER BY created_at`,
        [objectiveId],
      );
      return result.rows.map((row) => ({
        reservation_id: String(row.reservation_id),
        objective_id: String(row.objective_id),
        amount_usd: Number(row.amount_usd),
        status: row.status as BudgetReservationRow["status"],
        created_at: new Date(String(row.created_at)).toISOString(),
        updated_at: new Date(String(row.updated_at)).toISOString(),
      }));
    },
    insertReservation: async (row) => {
      const result = await client.query(
        `INSERT INTO ${SCHEMA}.objective_budget_reservations
           (reservation_id, objective_id, amount_usd, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
         ON CONFLICT (reservation_id) DO NOTHING
         RETURNING reservation_id`,
        [row.reservation_id, row.objective_id, row.amount_usd, row.status, row.created_at, row.updated_at],
      );
      return result.rows.length > 0;
    },
    updateReservationStatus: async (reservationId, status, updatedAt) => {
      const result = await client.query(
        `UPDATE ${SCHEMA}.objective_budget_reservations
         SET status = $2, updated_at = $3::timestamptz
         WHERE reservation_id = $1
         RETURNING reservation_id`,
        [reservationId, status, updatedAt],
      );
      return result.rows.length > 0;
    },
    ensureBudgetCap: async (objectiveId: string, authorizedUsd: number) => {
      await client.query(
        `INSERT INTO ${SCHEMA}.objective_budget_caps (objective_id, authorized_usd, reserved_usd, consumed_usd, updated_at)
         VALUES ($1, $2, 0, 0, NOW())
         ON CONFLICT (objective_id) DO UPDATE
         SET authorized_usd = GREATEST(${SCHEMA}.objective_budget_caps.authorized_usd, EXCLUDED.authorized_usd),
             updated_at = NOW()`,
        [objectiveId, authorizedUsd],
      );
    },
    tryReserveWithCap: async (input: {
      objectiveId: string;
      reservationId: string;
      amountUsd: number;
      now: string;
    }) => {
      const locked = await client.query(
        `SELECT authorized_usd::float8 AS authorized_usd, reserved_usd::float8 AS reserved_usd, consumed_usd::float8 AS consumed_usd
         FROM ${SCHEMA}.objective_budget_caps WHERE objective_id = $1 FOR UPDATE`,
        [input.objectiveId],
      );
      if (locked.rows.length === 0) return false;
      const authorized = Number(locked.rows[0].authorized_usd);
      const reserved = Number(locked.rows[0].reserved_usd);
      const consumed = Number(locked.rows[0].consumed_usd);
      if (reserved + consumed + input.amountUsd > authorized) return false;
      const bump = await client.query(
        `UPDATE ${SCHEMA}.objective_budget_caps
         SET reserved_usd = reserved_usd + $2, updated_at = $3::timestamptz
         WHERE objective_id = $1 AND reserved_usd + consumed_usd + $2 <= authorized_usd
         RETURNING objective_id`,
        [input.objectiveId, input.amountUsd, input.now],
      );
      if (bump.rows.length === 0) return false;
      const inserted = await client.query(
        `INSERT INTO ${SCHEMA}.objective_budget_reservations
           (reservation_id, objective_id, amount_usd, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'reserved', $4::timestamptz, $4::timestamptz)
         ON CONFLICT (reservation_id) DO NOTHING
         RETURNING reservation_id`,
        [input.reservationId, input.objectiveId, input.amountUsd, input.now],
      );
      if (inserted.rows.length === 0) {
        await client.query(
          `UPDATE ${SCHEMA}.objective_budget_caps
           SET reserved_usd = reserved_usd - $2, updated_at = $3::timestamptz
           WHERE objective_id = $1`,
          [input.objectiveId, input.amountUsd, input.now],
        );
        return false;
      }
      return true;
    },
    applyReservationConsume: async (input) => {
      const consumedUsd = input.consumedMinor / 10_000;
      const reservedUsd = input.reservedMinor / 10_000;
      const updated = await client.query(
        `UPDATE ${SCHEMA}.objective_budget_reservations
         SET status = 'consumed', amount_usd = $2, updated_at = $3::timestamptz
         WHERE reservation_id = $1 AND status = 'reserved'
         RETURNING reservation_id`,
        [input.reservationId, consumedUsd, input.now],
      );
      if (updated.rows.length === 0) return false;
      await client.query(
        `UPDATE ${SCHEMA}.objective_budget_caps
         SET reserved_usd = GREATEST(0, reserved_usd - $2),
             consumed_usd = consumed_usd + $3,
             updated_at = $4::timestamptz
         WHERE objective_id = $1`,
        [input.objectiveId, reservedUsd, consumedUsd, input.now],
      );
      return true;
    },
    applyReservationRelease: async (input) => {
      const amountUsd = input.amountMinor / 10_000;
      const updated = await client.query(
        `UPDATE ${SCHEMA}.objective_budget_reservations
         SET status = 'released', updated_at = $2::timestamptz
         WHERE reservation_id = $1 AND status = 'reserved'
         RETURNING reservation_id`,
        [input.reservationId, input.now],
      );
      if (updated.rows.length === 0) return false;
      await client.query(
        `UPDATE ${SCHEMA}.objective_budget_caps
         SET reserved_usd = GREATEST(0, reserved_usd - $2), updated_at = $3::timestamptz
         WHERE objective_id = $1`,
        [input.objectiveId, amountUsd, input.now],
      );
      return true;
    },
  };
}

export type PostgresqlBudgetReservationSqlPort = BudgetReservationSqlPort & {
  ensureBudgetCap(objectiveId: string, authorizedUsd: number): Promise<void>;
  tryReserveWithCap(input: {
    objectiveId: string;
    reservationId: string;
    amountUsd: number;
    now: string;
  }): Promise<boolean>;
  applyReservationConsume(input: {
    objectiveId: string;
    reservationId: string;
    consumedMinor: number;
    reservedMinor: number;
    now: string;
  }): Promise<boolean>;
  applyReservationRelease(input: {
    objectiveId: string;
    reservationId: string;
    amountMinor: number;
    now: string;
  }): Promise<boolean>;
};

export function createPostgresqlBudgetReservationSqlPort(
  client: PostgresqlTransactionalClient,
): PostgresqlBudgetReservationSqlPort {
  return createBudgetPort(client);
}
