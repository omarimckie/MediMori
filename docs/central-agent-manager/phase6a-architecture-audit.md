# Phase 6a architecture audit (WP1)

## Reuse (no second job system)

| Capability | Existing module | Phase 6a extension |
| --- | --- | --- |
| Job queue / assignments | `memory-queue-store`, `durable-orchestration-queue-store` | Objective plans enqueue via existing `enqueueJob` (future); Phase 6a simulates plan state in-memory |
| Agent registry | `createTestAgent`, orchestration agents table | Worker templates map to `SpecialistId` + agent ids |
| Specialist profiles | `supervisor/registry.ts` | Versioned templates in `phase6a/specialist-template-registry.ts` |
| Consumer / bridge | `agent-consumer-handler`, `cursor-bridge` | `liveStore` hook for durable memory swap; production contract test |
| Approvals | `approval-integration`, `unavailableApprovalStore` | Closed-loop `awaiting_owner_approval`; no route activation |
| Evidence | assignment evidence ops | Worker lifecycle `evidenceIds` + existing evidence kinds |
| Budget | runner file budget + supervisor task budgets | Objective USD gate + template ceilings |

## New interfaces (Phase 6a)

- `ObjectivePlannerPort`, `ObjectivePlanV1`
- `WorkerLifecycleStore`, closed-loop manager
- `CursorExecutionAdapterPort` (disabled by default)
- `OwnerProgressReportV1`

## Gaps (not claimed complete)

- Plan → queue automatic enqueue scheduler
- Live Cursor SDK/cloud adapter
- Durable Postgres approvals and cross-process budget reservation
