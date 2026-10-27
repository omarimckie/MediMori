# M2B Orchestration Design (not implemented)

This document outlines options for the next orchestration layer. **No production cadence or notification policy is selected here** — owner approval is required before implementation.

## Polling frequency

| Option | Cadence | Tradeoffs |
| --- | --- | --- |
| A. Manual refresh only | On dashboard load + owner click | Lowest risk and cost; stale until refreshed |
| B. Low cadence background poll | e.g. 5–15 minutes | Better freshness; multiplies outbound HTTPS fetches across five projects |
| C. Per-project adaptive | Faster for `live`, slower for `disconnected` | More complex; needs explicit rules per `reportingStatus` |

**Recommendation for owner decision:** Start with **A** in staging, evaluate **B** with approved hosts only after contract v1 satellites exist.

## Cache TTL and invalidation

| Option | Behavior | Tradeoffs |
| --- | --- | --- |
| A. No server cache | Every API hit refetches adapters | Simplest; duplicates poll cost |
| B. In-memory TTL cache | e.g. 60–120s per project | Reduces duplicate fetches; must invalidate on owner refresh |
| C. ETag / If-None-Match from satellites | Conditional GET when satellites support it | Requires satellite contract extension (not v1) |

Invalidation triggers to define: owner manual refresh, successful approval action (future), engineering task state change (MediMori local adapter).

## Failure isolation

- **Per-project adapter failures** must not fail the consolidated API (current behavior: `unavailable` per project).
- **Owner API** should always return all five registry entries with explicit connection state.
- Optional circuit breaker: after N consecutive fetch failures, stop polling a project for M minutes until manual refresh (not implemented).

## Deduplication and correlation

Future cross-project views may need:

- Correlation keys on `workItems` / approvals (contract v2 candidate).
- Deduplication of identical approval summaries across projects (manager-derived, must be labeled derived).
- MediMori engineering task ids remain separate from satellite `workItems` unless explicitly linked in source data.

## Owner push notifications (future)

| Option | Trigger | Tradeoffs |
| --- | --- | --- |
| A. None | — | Safest for M2B |
| B. Digest on new pending approvals | Count increase vs last owner view | Requires stored owner baseline; privacy-sensitive |
| C. Real-time web push | On any `pendingApprovals` change | Reuse marketing web-push infra; must not leak cross-project secrets |

Notifications must remain **owner-gated** (same allowlist as dashboard) and must not include bearer tokens or raw satellite JSON.

## Pending approval actions (future)

- **Read-only M2A/M2B:** dashboard shows `pendingApprovals` only as reported.
- **Execution (M3+):** each project keeps its own approval API and credentials; manager acts as a router, not a shared approval store.
- Options: deep-link to project admin vs proxied POST with per-project scoped tokens (higher risk; requires security review).

## Dependencies before M2B implementation

1. Contract v1 implemented on at least one staging satellite endpoint.
2. Approved hostname entries per environment.
3. Owner decision on polling option (A/B/C) and cache option (A/B/C).
4. Notification option (A/B/C) if any automated alerts are desired.
