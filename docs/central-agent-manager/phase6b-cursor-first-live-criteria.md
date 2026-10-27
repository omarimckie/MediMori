# Cursor runtime adapter — first live call criteria (WP11)

## Modes

| Mode | Status |
| --- | --- |
| `disabled` | Default production posture |
| `fake_transport` | Supported offline (runner + mock specialist) |
| `local_sdk` | Blocked until owner enables adapter and workspace ownership is verified |
| `cloud_api` | Blocked until owner enables adapter, budget reservation, and emergency stop path |

## Manager prerequisites before first bounded real worker

1. `CAM_CURSOR_EXECUTION_ADAPTER_ENABLED=true` with explicit owner approval record on the objective execution record.
2. Durable objective persistence approved (not only in-memory JSON snapshots).
3. Runner `liveStore` + durable consumer backend validated on NUC13 homelab dry-run.
4. Specialist template `fakeTransportOnly: false` override approved per role.
5. Budget file healthy; daily create slot reserved before `createRun`.
6. Correlation via consumer `correlate_external` with `cursorAgentId` / `cursorRunId` stored on the job.
7. Evidence artifact path required before assignment `complete`.
8. Cancellation must not mark CAM assignment completed without terminal job transition.

## Acceptance checklist (supervised)

- One objective, one engineering task, cost cap ≤ owner grant.
- Emergency stop file tested mid-run.
- Post-run SQL job row `completed` with evidence IDs matching store reload.
