import { getSql } from "@/lib/db";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { FIXED_STAGING_DATABASE_NAME, FIXED_STAGING_NEON_BRANCH_ID } from "./constants";

export type RuntimeDatabaseIdentity = {
  databaseName: string;
  neonBranchId: string;
};

export class RuntimeDatabaseIdentityError extends Error {
  readonly code: "missing_branch" | "invalid_result" | "wrong_database" | "wrong_branch";

  constructor(code: RuntimeDatabaseIdentityError["code"]) {
    super(code);
    this.code = code;
  }
}

export async function fetchRuntimeDatabaseIdentity(
  database: NeonQueryFunction<false, false> = getSql(),
): Promise<RuntimeDatabaseIdentity> {
  const rows = await database`
    SELECT current_database() AS database_name,
           current_setting('neon.branch_id', true) AS neon_branch_id
  `;

  const row = rows[0] as { database_name?: unknown; neon_branch_id?: unknown } | undefined;
  if (!row) {
    throw new RuntimeDatabaseIdentityError("invalid_result");
  }

  const databaseName =
    typeof row.database_name === "string" ? row.database_name.trim() : "";
  const neonBranchId =
    typeof row.neon_branch_id === "string" ? row.neon_branch_id.trim() : "";

  if (!databaseName) {
    throw new RuntimeDatabaseIdentityError("invalid_result");
  }
  if (!neonBranchId) {
    throw new RuntimeDatabaseIdentityError("missing_branch");
  }
  if (databaseName !== FIXED_STAGING_DATABASE_NAME) {
    throw new RuntimeDatabaseIdentityError("wrong_database");
  }
  if (neonBranchId !== FIXED_STAGING_NEON_BRANCH_ID) {
    throw new RuntimeDatabaseIdentityError("wrong_branch");
  }

  return { databaseName, neonBranchId };
}
