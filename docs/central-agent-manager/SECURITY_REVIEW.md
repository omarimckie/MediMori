# Central Agent Manager — Security Review (M1.5)

## Scope

Read-only consolidation for five registered projects via owner-authenticated admin routes, with hardened outbound HTTPS adapters.

## Authentication and authorization

- Reuses HMAC admin session cookies (`ADMIN_SESSION_COOKIE`).
- Owner allowlist (`CENTRAL_AGENT_MANAGER_OWNER_USERNAMES`) is **required**; missing configuration fails closed (no implicit owners).
- Enforced on `/admin/central-agent-manager` and `GET /api/admin/central-agent-manager/status`.
- Feature gate `CENTRAL_AGENT_MANAGER_ENABLED` defaults off.

## Outbound destination controls (SSRF)

| Control | Implementation |
| --- | --- |
| HTTPS only | `https:` on port 443; no URL userinfo |
| Approved hosts | `CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS` must include the URL hostname |
| DNS rebinding | Resolve all records; block unsafe IPs; **re-confirm** DNS immediately before fetch; production fetch connects only to **pinned** resolved addresses with TLS `servername` set to the approved hostname |
| Redirects | `redirect: "manual"`; 3xx responses treated as failure |
| Credentials | Bearer sent only after destination validation succeeds |
| Timeouts | 8s fetch abort |

If destination safety cannot be established, adapters return **unavailable** and do not fetch.

## Credential isolation

- Per-project `CENTRAL_AGENT_MANAGER_<PROJECT>_STATUS_BEARER` env vars
- Bearer tokens never included in API responses
- Response scrubber redacts bearer fragments, database URLs, Stripe keys, webhook secrets, and blob tokens from outbound JSON
- MediMori local engineering reads use the existing control-plane DB identity only

## Data exposure controls

- Disconnected/unavailable projects expose empty task/agent/approval arrays in the UI
- Remote JSON capped at 256 KiB; unknown root keys rejected
- Fields sanitized via `bounds.ts` (bounded strings, admin-relative evidence links, capped lists)
- API responses pass through `scrubManagerStatusPayload` before leaving the server

## Threat notes

| Risk | Mitigation |
| --- | --- |
| SSRF to internal/metadata services | HTTPS + approved host list + DNS IP classification + no redirects |
| Token leakage via payloads | Schema filtering + secret scrubbing |
| Privilege escalation | Owner allowlist separate from general admin access |
| Stale data shown as live | Explicit `stale` when `lastSuccessfulUpdate` missing or aged |
| Misconfiguration open access | Empty owner allowlist denies all owners |

## Residual limitations (pre-M2)

- Approved host list is explicit configuration, not automated discovery
- No certificate pinning or mTLS to satellite endpoints
- DNS results are checked at fetch time only (no long-lived pinning)
- No audit log of owner dashboard/API access
- Polling model still exposes fetch timing side channels

## M2 prerequisites

- Documented satellite status contract and staging endpoints
- Approved hostname entries per environment
- Owner allowlist configured in deployment secrets
