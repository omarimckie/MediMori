# CAM runner budget — durable cross-process reservation (proposal only)

**Status:** Not applied. No Neon or external schema changes in Phase 5c.

## Problem

`budget.json` on a single host is updated atomically (`saveBudgetStateToFile` uses write-temp + rename), but it is **not** a distributed ledger. Two runners on different VMs, or a runner plus a manual API call, can each consume daily create budget.

## Proposed direction

1. Add table `central_agent_manager.runner_budget_reservations` on the **orchestration** database (not approval disposable branch).
2. Columns: `runner_id`, `day_key`, `hour_key`, `creates_reserved`, `cycles_reserved`, `updated_at`, `lease_token`.
3. Reserve in the same transaction as `begin_external_dispatch` (or immediately before Cursor create) with row-level lock on `(day_key, runner_id)`.
4. Reconcile on completion: commit consumption or release reservation on failure/timeout.
5. Runner startup: read file budget as cache; authoritative check via SQL `SELECT … FOR UPDATE`.

## Migration sketch (do not run without owner approval)

```sql
-- PROPOSAL ONLY
CREATE TABLE central_agent_manager.runner_budget_daily (
  day_key text NOT NULL,
  creates_consumed integer NOT NULL DEFAULT 0 CHECK (creates_consumed >= 0),
  PRIMARY KEY (day_key)
);
```

## Homelab until then

- Enforce **one runner per host** via file lock (`CURSOR_BRIDGE_SINGLE_RUNNER_POLICY`).
- Keep `dailyCreateBudget` low on homelab.
- Do not enable live Cursor API on homelab until budget SQL exists or owner accepts file-only risk.
