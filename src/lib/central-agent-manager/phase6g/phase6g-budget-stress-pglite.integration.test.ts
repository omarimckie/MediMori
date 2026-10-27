import assert from "node:assert/strict";
import test from "node:test";
import { createCamPgliteBundle } from "../phase6e/cam-pglite-schema";

const NOW = "2026-10-27T17:30:00.000Z";

test("PGlite parallel reserves respect cap (two managers worth of attempts)", async () => {
  const bundle = await createCamPgliteBundle();
  const objectiveId = "obj-stress";
  await bundle.budgetSql.ensureBudgetCap(objectiveId, 0.5);
  const attempts = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      bundle.client.withTransaction(() =>
        bundle.budgetSql.tryReserveWithCap({
          objectiveId,
          reservationId: `dispatch:${objectiveId}:task-implement:${index + 1}`,
          amountUsd: 0.25,
          now: NOW,
        }),
      ),
    ),
  );
  const wins = attempts.filter(Boolean).length;
  assert.equal(wins, 2);
});

test("PGlite release after failed path frees cap for retry", async () => {
  const bundle = await createCamPgliteBundle();
  const objectiveId = "obj-release-retry";
  await bundle.budgetSql.ensureBudgetCap(objectiveId, 0.5);
  const resId = `dispatch:${objectiveId}:task-implement:1`;
  assert.equal(
    await bundle.budgetSql.tryReserveWithCap({
      objectiveId,
      reservationId: resId,
      amountUsd: 0.4,
      now: NOW,
    }),
    true,
  );
  await bundle.budgetSql.applyReservationRelease({
    objectiveId,
    reservationId: resId,
    amountMinor: 4000,
    now: NOW,
  });
  assert.equal(
    await bundle.budgetSql.tryReserveWithCap({
      objectiveId,
      reservationId: `${resId}-retry`,
      amountUsd: 0.4,
      now: NOW,
    }),
    true,
  );
});
