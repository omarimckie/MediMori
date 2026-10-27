# Durable cross-project orchestration

## Ports

| Port | Role |
| --- | --- |
| `OrchestrationQueuePort` | Durable-ready queue API (async) |
| `MemoryOrchestrationQueueStore` | In-memory engine + simulation default |
| `OrchestrationSqlPort` | Injected SQL transport (tests use in-memory tables) |
| `createPostgresOrchestrationQueuePort` | **Deprecated** enqueue/load test helper — owner mutations throw; use `createDurableOrchestrationQueueStore` |
| `createDurableOrchestrationQueueStore` | Production durable port with reload + fenced / owner-writable job persistence |

## SQL artifact (not applied)

`sql/central-agent-manager-orchestration.sql` defines `orchestration_jobs`, `orchestration_assignments`, and `orchestration_agents` JSONB tables.

## Feature flags

| Variable | Effect |
| --- | --- |
| `CENTRAL_AGENT_MANAGER_QUEUE_MODE=simulation` | Default read-only simulation (`GET /queue`) |
| `CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED=true` | Enables durable queue feature family |
| `CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED=true` | Enables owner `GET/POST /queue/manage` (in-memory per owner until PG activation) |

## Activation gates (owner)

1. Apply orchestration SQL on disposable branch.
2. Wire `OrchestrationSqlPort` to real PostgreSQL driver.
3. Disposable approval SQL evidence (38 cases) still required before approval route activation.
4. Explicit OA for worker dispatch (out of scope).

## Approval pooling

`createPostgresApprovalStore` accepts `sessionVerificationMode: "per_operation"` to re-run identity observation on every privileged call when using pooled connections.

## Database operations

See [ORCHESTRATION_DATABASE_OPS.md](./ORCHESTRATION_DATABASE_OPS.md) for Neon project/branch targeting, disposable vs staging URLs, owner/consumer concurrency, crash recovery, and branch cleanup.
