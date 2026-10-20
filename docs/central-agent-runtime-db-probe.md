# Temporary Preview runtime database identity probe

Read-only **GET** `/api/internal/central-agent-runtime-db-probe/v1` proves which Neon branch the **running Preview lambda** uses via `getSql()` and `current_setting('neon.branch_id', true)`.

This is **temporary** acceptance tooling. Remove code and credentials after staging identity is confirmed.

## Fixed identity (not negotiable)

- Neon branch: `br-nameless-mode-b7hkls9l`
- Database name: `neondb`
- Git ref: `release/central-agent-status-minimal`

The implementation allowlist, branch-scoped expected-branch env, and SQL result must all match.

## Environment (branch Preview only — separate owner approval)

Set on **`release/central-agent-status-minimal`** only. Do **not** set on Production or global scopes.

| Variable | Value |
|----------|--------|
| `CENTRAL_AGENT_RUNTIME_DB_PROBE_ENABLED` | `true` (only during acceptance) |
| `CENTRAL_AGENT_RUNTIME_DB_PROBE_BEARER` | Sensitive random secret (generate locally; never commit) |
| `CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID` | `br-nameless-mode-b7hkls9l` |
| `CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF` | `release/central-agent-status-minimal` |

Keep **`CENTRAL_AGENT_STATUS_ENDPOINT_ENABLED=false`** and do not add `CENTRAL_AGENT_STATUS_READ_BEARER` for this milestone.

## Guards

1. Probe enabled flag exactly `true`.
2. Probe bearer env configured; otherwise **503** `{ "error": "…unavailable.", "reason": "bearer_missing" }`.
3. Valid `Authorization: Bearer …` header (never query parameters). Wrong/missing header → **401** with **no** diagnostic `reason` (does not reveal env/preflight state).
4. After authentication only — fail-closed preflight with non-secret `reason` codes:
   - `vercel_env` — `VERCEL_ENV` is not `preview`
   - `git_commit_ref` — `VERCEL_GIT_COMMIT_REF` missing or not the fixed release ref
   - `allowed_git_ref` — configured allowlist missing or not the fixed release ref
   - `expected_branch_id` — configured expected Neon branch missing or not staging
5. After authentication and preflight — `DATABASE_URL` present (trimmed non-empty); otherwise **503** `reason: "db_config_missing"` (presence only; never echo the value).
6. Read-only identity SQL via existing `DATABASE_URL`. Identity mismatch → **503** `"Branch identity mismatch."` (no `reason`). Database client init / connection / query failures → **503** `reason: "db_connect"`.

Diagnostic `reason` values never include env values, secrets, hosts, stack traces, or SQL results.

Deployment Protection stays enabled; use Vercel SSO plus bearer header.

## Safe deployment preflight (owner approval required)

- Confirm commit and Preview deployment target.
- Confirm branch-scoped staging `DATABASE_URL` override unchanged.
- Confirm Production deployment and global env unchanged.
- Redeploy Preview after env changes only when approved.

## Single acceptance request (owner approval required)

After SSO to the Preview URL:

```http
GET /api/internal/central-agent-runtime-db-probe/v1
Authorization: Bearer <probe-secret>
```

Expected **200** body:

```json
{
  "probe": "central-agent-runtime-db-identity/v1",
  "ok": true,
  "databaseName": "neondb",
  "neonBranchId": "br-nameless-mode-b7hkls9l"
}
```

## Stop conditions

- Any other `neonBranchId` or database name.
- Probe reachable on Production (`VERCEL_ENV=production` → 503).
- Authentication cannot be enforced.
- Unexpected Production deploy or global env change.

Report mismatches without sharing connection strings or bearer tokens.

## Rollback

1. Set `CENTRAL_AGENT_RUNTIME_DB_PROBE_ENABLED=false` or remove probe env vars (branch scope).
2. Redeploy Preview when approved.
3. Rotate probe bearer if exposure is suspected.

## Cleanup (owner approval required)

1. Remove branch-scoped probe env vars and rotate the dedicated bearer.
2. Create a **follow-up deletion commit** on this release branch that removes the entire probe module, route, tests, and this doc (do not merge probe code to `main`).
3. Redeploy Preview and confirm the route returns **404** (removed) or **503 disabled** if code remains briefly.
4. Before merging **PR #1**, verify the merge diff contains **no** `central-agent-runtime-db-probe` paths (`git grep`, PR file list).
5. Confirm the **Production** release will not ship probe routes or env vars; status endpoint stays disabled until separately approved.
6. Verify Production deployment and domains unchanged after cleanup redeploy.

All Vercel env changes, deploys, and live probe calls require **separate owner approval** — not part of local implementation.
