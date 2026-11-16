/**
 * Authorized Phase 3 staging persistence matrix (Neon small-frost-27394379).
 * Same server modules as Preview routes. Does not log secrets.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

const STAGING = "small-frost-27394379";
const BRANCH = "integration/twilight-feather-add-to-planner";

function armEnv(readonly: boolean, e2e: boolean) {
  process.env.MARKETING_STORE = "postgres";
  process.env.MARKETING_MOCK_MODE = "true";
  process.env.MARKETING_STAGING_NEON_PROJECT_ID = STAGING;
  process.env.MARKETING_PLANNER_STAGING_E2E = e2e ? "true" : "false";
  process.env.MARKETING_PREVIEW_READONLY = readonly ? "true" : "false";
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = BRANCH;
}

type Row = { name: string; pass: "PASS" | "FAIL"; detail?: string };

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL missing (vercel env pull required).");
  }
  const startedAt = new Date().toISOString();
  const results: Row[] = [];
  let step = "init";
  const pass = (name: string, ok: boolean, detail = "") => {
    results.push({ name, pass: ok ? "PASS" : "FAIL", detail });
    assert.ok(ok, `${name}: ${detail}`);
  };

  armEnv(false, true);
  step = "armed_env";

  const { getMarketingStore } = await import("../src/lib/marketing/context");
  const { createPlannerE2eStagingFixtures } = await import("../src/lib/marketing/planner-e2e-fixtures");
  const { cleanupPlannerE2eStagingFixtures } = await import("../src/lib/marketing/planner-e2e-cleanup");
  const {
    addContentToPlanner,
    removeContentFromPlanner,
    listPlannerQueue,
  } = await import("../src/lib/marketing/content-planner-queue");
  const { assignContentToWeeklyPlan } = await import("../src/lib/marketing/content-assign-week");
  const { cleanupPlannerE2eStagingFixtures: cleanupOrphans } = await import(
    "../src/lib/marketing/planner-e2e-cleanup"
  );
  const { getSql } = await import("../src/lib/db");
  const { evaluatePlannerStagingE2eHttpMutation } = await import(
    "../src/lib/marketing/planner-staging-e2e-gate"
  );

  const sql = getSql();
  const baselineRows = await sql`
    SELECT
      (SELECT count(*)::int FROM marketing_content) AS marketing_content,
      (SELECT count(*)::int FROM marketing_publications) AS marketing_publications,
      (SELECT count(*)::int FROM marketing_weekly_plans) AS marketing_weekly_plans,
      (SELECT count(*)::int FROM marketing_campaigns) AS marketing_campaigns,
      (SELECT count(*)::int FROM marketing_assets) AS marketing_assets
  `;
  const baseline = baselineRows[0] as Record<string, number>;
  pass("baseline_recorded", true, JSON.stringify(baseline));

  const orphanTagged = (baseline.marketing_content ?? 0) > 0;
  if (orphanTagged) {
    await cleanupOrphans(getMarketingStore(), {});
    const afterOrphan = await sql`SELECT count(*)::int AS n FROM marketing_content`;
    pass("orphan_cleanup", (afterOrphan[0] as { n: number }).n === 0, `n=${(afterOrphan[0] as { n: number }).n}`);
  }

  const neon = await sql`SELECT current_setting('neon.project_id', true) AS pid`;
  pass("neon_project", (neon[0] as { pid: string }).pid === STAGING, String((neon[0] as { pid: string }).pid));

  pass(
    "gate_allow_planner",
    evaluatePlannerStagingE2eHttpMutation(
      "/api/admin/marketing/content/add-to-planner",
      "POST",
    ) === "allow",
  );
  pass(
    "gate_deny_seed",
    evaluatePlannerStagingE2eHttpMutation("/api/admin/marketing/seed", "POST") === "deny_allowlist",
  );

  const fixtures = await createPlannerE2eStagingFixtures(getMarketingStore());
  pass("fixtures_batch", Boolean(fixtures.batchId), fixtures.batchId);

  for (const [role, id] of Object.entries(fixtures.contentIds)) {
    const row = await getMarketingStore().getContent(id);
    pass(`server_tag_${role}`, row?.metadata?.e2eTag === "PLANNER_E2E_STAGING", id);
  }

  const store = getMarketingStore();
  const { instagram: ig, facebook: fb, legacy } = fixtures.contentIds;

  const added = await addContentToPlanner(store, { contentIds: [ig, fb, legacy] });
  pass("queue_ig_fb_legacy", added.queued.length >= 3, `queued=${added.queued.length}`);

  const queue = await listPlannerQueue(store, { limit: 50, offset: 0 });
  pass("queue_list_ig", queue.content.some((c) => c.id === ig), `total=${queue.total}`);
  pass("no_auto_week_ig", (await store.getContent(ig))?.weeklyPlanId == null);

  const pubCount = (await store.listPublications()).length;
  pass("no_extra_publications", pubCount === 2, `publications=${pubCount}`);

  const dup = await addContentToPlanner(store, { contentIds: [ig] });
  pass("add_idempotent", dup.alreadyQueued.length >= 1);

  const removed = await removeContentFromPlanner(store, { contentIds: [fb] });
  pass("remove_fb", removed.removed.length === 1);

  await assignContentToWeeklyPlan(store, {
    contentIds: [ig],
    weeklyPlanId: fixtures.weeklyPlanId,
  });
  pass("assign_week", (await store.getContent(ig))?.weeklyPlanId === fixtures.weeklyPlanId);

  const scheduled = await store.getContent(fixtures.contentIds.scheduledControl);
  const published = await store.getContent(fixtures.contentIds.publishedControl);
  pass("scheduled_control_stable", scheduled?.scheduledFor != null);
  pass("published_control_stable", published?.status === "published");

  let rejectedMissing = false;
  try {
    await addContentToPlanner(store, { contentIds: [crypto.randomUUID()] });
  } catch {
    rejectedMissing = true;
  }
  pass("missing_id_rejected", rejectedMissing);

  const cleanup1 = await cleanupPlannerE2eStagingFixtures(store, { batchId: fixtures.batchId });
  pass("cleanup_removed_7", cleanup1.deletedContentIds.length === 7);

  const cleanup2 = await cleanupPlannerE2eStagingFixtures(store, { batchId: fixtures.batchId });
  pass("cleanup_idempotent", cleanup2.deletedContentIds.length === 0);

  const afterRows = await sql`
    SELECT
      (SELECT count(*)::int FROM marketing_content) AS marketing_content,
      (SELECT count(*)::int FROM marketing_publications) AS marketing_publications
  `;
  const after = afterRows[0] as Record<string, number>;
  pass(
    "counts_match_baseline",
    Number(after.marketing_content) === Number(baseline.marketing_content) &&
      Number(after.marketing_publications) === Number(baseline.marketing_publications),
    JSON.stringify(after),
  );

  const outPath = path.join(ROOT, ".local", "planner-phase3-persistence-e2e.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), batchId: fixtures.batchId, baseline, after, results }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, pass: results.length, batchId: fixtures.batchId, outPath }));
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.message}` : String(error));
  process.exitCode = 1;
});