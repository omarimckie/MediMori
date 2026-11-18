import { getSql } from "@/lib/db";
import { resolveMarketingDatabaseGuardRoute } from "@/lib/marketing/marketing-database-guard";
import {
  isMarketingPreviewReadonly,
  isMarketingPreviewReadonlyConfigured,
} from "@/lib/marketing/preview-readonly";
import { PREVIEW_DB_IDENTITY_PROBE_SQL } from "@/lib/marketing/preview-db-guard";
import { NextResponse } from "next/server";

export const PREVIEW_RUNTIME_DB_IDENTITY_CACHE_CONTROL = "no-store";

const NEON_PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export type PreviewRuntimeDatabaseIdentity = {
  neon_project_id: string;
  current_database: string;
  current_user: string;
  marketing_content_insert_allowed: boolean;
  preview_readonly: boolean;
  marketing_preview_readonly_configured: boolean;
  vercel_env: string | null;
  vercel_git_commit_ref: string | null;
  database_guard_route: ReturnType<typeof resolveMarketingDatabaseGuardRoute>;
};

export function previewRuntimeDbIdentitySql(): string {
  return PREVIEW_DB_IDENTITY_PROBE_SQL;
}

export function parsePreviewRuntimeDbIdentityRows(rows: unknown): Omit<
  PreviewRuntimeDatabaseIdentity,
  | "preview_readonly"
  | "marketing_preview_readonly_configured"
  | "vercel_env"
  | "vercel_git_commit_ref"
  | "database_guard_route"
> {
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0] === null || typeof rows[0] !== "object") {
    throw new Error("Database identity check failed.");
  }
  const record = rows[0] as Record<string, unknown>;
  const neonProjectId = record.neon_project_id;
  const currentDatabase = record.current_database;
  const currentUser = record.current_user;
  const insertAllowed = record.marketing_content_insert_allowed;

  if (typeof neonProjectId !== "string" || !NEON_PROJECT_ID_PATTERN.test(neonProjectId)) {
    throw new Error("Database identity check failed.");
  }
  if (typeof currentDatabase !== "string" || !SQL_IDENTIFIER.test(currentDatabase)) {
    throw new Error("Database identity check failed.");
  }
  if (typeof currentUser !== "string" || !SQL_IDENTIFIER.test(currentUser)) {
    throw new Error("Database identity check failed.");
  }
  if (typeof insertAllowed !== "boolean") {
    throw new Error("Database identity check failed.");
  }

  return {
    neon_project_id: neonProjectId,
    current_database: currentDatabase,
    current_user: currentUser,
    marketing_content_insert_allowed: insertAllowed,
  };
}

export function buildPreviewRuntimeDeploymentIdentity(
  env: Record<string, string | undefined> = process.env,
): Pick<
  PreviewRuntimeDatabaseIdentity,
  "preview_readonly" | "marketing_preview_readonly_configured" | "vercel_env" | "vercel_git_commit_ref" | "database_guard_route"
> {
  return {
    preview_readonly: isMarketingPreviewReadonly(env),
    marketing_preview_readonly_configured: isMarketingPreviewReadonlyConfigured(env),
    vercel_env: env.VERCEL_ENV?.trim() || null,
    vercel_git_commit_ref: env.VERCEL_GIT_COMMIT_REF?.trim() || null,
    database_guard_route: resolveMarketingDatabaseGuardRoute(env),
  };
}

export async function queryPreviewRuntimeDatabaseIdentity(): Promise<PreviewRuntimeDatabaseIdentity> {
  const rows = await getSql().query(previewRuntimeDbIdentitySql());
  const base = parsePreviewRuntimeDbIdentityRows(rows);
  return {
    ...base,
    ...buildPreviewRuntimeDeploymentIdentity(),
  };
}

const noStore = { "Cache-Control": PREVIEW_RUNTIME_DB_IDENTITY_CACHE_CONTROL };

export function isPreviewRuntimeDbIdentityEnvironment(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.VERCEL_ENV === "preview";
}

export async function previewRuntimeDbIdentityResponse(deps: {
  isAuthenticated: () => Promise<boolean>;
  isPreviewRuntime: () => boolean;
  queryIdentity: () => Promise<PreviewRuntimeDatabaseIdentity>;
}): Promise<NextResponse> {
  try {
    if (!(await deps.isAuthenticated())) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
  }

  if (!deps.isPreviewRuntime()) {
    return NextResponse.json({ enabled: false }, { status: 404, headers: noStore });
  }

  try {
    const identity = await deps.queryIdentity();
    return NextResponse.json(identity, { status: 200, headers: noStore });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "PreviewFailClosedDatabaseGuardError") {
      return NextResponse.json(
        { error: "Preview database isolation check failed." },
        { status: 503, headers: noStore },
      );
    }
    return NextResponse.json(
      { error: "Database identity check failed." },
      { status: 503, headers: noStore },
    );
  }
}