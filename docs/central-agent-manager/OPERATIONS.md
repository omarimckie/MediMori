# Central Agent Manager — Operations (M1 / M1.5)

The Central Agent Manager is a read-only owner dashboard and status API. It consolidates bounded project snapshots without executing workers, models, merges, or background jobs.

## Enablement

1. Set `CENTRAL_AGENT_MANAGER_ENABLED=true`.
2. Set `CENTRAL_AGENT_MANAGER_OWNER_USERNAMES` (comma-separated or JSON array). **Required** — there is no implicit default owner.
3. Sign in through `/admin/login` using an owner username from that allowlist.

## Routes

- Dashboard: `/admin/central-agent-manager`
- Status API: `GET /api/admin/central-agent-manager/status`

Both require an authenticated admin session, a configured owner allowlist, and an owner username. Non-owners receive HTTP 403 from the API. Missing owner configuration returns HTTP 503.

## Remote status adapters (HTTPS)

Before configuring a project status URL:

1. Add the destination hostname to `CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS` (comma-separated or JSON array).
2. Set `CENTRAL_AGENT_MANAGER_<PROJECT>_STATUS_URL` to an **HTTPS** URL on port **443** without embedded credentials.
3. Optionally set a project-specific `CENTRAL_AGENT_MANAGER_<PROJECT>_STATUS_BEARER` token.

Outbound fetches:

- Validate the hostname against the approved list
- Resolve DNS and reject private, loopback, link-local, and metadata addresses
- Re-confirm DNS answers immediately before fetch; abort if answers change
- Connect only to pinned resolved addresses over HTTPS with SNI set to the approved hostname (production path)
- Use GET with a timeout, `redirect: "manual"`, and **do not follow redirects**
- Reject oversized or schema-invalid JSON (256 KiB max)

When validation fails, the project is **unavailable** and no bearer token is sent.

## Project adapters

| Project | Adapter |
| --- | --- |
| MediMori | Local read-only engineering snapshot when `ENGINEERING_CONTROL_PLANE_ENABLED=true` and `CENTRAL_AGENT_MANAGER_MEDIMORI_SOURCE` is not `http`; optional HTTPS remote status when configured |
| Other registered projects | HTTPS remote status URL + optional bearer |

Unconfigured projects remain **disconnected**; the UI hides live task/agent details.

## Connection states

- **disconnected** — no adapter URL / local engineering path configured
- **unavailable** — configured adapter failed validation or fetch
- **connected** — fresh snapshot within the stale threshold
- **stale** — connected snapshot whose `lastSuccessfulUpdate` is missing or older than `CENTRAL_AGENT_MANAGER_STALE_AFTER_MS` (default 15 minutes)

## Local demonstration checklist

1. `CENTRAL_AGENT_MANAGER_ENABLED=true`
2. `CENTRAL_AGENT_MANAGER_OWNER_USERNAMES=<your admin username>`
3. Admin login via `/admin/login`
4. Open `/admin/central-agent-manager` (also linked from the admin shell as **Agent Manager**)
5. Optional MediMori local data: `ENGINEERING_CONTROL_PLANE_ENABLED=true` with a non-production engineering database

Do not enable remote HTTPS adapters until approved hostnames and satellite endpoints are ready.

## M2B-lite mock demonstration

Set `CENTRAL_AGENT_MANAGER_MOCK_SATELLITES=true` (with manager enabled and owner allowlist) to serve **synthetic contract v1 fixtures** for all five projects. Use the dashboard **Refresh** button for manual updates (`?refresh=true`). In-memory cache TTL is **60 seconds** (mock only). See [M2B_LITE.md](./M2B_LITE.md).

## Cursor bridge runner and recovery (Phase 4B-3B)

- Homelab supervised runner: [CURSOR_BRIDGE_RUNNER.md](./CURSOR_BRIDGE_RUNNER.md)
- Owner dispatch recovery: [CURSOR_DISPATCH_RECOVERY.md](./CURSOR_DISPATCH_RECOVERY.md)
- Agent consumer contract: [AGENT_CONSUMER_CONTRACT.md](./AGENT_CONSUMER_CONTRACT.md)

Keep `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED` and `CENTRAL_AGENT_MANAGER_CURSOR_DISPATCH_RECOVERY_ENABLED` **false** in production until explicitly approved.

## Out of scope

- Worker or model execution
- Database migrations
- Cross-project approval actions
- Writes to satellite projects
