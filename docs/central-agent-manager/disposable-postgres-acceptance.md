# Disposable server PostgreSQL acceptance (owner-operated)

Phase 6g CI does **not** connect to Neon or apply migrations.

## Operator procedure

1. **Identity** — Confirm `CAM_APPROVAL_PROJECT_ID`, `CAM_APPROVAL_BRANCH_ID`, `CAM_APPROVAL_DATABASE_NAME`, `CAM_APPROVAL_ENDPOINT_ID` match the disposable branch worksheet. **Stop** if any value matches production/staging markers in `orchestration-env-safeguards`.
2. **Disposable target** — Confirm branch name and endpoint are owner-approved disposable only.
3. **Inspect** — `\dt central_agent_manager.*` and `\df central_agent_manager.*` (no apply yet).
4. **Apply migrations** — Only the approved SQL files for this branch (orchestration, objective, budget; approvals PL/pgSQL package separate).
5. **Objective/queue/budget** — `CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL=...` → pool integration tests + `npm run cam:phase6g-offline-acceptance` on dev machine with PGlite baseline already green.
6. **38 approval cases** — `CAM_APPROVAL_DISPOSABLE_EXECUTE=true` + disposable URL + identity → `npm run cam:approval-disposable-executor-offline`.
7. **Recovery** — Re-run crash-boundary tests against server URL (manual checklist from phase6g-crash-boundaries).
8. **Evidence** — `npm run cam:approval-manifest-readiness-report` (offline JSON) + save CI logs and SQL `SELECT` snapshots.
9. **Cleanup inventory** — List rows in `objective_executions`, `objective_budget_*`, `orchestration_*`, `approval_*`; **do not auto-delete** without owner sign-off.

## Offline readiness (no database)

```bash
npm run cam:approval-manifest-readiness-report
npm run cam:phase6g-offline-acceptance
```

## Rollback

Drop disposable branch or truncate `central_agent_manager` schema; keep USB read-only until NUC13 passes twice.
