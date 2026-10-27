# Phase 5c — Cursor bridge runner architecture review

## Lifecycle trace

| Stage | Component | Status |
| --- | --- | --- |
| Owner enqueue | `queue-management-handler` → durable SQL | **Implemented** (staging proven) |
| Ready job selection | `scheduler` / consumer claim planning | **Implemented** |
| Consumer claim / lease | `agent-consumer-handler` + durable fence | **Implemented** (staging 5b) |
| Bridge dispatch intent | `begin_external_dispatch`, `correlate_external` | **Implemented** (offline + unit) |
| Cursor API transport | `cursor-cloud-api-transport` | **Implemented** with `FakeCursorCloudApiTransport` |
| Poll / terminal outcome | `cursor-bridge-polling` | **Implemented** (fake + tests) |
| Evidence + complete | consumer `submit_evidence` / `complete` | **Implemented** |
| Owner recovery | `dispatch-recovery-handler` | **Implemented** (gated flag) |
| Homelab runner process | `scripts/cursor-bridge-runner.ts` | **Implemented**, default **off** |

## Credential separation

| Credential | Holder | Purpose |
| --- | --- | --- |
| `CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON` | App host / runner → app | Consumer HTTP only |
| `CURSOR_API_KEY` | Bridge runner only | Cursor Cloud API (Phase 5d+) |
| Admin session | Owner queue / recovery | Never shared with runner bearer |

## Safety controls (existing)

- Assignment **fence tokens** on heartbeat, evidence, dispatch, complete.
- **File lock** (`FileCursorBridgeRunnerLockStore`) — single-runner hint per host; not distributed.
- **Emergency stop file** — runner aborts cycles (`cursor-bridge-runner.ts`).
- **Budget file** — daily create budget (`cursor-bridge-runner-budget.ts`); fails closed when misconfigured (tests).
- **Registry** — in-process duplicate dispatch guard per assignment id.
- **Approval** — `jobRequiresLiveOwnerApproval` blocks bridge until owner approval satisfied.

## Gaps / not production-ready

- No cross-host distributed lock; multiple VMs can still race if misconfigured.
- Durable budget **reservation** across crash is file-based, not transactional with SQL.
- Live Cursor API path not exercised in CI (by design).
- Runner **SIGTERM** handling depends on Node process signal hooks; homelab systemd must align.
- Staging orchestration branch must not host approval schema unless separately planned.

## Offline proof paths

- `cursor-bridge-offline-e2e-lifecycle.test.ts` — fake transport + durable reconstruction.
- `cursor-bridge-runner-lock.test.ts` — lock acquire/release.
- `cursor-bridge-runner-entrypoint.test.ts` — emergency stop, budget, polling bounds.
