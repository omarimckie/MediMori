# Phase 6c failure-mode audit (WP1)

## Crash windows (pre-6c)

| Window | Risk | Mitigation in 6c |
| --- | --- | --- |
| After enqueue, before objective `put` | Orphan queue jobs | Reconciliation warns `orphan_queue_job`; durable flush after tick |
| After outcome apply, before persist | Duplicate outcome on restart | `acceptedOutcomeKeys` + binding `outcomeIngested` |
| Mid corrective creation | Lost follow-up task | Closed-loop state persisted in objective store v2 |
| QA depends on cancelled implement job | QA never runs | `refreshQaDependencyOnImplementJob` + dependency resolver |
| Scheduler assigns while manager offline | Stale assignments | Durable SQL queue reload + consumer recovery |
| Approval grant in memory only | Stale authorization | Routes remain disabled; pending approvals on objective record |

## Architectural gaps (documented, not all closed)

- PostgreSQL objective table (contract only).
- Cross-host budget reservation SQL.
- Live Cursor adapter execution.

## Regression added

- `phase6c-durable-closed-loop.integration.test.ts`
- `phase6c-budget-reservation.test.ts`
- `phase6c-security.test.ts`
- `phase6c-escalation.test.ts`
