# Phase 6b budget and concurrency (WP10)

## Wired today

- Plan enqueue uses specialist default budgets from `getSpecialistProfile`.
- `runSchedulerTick` applies `budgetBlockReason` before assignment.
- Objective manager `maxConcurrentTasks` caps parallel open jobs per objective.
- Scheduler idempotency tests in `phase6b-scheduler.test.ts`.

## Gaps requiring durable SQL reservation

- Cross-runner daily external create caps (file budget vs concurrent runners).
- Objective-level spend committed across multiple jobs before work starts.
- Refund on cancelled assignments after budget debit.

Until a validated reservation row exists, CAM does **not** claim a hard distributed spending cap.
