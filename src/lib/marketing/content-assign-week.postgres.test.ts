import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresMarketingStore } from "./postgres-store";
import { assignContentToWeeklyPlan } from "./content-assign-week";

test(
  "postgres assignContentWeeklyPlan persists weekly_plan_id",
  { skip: !process.env.MARKETING_ASSIGN_WEEK_TEST_DATABASE_URL?.trim() },
  async () => {
    process.env.DATABASE_URL = process.env.MARKETING_ASSIGN_WEEK_TEST_DATABASE_URL!.trim();
    const store = new PostgresMarketingStore();
    const plans = await store.listWeeklyPlans();
    const plan = plans[0];
    assert.ok(plan, "needs at least one weekly plan in test database");
    const content = (await store.listContent()).find((row) => row.isDemo);
    assert.ok(content, "needs demo content row in test database");
    const originalPlan = content!.weeklyPlanId;
    try {
      await assignContentToWeeklyPlan(store, {
        contentIds: [content!.id],
        weeklyPlanId: plan!.id,
      });
      const loaded = await store.getContent(content!.id);
      assert.equal(loaded?.weeklyPlanId, plan!.id);
    } finally {
      if (originalPlan) {
        await store.assignContentWeeklyPlan(content!.id, originalPlan);
      }
    }
  },
);
