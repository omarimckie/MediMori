import assert from "node:assert/strict";
import test from "node:test";
import { createCamPgliteBundle } from "./cam-pglite-schema";

const NOW = "2026-10-27T10:05:00.000Z";

test("PGlite concurrent budget reservations cannot exceed authorized cap", async () => {
  const { budgetSql, client } = await createCamPgliteBundle();
  const objectiveId = "obj-budget-cap";
  await budgetSql.ensureBudgetCap(objectiveId, 1.0);

  const attempts = await Promise.all(
    [0, 1, 2].map((index) =>
      client.withTransaction(() =>
        budgetSql.tryReserveWithCap({
          objectiveId,
          reservationId: `res-${index}`,
          amountUsd: 0.4,
          now: NOW,
        }),
      ),
    ),
  );
  const successes = attempts.filter(Boolean).length;
  assert.equal(successes, 2);
  const rows = await budgetSql.listReservations(objectiveId);
  const reservedTotal = rows.filter((r) => r.status === "reserved").reduce((s, r) => s + r.amount_usd, 0);
  assert.ok(reservedTotal <= 1.0);
});
