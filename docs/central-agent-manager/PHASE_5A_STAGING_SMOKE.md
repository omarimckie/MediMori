# Phase 5a-2 — Staging durable queue smoke (summary)

**Authoritative operator steps:** [PHASE_5A_STAGING_RUNBOOK.md](./PHASE_5A_STAGING_RUNBOOK.md) (5a-2A provisioning + 5a-2B queue smoke).

Offline engineering:

- `npm run cam:orchestration-env-check` (requires `CAM_ORCHESTRATION_EXPECTED_NEON_BRANCH_ID` when pool + live URL are set)
- Tests: `staging-queue-smoke-offline.test.ts`, `queue-management-http-smoke-readiness.test.ts`

HTTP route: `/api/admin/central-agent-manager/queue/manage` (owner admin session).

Flags use the `CENTRAL_AGENT_MANAGER_*` prefix (see runbook). Identity is verified from database-reported `neon.project_id` / `neon.branch_id`, not from endpoint hostnames alone.
