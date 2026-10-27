# Phase 5a-2 — Staging orchestration runbook

Offline engineering checks (safe now):

- `npm run cam:orchestration-env-check`
- `npm run test:central-agent-manager` (with `CAM_ORCHESTRATION_*` URLs **unset**)
- Handler rehearsal: `staging-queue-smoke-offline.test.ts`, `queue-management-handler.test.ts`

Provisioning checklist: [PHASE_5A_STAGING_PROVISIONING_CHECKLIST.md](./PHASE_5A_STAGING_PROVISIONING_CHECKLIST.md).
Queue smoke procedure: [PHASE_5B_QUEUE_SMOKE_PROCEDURE.md](./PHASE_5B_QUEUE_SMOKE_PROCEDURE.md).

Neon provisioning and live smoke require **explicit owner approval** (sections marked **APPROVAL**).

---

## 5a-2A — Provisioning (**APPROVAL**)

### Target

| Field | Value |
| --- | --- |
| Neon project | `central-agent-manager-staging` / `aged-brook-70202332` |
| Parent branch | `br-nameless-mode-b7hkls9l` (not `br-withered-dream-b71r3mo0`) |
| Purpose | Dedicated durable-queue staging branch for `CAM_ORCHESTRATION_DATABASE_URL` |

### Steps

1. **Create branch** (**APPROVAL** — Neon console or `neon` CLI): name e.g. `cam-orchestration-staging-5a2-YYYYMMDD`. Record **branch id** (`br-…`) and **endpoint host id** (`ep-…`, non-secret).
2. **Configure expectation (before URL):** set `CAM_ORCHESTRATION_EXPECTED_NEON_PROJECT_ID=aged-brook-70202332` (optional; default) and `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID=<new branch id>`.
3. **Connection string** (**APPROVAL** — store in secret manager / local gitignored env only): `CAM_ORCHESTRATION_DATABASE_URL` for the new branch endpoint. Never commit.
4. **Identity probe (read-only)** (**APPROVAL** — `psql` or Neon SQL editor):

```sql
SELECT
  current_setting('neon.project_id', true) AS neon_project_id,
  current_setting('neon.branch_id', true) AS neon_branch_id,
  current_database() AS current_database;
```

**Stop** if `neon_project_id` ≠ `aged-brook-70202332` or `neon_branch_id` ≠ `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID`. Do not rely on endpoint hostname alone.

5. **Schema inspection** (**APPROVAL**): confirm `central_agent_manager` schema absent or empty of production data you must not touch.
6. **Apply schema once** (**APPROVAL**): `sql/central-agent-manager-orchestration.sql` on this branch only.
7. **Post-schema verification** (**APPROVAL** — read-only):

```sql
SELECT to_regclass('central_agent_manager.orchestration_jobs') IS NOT NULL AS jobs_table_ready;
```

### Evidence to capture

- Branch id, endpoint id, probe query result (project + branch ids only).
- `jobs_table_ready = true`.
- `npm run cam:orchestration-env-check` output with all `ok: true` after env is loaded locally (no URLs in logs).

### Stop conditions

- Any probe mismatch, denied branch (`br-withered-dream-b71r3mo0`, product/preview branches), or product project `solitary-leaf-77946642`.
- Disposable URL equals live URL.
- Schema applied on wrong project/branch.

---

## 5a-2B — Queue smoke (**APPROVAL** for live DB + HTTP)

### Runtime (single owner)

| Variable | Required value |
| --- | --- |
| `CENTRAL_AGENT_MANAGER_ENABLED` | `true` |
| `CENTRAL_AGENT_MANAGER_OWNER_USERNAMES` | Owner admin username(s) |
| `CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED` | `true` |
| `CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED` | `true` |
| `CAM_ORCHESTRATION_POOL_ENABLED` | `true` |
| `CAM_ORCHESTRATION_DATABASE_URL` | Staging branch URL (secret) |
| `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID` | Same branch id as 5a-2A |

### Forbidden for 5a-2B

| Variable | Must stay off/unset |
| --- | --- |
| `CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED` | not `true` |
| `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED` | not `true` |
| `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED` | not `true` |
| `CURSOR_API_KEY` | unset |
| `CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL` | unset in runtime |
| Durable approval adapter / `CAM_APPROVAL_*` live store | not activated |

Preflight: `npm run cam:orchestration-env-check` → all `ok: true`.

### Authentication

- Route: `GET` / `POST` **`/api/admin/central-agent-manager/queue/manage`**
- **Owner admin session** (same cookie/session as other admin routes via `getAuthenticatedAdminUsername`). Non-owner → `403`; unauthenticated → `401`.

### Smoke sequence (**APPROVAL**)

1. Start **one** local `next dev` (or staging deploy) with the env above — no second owner scheduler.
2. `GET /api/admin/central-agent-manager/queue/manage` → `200`, body includes `durable: true`, `managementEnabled: true`.
3. `POST` with JSON:

```json
{
  "action": "enqueue",
  "id": "job-staging-5a2b-<unique>",
  "projectId": "medimori",
  "goalId": "goal-staging-5a2b",
  "description": "Phase 5a-2B staging smoke"
}
```

→ `200`, body `{ "job": { ... } }`.

4. `GET` again → job appears under `queuedByProject.medimori`.
5. Restart app (or new durable store load) → job still present (SQL durability).
6. **Read-only DB** (**APPROVAL**):

```sql
SELECT id, project_id, state FROM central_agent_manager.orchestration_jobs
WHERE id = 'job-staging-5a2b-<unique>';
```

Re-run identity probe; ids must still match expectation.

### Rollback / cleanup (**APPROVAL**)

- Disable durable, queue-management, and pool flags.
- Remove `CAM_ORCHESTRATION_DATABASE_URL` from runtime.
- Optional: `TRUNCATE` orchestration tables or delete staging branch after evidence export.
- Do **not** delete or mutate the disposable integration-test branch (`br-withered-dream-b71r3mo0`).

---

## Related docs

- [ORCHESTRATION_DATABASE_OPS.md](./ORCHESTRATION_DATABASE_OPS.md)
- [PHASE_5A_STAGING_SMOKE.md](./PHASE_5A_STAGING_SMOKE.md) (summary pointer)
- [NUC13_PROXMOX_BRIDGE_RUNBOOK.md](./NUC13_PROXMOX_BRIDGE_RUNBOOK.md) (later; not required for 5a-2B)
