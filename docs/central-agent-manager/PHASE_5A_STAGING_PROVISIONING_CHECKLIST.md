# Phase 5a-2A — Staging provisioning checklist (execute after owner approval)

**Do not run Neon mutations without explicit authorization.** This document is the reproducible procedure only.

## Verified targets (from repo configuration)

| Field | Value | Source |
| --- | --- | --- |
| Neon project | `aged-brook-70202332` (`central-agent-manager-staging`) | `ORCHESTRATION_DATABASE_OPS.md`, `orchestration-staging-identity.ts` |
| Parent branch | `br-nameless-mode-b7hkls9l` | `approval-database-identity.ts` (approval V1 branch on same project) |
| Proposed orchestration staging branch **name** | `cam-orchestration-staging-5a` | Operator assignment (record actual `br-…` after create) |
| Disposable integration branch (do not use for live URL) | `br-withered-dream-b71r3mo0` | `ORCHESTRATION_DATABASE_OPS.md` |
| Product DB (forbidden) | `solitary-leaf-77946642` | `config-validation.ts`, identity guards |

Orchestration queue DDL is **separate** from approval schema (`sql/central-agent-manager-orchestration.sql` vs `central-agent-manager-approvals.sql`).

## Schema DDL review (non-destructive by design)

`sql/central-agent-manager-orchestration.sql`:

- `CREATE SCHEMA IF NOT EXISTS` — idempotent.
- `CREATE TABLE IF NOT EXISTS` for jobs, assignments, agents, quarantine — no `DROP`, no `TRUNCATE`, no data migration.
- `ON DELETE CASCADE` from assignments → jobs only (orchestration scope).
- Indexes are `IF NOT EXISTS`.

**Unexpected operations:** none in this file. Applying twice is safe. It does **not** remove existing rows.

## Branch already exists

1. **Do not** re-create or reset the branch if `cam-orchestration-staging-5a` (or your chosen name) already exists.
2. Record existing `br-…` and endpoint `ep-…` from Neon console.
3. Run identity probe (below). If probe matches intended staging branch, set `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID` to that id.
4. If probe shows wrong project/branch, **stop** — do not apply schema or point live URL.
5. If schema objects already exist (`orchestration_jobs` present), skip apply; run post-schema verification only.

## Provisioning sequence (**APPROVAL**)

### 1. Create branch (**APPROVAL**)

- Project: `aged-brook-70202332`
- Parent: `br-nameless-mode-b7hkls9l`
- Name: `cam-orchestration-staging-5a` (or next revision suffix if name taken)
- Record: `BRANCH_ID`, `ENDPOINT_ID` (non-secret)

### 2. Identity probe — database GUCs (**APPROVAL**, read-only)

Connect with the **staging branch** connection string (secret). Run:

```sql
SELECT
  current_setting('neon.project_id', true) AS neon_project_id,
  current_setting('neon.branch_id', true) AS neon_branch_id,
  current_database() AS current_database;
```

**Pass:** `neon_project_id = 'aged-brook-70202332'` and `neon_branch_id = '<BRANCH_ID from step 1>'`.

**Stop** on mismatch, empty GUCs, or `solitary-leaf-77946642`.

### 3. Configure expectations (local/staging env, no commit)

```text
CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID=aged-brook-70202332
CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID=<BRANCH_ID>
CAM_ORCHESTRATION_DATABASE_URL=<secret — staging branch only>
CAM_ORCHESTRATION_POOL_ENABLED=true
```

Do **not** set `CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL` on staging runtime.

### 4. Offline preflight (safe now)

With env loaded in shell (secrets gitignored):

```bash
npm run cam:orchestration-env-check
```

All lines must show `"ok":true`. Fix denied endpoints / missing branch id before continuing.

### 5. Apply schema (**APPROVAL**, one-time per branch)

Apply `sql/central-agent-manager-orchestration.sql` via Neon SQL editor or `psql` against **only** this branch.

### 6. Post-schema verification (**APPROVAL**, read-only)

```sql
SELECT to_regclass('central_agent_manager.orchestration_jobs') IS NOT NULL AS jobs_ready;
SELECT to_regclass('central_agent_manager.orchestration_assignments') IS NOT NULL AS assignments_ready;
SELECT COUNT(*)::int AS job_count FROM central_agent_manager.orchestration_jobs;
```

Expect `jobs_ready` and `assignments_ready` true. `job_count` baseline (often `0`) — record for smoke delta.

Re-run identity probe; ids must be unchanged.

## Evidence collection

- Branch id, endpoint id (not connection string).
- Identity probe JSON (project + branch ids only).
- `cam:orchestration-env-check` stdout.
- Post-schema `jobs_ready` / `assignments_ready` / `job_count`.
- Git SHA of app under test.

## Rollback (**APPROVAL**)

1. Disable `CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED`, `QUEUE_MANAGEMENT_ENABLED`, `CAM_ORCHESTRATION_POOL_ENABLED`.
2. Remove `CAM_ORCHESTRATION_DATABASE_URL` from runtime.
3. Optional: delete staging branch or `TRUNCATE` orchestration tables on that branch only.
4. **Never** delete `br-withered-dream-b71r3mo0` as part of staging rollback unless separately authorized for disposable cleanup.

## Next step after provisioning

[PHASE_5B_QUEUE_SMOKE_PROCEDURE.md](./PHASE_5B_QUEUE_SMOKE_PROCEDURE.md) — owner HTTP smoke (5a-2B).
