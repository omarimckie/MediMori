# Central Agent Manager — agent consumer contract v1

Contract identifier: `central-agent-manager-agent-consumer/v1`

Internal route: `GET|POST /api/internal/central-agent-manager/assignments`

## Authentication

Per-agent bearer tokens (`CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON`). Bearer scope is limited to a single `agentId` and does not grant owner, approval, or engineering execution privileges.

## Core actions

| Action | Purpose |
| --- | --- |
| `claim` | Claim the next ready assignment (optional `jobId`, `idempotencyKey`) |
| `heartbeat` | Extend lease; optional progress `diagnostic` / `artifactRef` |
| `submit_evidence` | Persist verified orchestration evidence on the assignment |
| `complete` | Terminal success; requires durable `work_completed` evidence ids |
| `fail` | Terminal failure with bounded `reason` |

## External dispatch actions (Cursor bridge)

These actions persist **dispatch intent** on both the assignment and job JSON payloads (`cursorDispatchIntent`). Updates are written atomically to assignment and job rows in the durable orchestration store (no separate SQL migration).

| Action | Purpose |
| --- | --- |
| `begin_external_dispatch` | Record `dispatch_in_progress` before any external create call. Requires `dispatchOwnerId` (8–80 chars) and matching lease fence. Competing owners receive `409`. |
| `correlate_external` | Merge bounded `cursorAgentId` / `cursorRunId` into `externalRefs` and set intent `external_confirmed`. Requires prior `dispatch_in_progress` (or idempotent `external_confirmed` with the same fence). |
| `mark_external_dispatch_failed` | Terminal dispatch failure intent (`dispatch_failed`) before `fail`. |
| `mark_external_dispatch_outcome_unknown` | Set intent `outcome_unknown` when an external create may have succeeded but the client did not receive a confirmable response. Always pair with operator review; do not redispatch automatically. |
| `escalate_external_dispatch_recovery` | Mark assignment `ambiguous`, block the job for operator review, set intent `recovery_required`. Used for ambiguous external outcomes (crash, timeout, correlation loss). |

### Dispatch intent states

| State | Meaning |
| --- | --- |
| `not_dispatched` | Default (field omitted) |
| `dispatch_in_progress` | Durable intent recorded; external create may proceed once per owner/fence |
| `outcome_unknown` | External create outcome ambiguous (timeout, disconnect, or non-parseable success). Requires operator review before any new create. |
| `external_confirmed` | Cursor ids persisted on assignment and job |
| `dispatch_failed` | Known external dispatch failure |
| `recovery_required` | Operator review required; automatic external redispatch is blocked |

Cursor Cloud Agents API idempotent create is **not** assumed. Recovery-required assignments must not be automatically redispatched.

## Response shape

Assignment payloads may include `externalRefs` and `cursorDispatchIntent` alongside `lease` and `state`.
