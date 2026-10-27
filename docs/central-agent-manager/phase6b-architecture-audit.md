# Phase 6b integration audit (WP1)

## Objective

Connect Phase 6a planning and closed-loop decisions to the existing orchestration queue without introducing a second job system.

## Components reused

| Layer | Module | Role in 6b |
| --- | --- | --- |
| Queue | `memory-queue-store.ts`, `durable-orchestration-queue-store.ts` | Durable jobs, assignments, scheduler ticks |
| Scheduler | `scheduler.ts` | Agent selection, budget gates, approval gates |
| Consumer | `agent-consumer-handler.ts`, mock specialist harness | Fake worker execution |
| Phase 6a | `closed-loop-manager.ts`, `worker-matching.ts`, templates | Outcomes, corrective tasks, QA separation |
| Bridge | `cursor-bridge.ts` `liveStore` | Post-reload memory consistency |

## Phase 6b additions

- `phase6b/objective-execution-record.ts` — versioned objective execution record (plan, bindings, approvals, closed-loop state).
- `phase6b/plan-to-queue-scheduler.ts` — plan task → orchestration job enqueue with dependency resolution.
- `phase6b/objective-queue-manager.ts` — manager tick: schedule → scheduler → sync workers → ingest outcomes.
- `phase6b/queue-outcome-ingestion.ts` — idempotent job/assignment → `WorkerOutcomeReport` mapping.
- `phase6b/fake-queue-worker.ts` — scripted fake specialist runs through the consumer API.

## Contract mismatches resolved

1. **6a in-memory loop vs queue** — Phase 6a integration test bypasses the queue; Phase 6b adds `phase6b-queue-backed.integration.test.ts`.
2. **Runner stale memory** — `cursor-bridge-runner` now passes `liveStore` into assignment cycles (WP5).
3. **Plan task vs job dependencies** — Corrective jobs satisfy implement dependencies for downstream QA via `resolveDependencyJobId` and `refreshQaDependencyOnImplementJob`.
4. **Approval HTTP routes** — Still disabled (`unavailableApprovalStore`); durable approval requests are recorded on the objective execution record only.

## Intentionally not in scope

- New Neon tables for objectives (in-memory store + JSON snapshot for restart tests).
- Live Cursor SDK or cloud API calls.
- Distributed SQL budget reservations (documented gap in `phase6b-budget-concurrency.md`).
