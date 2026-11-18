import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  connectPreviewAwarePoolClient,
  createPreviewGuardedSql,
  guardPoolForProtectedPreview,
  previewDatabaseGuardDecision,
  PreviewDatabaseGuardError,
  type GuardablePoolClient,
} from "@/lib/marketing/preview-db-guard";
import {
  connectPreviewFailClosedAwarePoolClient,
  createPreviewFailClosedGuardedSql,
  guardPoolForPreviewFailClosed,
} from "@/lib/marketing/preview-fail-closed-guard";
import {
  connectStagingPlannerAwarePoolClient,
  createStagingPlannerGuardedSql,
  guardPoolForStagingPlannerPreview,
  resolveConfiguredStagingNeonProjectId,
  stagingPlannerPreviewDatabaseGuardDecision,
  StagingPlannerDatabaseGuardError,
  STAGING_PLANNER_NEON_PROJECT_ALLOWLIST,
} from "@/lib/marketing/staging-planner-db-guard";

export type MarketingDatabaseGuardRoute =
  | "skip"
  | "production-ro"
  | "staging-writable"
  | "preview-fail-closed"
  | "reject";

export function resolveMarketingDatabaseGuardRoute(
  env: Record<string, string | undefined> = process.env,
): MarketingDatabaseGuardRoute {
  const stagingDecision = stagingPlannerPreviewDatabaseGuardDecision(env);
  if (stagingDecision === "reject") return "reject";
  if (stagingDecision === "guard") return "staging-writable";

  const productionDecision = previewDatabaseGuardDecision(env);
  if (productionDecision === "reject") return "reject";
  if (productionDecision === "guard") return "production-ro";
  if (env.VERCEL_ENV === "preview") return "preview-fail-closed";
  return "skip";
}

export function assertMarketingDatabaseGuardAllowsAccess(
  env: Record<string, string | undefined> = process.env,
): void {
  const route = resolveMarketingDatabaseGuardRoute(env);
  if (route === "reject") {
    const stagingDecision = stagingPlannerPreviewDatabaseGuardDecision(env);
    if (stagingDecision === "reject") {
      const configured = resolveConfiguredStagingNeonProjectId(env);
      if (configured === null) throw new StagingPlannerDatabaseGuardError("missing-config");
      if (configured === "invalid") throw new StagingPlannerDatabaseGuardError("invalid-config");
      throw new StagingPlannerDatabaseGuardError("ambiguous-scope");
    }
    throw new PreviewDatabaseGuardError("ambiguous-scope");
  }
}

export function createMarketingGuardedSql(
  raw: NeonQueryFunction<false, false>,
  _connectionString?: string,
): NeonQueryFunction<false, false> {
  const route = resolveMarketingDatabaseGuardRoute(process.env);
  if (route === "staging-writable") {
    const expectedProjectId = resolveConfiguredStagingNeonProjectId(process.env);
    if (!expectedProjectId || expectedProjectId === "invalid") {
      throw new StagingPlannerDatabaseGuardError("missing-config");
    }
    if (!(STAGING_PLANNER_NEON_PROJECT_ALLOWLIST as readonly string[]).includes(expectedProjectId)) {
      throw new StagingPlannerDatabaseGuardError("invalid-config");
    }
    return createStagingPlannerGuardedSql(raw, expectedProjectId);
  }
  if (route === "production-ro") {
    return createPreviewGuardedSql(raw);
  }
  if (route === "preview-fail-closed") {
    return createPreviewFailClosedGuardedSql(raw);
  }
  return raw;
}

export function getMarketingGuardedPool<T extends object>(rawPool: T): T {
  const route = resolveMarketingDatabaseGuardRoute(process.env);
  if (route === "reject") {
    assertMarketingDatabaseGuardAllowsAccess(process.env);
  }
  if (route === "staging-writable") return guardPoolForStagingPlannerPreview(rawPool);
  if (route === "production-ro") return guardPoolForProtectedPreview(rawPool);
  if (route === "preview-fail-closed") return guardPoolForPreviewFailClosed(rawPool);
  return rawPool;
}

export async function connectMarketingAwarePoolClient<T extends GuardablePoolClient>(pool: {
  connect: () => Promise<T>;
}): Promise<T> {
  const route = resolveMarketingDatabaseGuardRoute(process.env);
  if (route === "reject") {
    assertMarketingDatabaseGuardAllowsAccess(process.env);
    throw new PreviewDatabaseGuardError("ambiguous-scope");
  }
  if (route === "staging-writable") return connectStagingPlannerAwarePoolClient(pool);
  if (route === "production-ro") return connectPreviewAwarePoolClient(pool);
  if (route === "preview-fail-closed") return connectPreviewFailClosedAwarePoolClient(pool);
  return pool.connect();
}