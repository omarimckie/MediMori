/** Fixed staging Neon branch — not configurable beyond matching this value. */
export const FIXED_STAGING_NEON_BRANCH_ID = "br-nameless-mode-b7hkls9l" as const;

/** Fixed release Git ref for Preview probe acceptance. */
export const FIXED_RELEASE_GIT_REF = "release/central-agent-status-minimal" as const;

/** Expected Postgres database name on the staging branch. */
export const FIXED_STAGING_DATABASE_NAME = "neondb" as const;

export const RUNTIME_DB_PROBE_CONTRACT = "central-agent-runtime-db-identity/v1" as const;
