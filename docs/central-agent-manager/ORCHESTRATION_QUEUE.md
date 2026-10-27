# Central Agent Manager — job queue integration map

## Reused foundation (do not duplicate)

| Module | Role for orchestration |
| --- | --- |
| `registry.ts` | Canonical five `ProjectId` values and display names |
| `supervisor/types.ts` | Budget shapes, `SupervisorContractError`, task/evidence types |
| `supervisor/protected-operations.ts` | `requiresOwnerApproval` for protected-action gates |
| `supervisor/trusted-approval.ts` | Owner approval semantics (not wired to HTTP route) |
| `supervisor/task.ts` | Task transition patterns (reference for approval/completion rules) |
| `consolidate.ts` / status adapters | Satellite **source** status (orthogonal to manager-owned queue) |
| `approval-handler.ts` + approvals route | Fail-closed; queue does not activate persistence |

## New orchestration layer (`src/lib/central-agent-manager/orchestration/`)

| Module | Responsibility |
| --- | --- |
| `contracts-v1.ts` | Versioned serializable job and assignment records |
| `job-state.ts` | Queue job state machine |
| `agent-capacity.ts` | Agent registry, capability match, stale detection |
| `memory-queue-store.ts` | In-memory durable-ready port |
| `scheduler.ts` | Deterministic assignment policy |
| `assignment-lifecycle.ts` | Leases, recovery, ambiguous outcomes |
| `approval-integration.ts` | Queue ↔ supervisor approval classification |
| `projections.ts` | Owner read models (evidence-backed) |
| `offline-simulation.ts` | Multi-project offline demo data |
| `index.ts` | Public exports |
| `external-execution-refs.ts` | Bounded optional correlation to Cursor and engineering runtimes |

## External execution references (Phase 1)

Jobs and assignments may include optional `externalRefs` for **correlation only**:

| Field | Purpose |
| --- | --- |
| `correlationKey` | Owner or manager-supplied correlation token (bounded ASCII) |
| `engineeringTaskId` | MediMori engineering task UUID when linked for visibility |
| `engineeringRunId` | MediMori engineering run UUID when linked for visibility |
| `cursorAgentId` | Cursor SDK agent identifier when a bridge records it |
| `cursorRunId` | Cursor SDK run identifier when a bridge records it |

Rules:

- Omitted on legacy rows and JSON payloads (backward compatible).
- Validated on enqueue, parse, and durable reload (`record-validation.ts`).
- Exposed in owner queue projections after sanitization (`projections.ts`).
- **Never** substitutes for engineering `authorize_execution`, worker leases, Agent 2 dispatch, or CAM approval bindings.
- Unknown keys and secret-like values are rejected at validation time.

Enqueue (durable management API): optional `externalRefs` object on `action: "enqueue"` bodies.

## Agent consumer interface (Phase 2)

Opt-in internal route: `GET|POST /api/internal/central-agent-manager/assignments`

| Flag / config | Purpose |
| --- | --- |
| `CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED=true` | Enables agent consumer HTTP surface |
| `CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON` | Per-agent bearer tokens (separate from owner admin cookies) |
| `CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED=true` | Required for durable orchestration backing |
| `CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED=true` | Owner management path (in-memory simulation when SQL transport absent) |

Contract version: `central-agent-manager-agent-consumer/v1`

Actions (`POST` JSON body):

- `claim` — claim the next ready job for the authenticated agent (optional `jobId`, `idempotencyKey`)
- `heartbeat` — extend lease (`assignmentId`, `leaseFenceToken`, optional progress fields)
- `submit_evidence` — persist verified orchestration evidence (`work_completed` or `progress_note`) on the assignment payload (`persistedEvidence`, bounded) and in the durable SQL assignment row when orchestration persistence is active
- `complete` — terminal success; requires persisted `work_completed` evidence ids (not client-only ids)
- `fail` — terminal failure with bounded reason

Bearer credentials are scoped to a single `agentId` and do not grant owner, approval, or engineering execution privileges.

On durable reload, orchestration evidence is rehydrated from assignment `persistedEvidence` snapshots. Completed jobs whose `evidenceIds` cannot be verified against durable assignment evidence are blocked fail-closed (no new SQL migration required).

## Mock specialist validation (Phase 3)

Local validation only (`orchestration/mock-specialist-agent.ts`): a bounded simulated specialist drives the **same** Phase 2 consumer actions (`claim`, `heartbeat`, `submit_evidence`, `complete`) through `centralAgentManagerAgentConsumerResponse`. It does not use the Cursor SDK, engineering workers, or a parallel queue API.

`runMockSpecialistAssignmentLifecycle` enqueues nothing by itself; tests seed jobs and agents, then assert:

- Assignment ownership and lease fencing through consumer operations
- Progress note + `work_completed` evidence persisted on the assignment
- Terminal `completed` job state and owner queue projection milestones

Automated coverage lives in `mock-specialist-agent.test.ts` (unauthorized agent, stale lease, missing evidence, duplicate completion, cross-agent access, durable reload).

## Cursor REST bridge foundation (Phase 4B-1 / 4B-2)

Opt-in flag (default off): `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED=true`

Local bridge (`orchestration/cursor-bridge/`): drives the **same** Phase 2 consumer actions plus `correlate_external` to persist `cursorAgentId` / `cursorRunId` on the assignment and job JSON (no new SQL migration). Production HTTP uses `CursorRestCloudApiTransport` (`POST /v1/agents`, `GET /v1/agents/{id}/runs/{runId}`) with `CURSOR_API_KEY` loaded at runtime only. Tests use mocked `fetch` or `FakeCursorCloudApiTransport` — no live API or SDK.

Consumer additions (see `AGENT_CONSUMER_CONTRACT.md`):

- `begin_external_dispatch` — durable `dispatch_in_progress` before any external create
- `correlate_external` — bounded cursor ids + `external_confirmed` intent on assignment and job JSON
- `mark_external_dispatch_outcome_unknown` — ambiguous create outcome before operator escalation
- `mark_external_dispatch_failed` / `escalate_external_dispatch_recovery` — terminal failure vs operator recovery

Bridge cycle: `claim` → `begin_external_dispatch` → single Cursor create (no automatic retry on mutations) → `correlate_external` → lease-aware poll with bounded read retries → `heartbeat` / evidence → `complete`. Unresolved `dispatch_in_progress` without confirmed ids escalates to `recovery_required` on restart (no silent redispatch). Polling honors `CURSOR_BRIDGE_POLL_*` limits and CAM lease expiry. In-memory `CursorBridgeDispatchRegistry` is advisory within a process only; durable intent + lease fence is the cross-process control.

Optional REST tuning (see `.env.example`): `CURSOR_CLOUD_API_BASE_URL`, request timeout, response size bound, read retry backoff, poll interval / max duration, heartbeat minimum interval.

## Integration points (future)

1. **Durable store** — `OrchestrationQueuePort` Postgres/Neon backing (see `DURABLE_ORCHESTRATION.md`).
2. **Worker dispatch** — scheduler emits assignment intents; Phase 2 agent consumer pull/claim complements scheduler (no Cursor SDK).
3. **Supervisor tasks** — optional `supervisorTaskId` on jobs links queue rows to `SupervisorTask` records.
4. **Owner UI** — read-only queue API + dashboard section; simulation flagged explicitly.
