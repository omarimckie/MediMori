# Marketing dispatcher watchdog orchestration

Independent monitoring for **verified QStash primary** dispatcher health. This path is separate from `marketing-publish`, backup GitHub publish dispatch, Vercel daily publish cron, and generic dispatcher heartbeats.

## Architecture

| Component | Role |
|-----------|------|
| **QStash → `marketing-publish`** | Updates `marketing_dispatcher_qstash_primary` only after **both** `Authorization: Bearer CRON_SECRET` and a valid `upstash-signature` on the publish route (see below) |
| **`POST /api/cron/marketing-dispatcher-watchdog`** | Reads verified primary `last_seen_at`, commits 15-minute observation slots, Policy A push when eligible |
| **GitHub Actions `marketing-dispatcher-watchdog.yml`** | Scheduled `*/15 * * * *` + `workflow_dispatch`; POSTs the watchdog endpoint |
| **Healthchecks.io** | Success ping **only from GitHub Actions** after HTTP 200 + confirmed tick JSON |

GitHub schedule is **best-effort**. Runs can be delayed or queued; Postgres observation-slot deduplication remains authoritative (duplicate slots return `duplicate_slot` without double-counting).

## Disabled by default

Production must **not** process ticks until explicitly configured:

1. **Vercel** (runtime): set all of the following; keep `MARKETING_DISPATCHER_WATCHDOG_ENABLED=false` until activation prerequisites are met.
2. **GitHub** (scheduler): configure secrets/variables below; workflow can exist in repo without pinging until Vercel enables the endpoint.

Enabling the HTTP endpoint (`MARKETING_DISPATCHER_WATCHDOG_ENABLED=true`) is **not** the same as **activation** (`recordPrimaryQstashActivation` with verified QStash evidence). Until activation, observations use `ignored_not_activated` and outage pushes stay ineligible.

## Configuration

### Vercel production environment variables

| Variable | Purpose |
|----------|---------|
| `DISPATCHER_WATCHDOG_SECRET` | Bearer secret for watchdog cron only (not `CRON_SECRET`) |
| `MARKETING_DISPATCHER_WATCHDOG_ENABLED` | Must be exactly `true` to allow ticks; absent or any other value = disabled (403) |
| `MARKETING_DISPATCHER_WATCHDOG_ADMIN_USERNAME` | Admin username for `dispatcher_warning` push targets |
| `DATABASE_URL` | Neon (watchdog + QStash primary tables) |
| `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` | QStash signature verification on publish route (primary signal) |
| `QSTASH_WEBHOOK_URL` | Must match the QStash destination URL exactly (used when verifying signatures) |
| `CRON_SECRET` | Required on the publish route; QStash must send `Authorization: Bearer <CRON_SECRET>` in addition to `upstash-signature` |

**QStash destination headers:** Configure the Upstash QStash destination for `POST /api/cron/marketing-publish` with a custom `Authorization` header of `Bearer <CRON_SECRET>` (same value as Vercel `CRON_SECRET`). A valid `upstash-signature` alone does **not** pass `authorizeMarketingCron`; unsigned Vercel cron traffic cannot populate the verified QStash primary tables.

Do not commit real values. Rotate `DISPATCHER_WATCHDOG_SECRET` independently of `CRON_SECRET`.

### GitHub Actions (repository settings)

| Kind | Name | Purpose |
|------|------|---------|
| Variable | `MARKETING_DISPATCHER_WATCHDOG_BASE_URL` | HTTPS origin only (e.g. `https://twilight-feather.com`) |
| Secret | `DISPATCHER_WATCHDOG_SECRET` | Must match Vercel `DISPATCHER_WATCHDOG_SECRET` byte-for-byte |
| Secret | `HEALTHCHECKS_DISPATCHER_WATCHDOG_PING_URL` | Full Healthchecks.io ping URL (contains check token; never log) |

The publish emergency workflow uses `CRON_SECRET` and `MARKETING_PUBLISH_BASE_URL` — **do not** reuse those for the watchdog.

### Healthchecks.io

- Create a check with a grace period **longer than 15 minutes** (e.g. 20–30 minutes) to absorb GitHub schedule jitter and occasional slow ticks.
- Alert when pings stop; a successful ping means the last workflow run received HTTP 200 with `ok: true` and a valid `outcome` / `observationSlotId` (durable tick processed).
- Failed HTTP (401/403/500), timeouts, malformed JSON, or missing confirmation **do not** ping.

**What a Healthchecks success ping does not mean:** it is not proof that `marketing-publish` executed, that verified QStash primary heartbeats are fresh, that an outage was detected, or that admin phone/web push was delivered. It only confirms that GitHub Actions completed a watchdog HTTP tick that the server durably processed (including `ignored_not_activated` before production activation).

### Default branch and GitHub Actions

Pushing `.github/workflows/marketing-dispatcher-watchdog.yml` to the **default branch** registers the `*/15 * * * *` schedule with GitHub. Scheduled runs begin once repository Actions are enabled and secrets/variables are set — even if Vercel still returns **403** (disabled endpoint). Disable the workflow under **Actions → Marketing dispatcher watchdog** until Vercel configuration and `recordPrimaryQstashActivation` are complete.

## Activation prerequisites (production)

1. Apply schemas on production Neon in order: incidents (and linkage if needed) → [QStash-primary migration](marketing-dispatcher-qstash-primary-schema-migration.md) → [watchdog migration](marketing-dispatcher-watchdog-schema-migration.md) (both guarded; operator-authorized).
2. Deploy application code with verified QStash primary heartbeat on `marketing-publish` (signature + `Authorization: Bearer CRON_SECRET`).
3. Confirm at least one row in `marketing_dispatcher_qstash_verified_deliveries` and a fresh `marketing_dispatcher_qstash_primary.last_seen_at` (see snapshot below).
4. Record activation via the guarded operator script (calls `recordPrimaryQstashActivation` — **not** raw SQL).
5. Set Vercel env vars; set `MARKETING_DISPATCHER_WATCHDOG_ENABLED=true` only when ready.
6. Configure GitHub variables/secrets; **disable** the watchdog workflow until steps 4–5 are complete; enable schedule only after owner approval.

### Guarded QStash primary activation (operator)

**STOP** if any prerequisite schema is missing, if no verified delivery exists, if `last_seen_at` is absent, or if the primary heartbeat is older than **30 minutes** (same window as watchdog primary stale threshold).

Required environment variables (never commit real values):

| Variable | Purpose |
|----------|---------|
| `MARKETING_DISPATCHER_WATCHDOG_ACTIVATION_AUTHORIZED` | Must be `execute` to mutate |
| `MARKETING_DISPATCHER_WATCHDOG_ACTIVATION_DATABASE_URL` | Dedicated Postgres URL (not `DATABASE_URL`) |
| `MARKETING_MIGRATION_EXPECTED_PG_HOST` | Exact hostname guard |
| `MARKETING_MIGRATION_EXPECTED_PG_DATABASE` | Exact database name guard |
| `MARKETING_DISPATCHER_WATCHDOG_ACTIVATION_DRY_RUN` | `report` — offline config report, no DB connection |

Evidence is **derived from the database only** (`verificationKind: qstash_signature_verified`, `verifiedAt` from `marketing_dispatcher_qstash_primary.last_seen_at`, `attestationId` from the latest `marketing_dispatcher_qstash_verified_deliveries.jti` at or before that timestamp). Operators cannot supply arbitrary JTIs or timestamps.

**Dry-run (safe, offline):**

`MARKETING_DISPATCHER_WATCHDOG_ACTIVATION_DRY_RUN=report npx tsx scripts/execute-marketing-dispatcher-watchdog-activation.mjs`

**Read-only readiness snapshot** (connects read-only; no activation authorization required):

`MARKETING_DISPATCHER_WATCHDOG_ACTIVATION_SNAPSHOT=report` plus the dedicated URL and expected host/database variables → `npx tsx scripts/report-marketing-dispatcher-watchdog-activation-snapshot.mjs`

Snapshot JSON reports table presence, delivery count, heartbeat age/freshness, `primary_qstash_activated_at`, and `activationPending`. It never prints connection strings, signing keys, or `CRON_SECRET`.

**Authorized execute** (owner approval only):

Set all execute variables, then `npx tsx scripts/execute-marketing-dispatcher-watchdog-activation.mjs`. On success, re-run the snapshot and confirm `activationPending: false` and `primaryQstashActivatedAt` set.

CLI failures print a sanitized `code` only (no URLs or secrets).

## Manual testing (controlled)

1. Set Vercel preview/staging with test DB **or** use `workflow_dispatch` against an environment where the endpoint is enabled and secrets match.
2. `curl -X POST` with `Authorization: Bearer $DISPATCHER_WATCHDOG_SECRET` and optional `x-github-run-id` / `x-github-run-attempt` (numeric only).
3. Expect **403** when disabled; **401** when secret wrong; **200** with `{ "ok": true, "outcome": "...", "observationSlotId": <int>, ... }` when enabled and configured.

Do not enable production monitoring or Healthchecks until activation is complete.

## Rollback

1. Set `MARKETING_DISPATCHER_WATCHDOG_ENABLED` to `false` (or remove) on Vercel — endpoint returns 403 immediately (no DB/push).
2. Disable or delete the GitHub workflow schedule in repo settings / remove workflow file on next deploy.
3. Pause or delete the Healthchecks check.
4. Publishing (`marketing-publish`, QStash, Vercel publish cron) is unchanged by watchdog rollback.

## Related code

- Handler: `src/lib/marketing/reliability/dispatcher-watchdog/handle-marketing-dispatcher-watchdog-cron.ts`
- Route: `src/app/api/cron/marketing-dispatcher-watchdog/route.ts`
- Workflow: `.github/workflows/marketing-dispatcher-watchdog.yml`
