# Cursor dispatch recovery (owner-only)

When external Cursor dispatch becomes **ambiguous** (`recovery_required` / `outcome_unknown`), the bridge stops automatic redispatch. Owners resolve assignments through a narrow recovery API.

## Enablement (non-production by default)

```
CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED=true
CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED=true
CENTRAL_AGENT_MANAGER_CURSOR_DISPATCH_RECOVERY_ENABLED=true
```

Recovery remains **503** unless all flags are true and the caller is an authenticated owner.

## API

Route: `GET|POST /api/admin/central-agent-manager/dispatch-recovery`

### GET

Returns `recoveryRequired` projections (read-only): assignment/job state, dispatch intent, lease fence, audit count.

### POST actions

| Action | Purpose |
| --- | --- |
| `confirm_verified_external_ids` | Owner supplies **verified** `cursorAgentId` + `cursorRunId`; assignment returns to `active` with `external_confirmed` intent for poll-only resume. |
| `fail_external_dispatch` | Marks dispatch failed; job moves to `cancelled` (no generic reset-to-ready). |
| `cancel_external_dispatch` | Owner cancellation; assignment `released`, job `cancelled`. |

Each action appends a durable `cursorDispatchRecoveryAudit` record on the assignment JSON (no new SQL migration).

## Safety rules

- No generic reset-to-ready.
- No unverified replacement Cursor agent (conflicting stored ids are rejected).
- Protected jobs with `owner_approval_required` and no `approvalBinding` cannot be recovered.
- Mutations persist through fence-conditioned `updateAssignmentWithJobIfFence` on the durable store.
- Recovery does **not** invoke Cursor create; the bridge resumes with polling only after confirm.

## Operator workflow

1. Inspect `GET` recovery list in the owner admin session.
2. Verify Cursor agent/run ids out-of-band (Cursor dashboard or support).
3. `confirm_verified_external_ids` with `auditId` for traceability.
4. Restart or resume the supervised bridge runner; cycle should set `externalCreatePerformed: false`.
