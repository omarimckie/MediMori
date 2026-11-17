import { getSql } from "@/lib/db";
import { NextResponse } from "next/server";

export const PRODUCTION_DB_IDENTITY_CACHE_CONTROL = "no-store";

const PRODUCTION_DB_IDENTITY_SQL = `
SELECT
  current_setting('neon.project_id', true) AS neon_project_id,
  current_database() AS current_database
`.trim();

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const NEON_PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

export type ProductionDbIdentity = {
  neon_project_id: string;
  current_database: string;
};

export type EnvLike = Record<string, string | undefined>;

export function productionDbIdentitySql(): string {
  return PRODUCTION_DB_IDENTITY_SQL;
}

export function isProductionDbIdentityEnvironment(env: EnvLike = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

export function parseProductionDbIdentityRows(rows: unknown): ProductionDbIdentity {
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0] === null || typeof rows[0] !== "object") {
    throw new Error("Database identity check failed.");
  }

  const record = rows[0] as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["current_database", "neon_project_id"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("Database identity check failed.");
  }

  const neonProjectId = record.neon_project_id;
  const currentDatabase = record.current_database;

  if (
    neonProjectId === null ||
    neonProjectId === undefined ||
    (typeof neonProjectId === "string" && !neonProjectId.trim())
  ) {
    throw new Error("Database identity check failed.");
  }
  if (typeof neonProjectId !== "string" || !NEON_PROJECT_ID_PATTERN.test(neonProjectId)) {
    throw new Error("Database identity check failed.");
  }
  if (typeof currentDatabase !== "string" || !SQL_IDENTIFIER.test(currentDatabase)) {
    throw new Error("Database identity check failed.");
  }

  return {
    neon_project_id: neonProjectId,
    current_database: currentDatabase,
  };
}

export async function queryProductionDatabaseIdentity(): Promise<ProductionDbIdentity> {
  const rows = await getSql().query(productionDbIdentitySql());
  return parseProductionDbIdentityRows(rows);
}

const noStore = { "Cache-Control": PRODUCTION_DB_IDENTITY_CACHE_CONTROL };

export async function productionDbIdentityResponse(deps: {
  isAuthenticated: () => Promise<boolean>;
  isProductionEnvironment: () => boolean;
  queryIdentity: () => Promise<ProductionDbIdentity>;
}): Promise<NextResponse> {
  try {
    if (!(await deps.isAuthenticated())) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
  }

  if (!deps.isProductionEnvironment()) {
    return NextResponse.json({ enabled: false }, { status: 404, headers: noStore });
  }

  try {
    const identity = await deps.queryIdentity();
    return NextResponse.json(
      {
        neon_project_id: identity.neon_project_id,
        current_database: identity.current_database,
      },
      { status: 200, headers: noStore },
    );
  } catch {
    return NextResponse.json(
      { error: "Database identity check failed." },
      { status: 503, headers: noStore },
    );
  }
}