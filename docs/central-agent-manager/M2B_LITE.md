# Central Agent Manager — M2B-lite

Owner-approved scope for this increment:

| Decision | Choice |
| --- | --- |
| Polling | **Manual refresh only** (no intervals, no background jobs) |
| Caching | **Short-lived in-memory cache** (mock harness only) |
| Notifications | **None** |
| Connectivity | **Mock-only** (`CENTRAL_AGENT_MANAGER_MOCK_SATELLITES=true`) |

## Architecture

1. **Mock satellite harness** — In-repo contract v1 fixtures (`contract/fixtures-v1.ts`) drive `createMockSatelliteAdapter` for all five registered projects when mock mode is enabled.
2. **Conformance runner** — `runMockContractConformance()` and `runMockHttpAdapterConformance()` validate parser, mapper, and HTTP adapter paths without network access.
3. **Status API** — Owner-authenticated `GET /api/admin/central-agent-manager/status` with optional `?refresh=true` for manual refresh.
4. **Cache** — `buildManagerStatusWithCache()` stores responses in a process-local `Map` keyed by **owner username + configuration identity**, TTL **`CENTRAL_AGENT_MANAGER_MOCK_STATUS_CACHE_TTL_MS` (60_000 ms)**. Cache is **disabled** unless mock harness is enabled.
5. **Dashboard** — Source-status panel shows milestone, checklist, progress (or “Unknown”), blockers, approvals (read-only), and connection semantics. Mock data is labeled explicitly.

## Manual refresh

- Initial dashboard load: `GET .../status` (may return cached mock data).
- **Refresh** button: `GET .../status?refresh=true` (bypasses cache, rebuilds adapters).
- No `setInterval`, cron, or server-side scheduler.

## Cache limitations

- **Not durable** — lost on process restart.
- **Not shared** across serverless instances / horizontal scale.
- **Never caches** credentials or auth errors (auth runs before cache lookup).
- Expired entries are discarded; responses are labeled `retrieval: "cached"` with `cachedAt` when served from cache.
- Cached responses are labeled **“may not be current”** in the UI.

## Source-status UI semantics

- `progressPercent: null` or missing → **“Unknown (not reported by source)”** — never shown as 0%.
- `stale` / manager-stale connections labeled as not current.
- `disconnected` / `unavailable` → live tasks, agents, and approvals hidden.
- No approval action buttons; no notification controls.

## Security preserved

- M1.5 pinned HTTPS transport for non-mock HTTP adapters (`pinned-https-get.ts`, `rejectUnauthorized: true`).
- Approved host list, DNS reconfirmation, redirect blocking unchanged.
- Owner allowlist + admin session unchanged.

## Future real satellite conformance

1. Implement contract v1 on a **staging** endpoint (not production).
2. Add hostname to `CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS`.
3. Disable mock harness; configure per-project HTTPS URL + bearer.
4. Run manual refresh against staging; compare with `runMockContractConformance()` expectations.
5. **Deferred:** live TLS integration test against external infrastructure (requires approved staging host).

## Remaining owner decisions (M2B / M2C)

- Production polling cadence (if ever changed from manual-only).
- Production cache policy (Redis, TTL, invalidation) — **not selected**.
- Push notification triggers — **not selected**.
- Cross-project approval execution routing — **M3+**.

See also [M2B_ORCHESTRATION_DESIGN.md](./M2B_ORCHESTRATION_DESIGN.md).
