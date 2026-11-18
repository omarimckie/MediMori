/**
 * Narrow fail-closed write gate for integration-branch staging Preview E2E.
 * Does NOT bypass MARKETING_PREVIEW_READONLY; when readonly is on, all mutations stay blocked.
 */
import {
  isMarketingPreviewReadonly,
  isMarketingPreviewReadonlyMutationRequest,
  MARKETING_PREVIEW_READONLY_MESSAGE,
} from "@/lib/marketing/preview-readonly";
import {
  MARKETING_STAGING_NEON_PROJECT_ID_ENV,
  STAGING_PLANNER_NEON_PROJECT_ALLOWLIST,
  STAGING_PLANNER_PREVIEW_GUARD_REF,
  stagingPlannerPreviewDatabaseGuardDecision,
} from "@/lib/marketing/staging-planner-db-guard";
import type { MarketingContent } from "./types";
import type { MarketingStore } from "./store";

export const MARKETING_PLANNER_STAGING_E2E_ENV = "MARKETING_PLANNER_STAGING_E2E";
export const PLANNER_E2E_STAGING_TAG = "PLANNER_E2E_STAGING";

export const PLANNER_STAGING_E2E_SCOPE_MESSAGE =
  "Staging planner Preview requires the narrow E2E gate; marketing mutations are disabled.";

export const PLANNER_STAGING_E2E_ALLOWLIST_MESSAGE =
  "Only authorized Planner staging E2E mutations are permitted in this mode.";

export const PLANNER_STAGING_E2E_OWNERSHIP_MESSAGE =
  "Staging E2E mutations require server-validated test ownership (PLANNER_E2E_STAGING).";

export type EnvLike = Record<string, string | undefined>;

export type PlannerStagingE2eScopeDecision = "skip" | "scope" | "reject";

export type PlannerStagingE2eGateDecision =
  | "readonly"
  | "skip"
  | "scope_unarmed"
  | "allow"
  | "deny_allowlist";

function truthyFlag(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase();
  return trimmed === "1" || trimmed === "true" || trimmed === "yes";
}

/** Integration-branch staging-isolated Preview (staging Neon guard active). */
export function plannerStagingE2eScopeDecision(env: EnvLike = process.env): PlannerStagingE2eScopeDecision {
  if (env.VERCEL_ENV === "production") return "skip";
  const staging = stagingPlannerPreviewDatabaseGuardDecision(env);
  if (staging === "reject") return "reject";
  if (staging === "guard") return "scope";
  return "skip";
}

export function isPlannerStagingE2eScopeActive(env: EnvLike = process.env): boolean {
  return plannerStagingE2eScopeDecision(env) === "scope";
}

export function isPlannerStagingE2eArmed(env: EnvLike = process.env): boolean {
  if (!isPlannerStagingE2eScopeActive(env)) return false;
  if (!truthyFlag(env[MARKETING_PLANNER_STAGING_E2E_ENV])) return false;
  if (env.MARKETING_MOCK_MODE === "false") return false;
  const configured = env[MARKETING_STAGING_NEON_PROJECT_ID_ENV]?.trim();
  if (!configured) return false;
  if (!(STAGING_PLANNER_NEON_PROJECT_ALLOWLIST as readonly string[]).includes(configured)) {
    return false;
  }
  return true;
}

export function isPlannerStagingE2eStrictUnarmed(env: EnvLike = process.env): boolean {
  if (!isPlannerStagingE2eScopeActive(env)) return false;
  if (isMarketingPreviewReadonly(env)) return false;
  return !isPlannerStagingE2eArmed(env);
}

const EXACT_ALLOWLIST: ReadonlyArray<{ method: string; path: string }> = [
  { method: "POST", path: "/api/admin/marketing/content/add-to-planner" },
  { method: "POST", path: "/api/admin/marketing/content/remove-from-planner" },
  { method: "POST", path: "/api/admin/marketing/content/assign-week" },
  { method: "POST", path: "/api/admin/marketing/planner-e2e/fixtures" },
  { method: "POST", path: "/api/admin/marketing/planner-e2e/cleanup" },
];

/** Positive allowlist for armed E2E write window (readonly still blocks first). */
export function isPlannerStagingE2eAllowlistedMutation(pathname: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const path = pathname.split("?")[0] ?? pathname;

  for (const entry of EXACT_ALLOWLIST) {
    if (entry.method === normalizedMethod && entry.path === path) return true;
  }

  return false;
}

export class PlannerStagingE2eFixtureScopeError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "PlannerStagingE2eFixtureScopeError";
  }
}

/** Server-owned fixture/cleanup mutations (blocked when unarmed or readonly). */
export function assertPlannerStagingE2eFixtureMutationAllowed(): void {
  if (!isPlannerStagingE2eArmed()) {
    throw new PlannerStagingE2eFixtureScopeError(
      "Planner staging E2E fixtures are only available when E2E mode is armed on the integration staging Preview.",
    );
  }
}

export function evaluatePlannerStagingE2eHttpMutation(
  pathname: string,
  method: string,
  env: EnvLike = process.env,
): PlannerStagingE2eGateDecision {
  if (!isMarketingPreviewReadonlyMutationRequest(pathname, method)) {
    return "skip";
  }

  if (isMarketingPreviewReadonly(env)) {
    return "readonly";
  }

  const scope = plannerStagingE2eScopeDecision(env);
  if (scope === "reject" || scope === "skip") {
    return "skip";
  }

  if (!isPlannerStagingE2eArmed(env)) {
    return "scope_unarmed";
  }

  if (isPlannerStagingE2eAllowlistedMutation(pathname, method)) {
    return "allow";
  }

  return "deny_allowlist";
}

export function plannerStagingE2eMutationBlockMessage(decision: PlannerStagingE2eGateDecision): string {
  if (decision === "readonly") return MARKETING_PREVIEW_READONLY_MESSAGE;
  if (decision === "scope_unarmed") return PLANNER_STAGING_E2E_SCOPE_MESSAGE;
  return PLANNER_STAGING_E2E_ALLOWLIST_MESSAGE;
}

export function isPlannerE2eStagingTaggedMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const tag = (metadata as Record<string, unknown>).e2eTag;
  return typeof tag === "string" && tag === PLANNER_E2E_STAGING_TAG;
}

export function assertPlannerE2eStagingContentOwnership(
  metadata: unknown,
  contentId: string,
): void {
  if (!isPlannerE2eStagingTaggedMetadata(metadata)) {
    throw new PlannerStagingE2eOwnershipError(contentId);
  }
}

export class PlannerStagingE2eOwnershipError extends Error {
  readonly status = 403;

  constructor(contentId: string) {
    super(`${PLANNER_STAGING_E2E_OWNERSHIP_MESSAGE} (content ${contentId})`);
    this.name = "PlannerStagingE2eOwnershipError";
  }
}

export function integrationBranchPlannerStagingRef(): string {
  return STAGING_PLANNER_PREVIEW_GUARD_REF;
}


export async function assertPlannerStagingE2eOwnedContentIds(
  store: MarketingStore,
  contentIds: string[],
): Promise<void> {
  if (!isPlannerStagingE2eArmed()) return;
  for (const contentId of contentIds) {
    const content = await store.getContent(contentId);
    if (!content) {
      throw new PlannerStagingE2eOwnershipError(contentId);
    }
    assertPlannerE2eStagingContentOwnership(content.metadata, contentId);
  }
}

export function assertPlannerE2eApproveAllowed(content: MarketingContent): void {
  if (!isPlannerStagingE2eArmed()) return;
  assertPlannerE2eStagingContentOwnership(content.metadata, content.id);
}