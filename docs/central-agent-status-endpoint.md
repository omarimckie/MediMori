# Central agent status endpoint (minimal release)

Read-only `GET /api/internal/central-agent-status/v1` implementing `central-agent-status/v1`.

This release branch (`release/central-agent-status-minimal`) is isolated from the unfinished engineering control-plane feature branch. It uses `src/lib/central-agent-status/read-model.ts` (`listTasksForStatus`) instead of the full engineering store.

## Security

- Disabled unless `CENTRAL_AGENT_STATUS_ENDPOINT_ENABLED=true`.
- Requires `Authorization: Bearer <CENTRAL_AGENT_STATUS_READ_BEARER>`.
- GET only; no mutations.

## Semantics

- `lastSuccessfulUpdate`: ISO time the snapshot was generated.
- `lastMeaningfulStateChange`: latest task/run activity; drives source `reportingStatus` staleness.
- `activeAgents`: worker runs with active lease only (`worker_enabled` + `lease_until > now()`).

## Staging database

Apply `sql/central-agent-status-staging-schema.sql` on a dedicated Neon staging branch before enabling the endpoint with live data.

## Environment (staging)

- `CENTRAL_AGENT_STATUS_ENDPOINT_ENABLED`
- `CENTRAL_AGENT_STATUS_READ_BEARER`
- `ENGINEERING_CONTROL_PLANE_ENABLED=true`
- `DATABASE_URL` (staging branch only)
