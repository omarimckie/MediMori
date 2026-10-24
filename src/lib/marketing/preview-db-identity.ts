import { getSql } from "@/lib/db";
import { NextResponse } from "next/server";

export const PREVIEW_DB_IDENTITY_CACHE_CONTROL = "no-store";

const PREVIEW_DB_IDENTITY_SQL = `
SELECT
  current_user,
  current_database() AS current_database,
  has_table_privilege(current_user, 'public.marketing_content', 'INSERT') AS marketing_content_insert_allowed
`.trim();

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export type PreviewDbIdentity = {
  current_user: string;
  current_database: string;
  marketing_content_insert_allowed: boolean;
};

export function previewDbIdentitySql(): string {
  return PREVIEW_DB_IDENTITY_SQL;
}

export function parsePreviewDbIdentityRows(rows: unknown): PreviewDbIdentity {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") {
    throw new Error("Database identity check failed.");
  }

  const record = rows[0] as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["current_database", "current_user", "marketing_content_insert_allowed"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("Database identity check failed.");
  }

  const currentUser = record.current_user;
  const currentDatabase = record.current_database;
  const insertAllowed = record.marketing_content_insert_allowed;
  if (typeof currentUser !== "string" || !SQL_IDENTIFIER.test(currentUser)) {
    throw new Error("Database identity check failed.");
  }
  if (typeof currentDatabase !== "string" || !SQL_IDENTIFIER.test(currentDatabase)) {
    throw new Error("Database identity check failed.");
  }
  if (typeof insertAllowed !== "boolean") {
    throw new Error("Database identity check failed.");
  }

  return {
    current_user: currentUser,
    current_database: currentDatabase,
    marketing_content_insert_allowed: insertAllowed,
  };
}

export async function queryPreviewDatabaseIdentity(): Promise<PreviewDbIdentity> {
  const rows = await getSql().query(previewDbIdentitySql());
  return parsePreviewDbIdentityRows(rows);
}

const noStore = { "Cache-Control": PREVIEW_DB_IDENTITY_CACHE_CONTROL };

export async function previewDbIdentityResponse(deps: {
  isAuthenticated: () => Promise<boolean>;
  isPreviewReadonly: () => boolean;
  queryIdentity: () => Promise<PreviewDbIdentity>;
}): Promise<NextResponse> {
  try {
    if (!(await deps.isAuthenticated())) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
  }

  if (!deps.isPreviewReadonly()) {
    return NextResponse.json({ enabled: false }, { status: 404, headers: noStore });
  }

  try {
    const identity = await deps.queryIdentity();
    return NextResponse.json(identity, { status: 200, headers: noStore });
  } catch {
    return NextResponse.json(
      { error: "Database identity check failed." },
      { status: 503, headers: noStore },
    );
  }
}
