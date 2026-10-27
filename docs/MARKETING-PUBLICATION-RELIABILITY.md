# Marketing publication reliability (Phase 1)

## Schedulers

| Role | Mechanism |
|------|-----------|
| **Primary** | Upstash **QStash** — `POST /api/cron/marketing-publish` about every **10 minutes** (configured in Upstash, not in this repo). |
| **Manual / emergency** | GitHub Actions workflow `marketing-publish-dispatch.yml` — **`workflow_dispatch` only**. |
| **Last-resort publish fallback** | Vercel daily cron — `vercel.json` → `0 16 * * *` UTC → same publish endpoint. |

## Dispatcher heartbeat

On each **authorized** call to `POST /api/cron/marketing-publish`, the app upserts `marketing_dispatcher_heartbeats` using **conservative** source values:

| Source | When recorded |
|--------|----------------|
| `admin` | Marketing Admin session authenticated the request (e.g. “Publish due” in the UI) |
| `authenticated_cron` | Valid `Authorization: Bearer CRON_SECRET` (QStash, Vercel daily cron, GitHub manual dispatch, or any other bearer caller) |
| `unknown` | Not written to heartbeat rows in normal flow; returned only when resolving source for an unauthorized request (no heartbeat upsert) |

Phase 1 does **not** label heartbeats `qstash`, `vercel`, or `github` from request headers — those identifiers are not cryptographically verified.

Heartbeat updates even when `published: 0`. **Unauthorized requests do not write heartbeats.**

A heartbeat proves the **application** accepted an authorized publish-dispatcher call — not which external scheduler ran, and not that QStash is healthy. Independent QStash monitoring is out of scope for Phase 1.

## Reliability sweep

`POST /api/cron/marketing-reliability` (same cron/admin auth as publish):

- Detects **overdue** scheduled publications (`scheduled_for` at least **20 minutes** ago).
- Detects **stuck processing** (`processing` with `updated_at` at least **25 minutes** ago) → `publication_ambiguous` notifications.
- Sends deduplicated Marketing Admin notifications + Web Push broadcast.
- Does **not** publish, retry, reclaim, or change publication status.

**QStash is not configured to call this endpoint in Phase 1** — wire it when ready.

Phase III-A4 additionally runs the same reliability sweep (detection + incident auto-reconciliation) **after** `publishDue` on bearer `CRON_SECRET` calls to `POST /api/cron/marketing-publish` only. Admin-session “Publish due” does not trigger reliability. Reliability failures are logged and do not change publish HTTP success semantics. Stuck-processing notifications remain type `publication_ambiguous` (taxonomy change still deferred).

## Schema

Apply locally / to an environment (not production unless you intend to):

```bash
npm run marketing:schema:reliability
```

Tables: `marketing_dispatcher_heartbeats`, `marketing_reliability_dedup`.

## Phase 2A — Ambiguous publication safety barrier

Phase 2A prevents **automatic** Meta republication when the outcome may have succeeded. It does **not** reconcile Meta (Phase 2B) and does **not** add owner reconciliation UI (Phase 2C).

### Schema (`marketing_publications`)

Apply locally when ready (not part of routine deploy unless you intend to):

```bash
npm run marketing:schema:publication-ambiguity
```

| Column | Purpose |
|--------|---------|
| `ambiguity_state` | `none` \| `ambiguous` \| `owner_required` |
| `claim_token` | Active processing claim; required to finalize provider outcomes |
| `processing_started_at` | When the current claim began |
| `provider_creation_id` | Instagram container id (or transient `__publish_inflight__` sentinel during atomic provider entry) |

### `__publish_inflight__` sentinel (not a Meta id)

- Internal **atomic provider-entry latch** only; it is **not** an Instagram/Facebook container or post id.
- Set by `tryBeginProviderPublish` before the provider publish call; Instagram may replace it with a real container id via claim-aware `persistProviderCreationId`.
- **`processing` + inflight** after a crash is intentionally **not** automatically republished: `publishDue` ignores `processing`, and Phase 1 reliability alerts the owner after ~25 minutes. Phase 2B will add reconciliation/recovery; until then, owner review is required.

### Cron safe-retry proof (`[cron_safe_retry:v1]`)

- Appended to `last_error` **only** when the Phase 2A classifier returns **confirmed_failure** and the failure is Meta retryable (Instagram/Facebook).
- Legacy `[cron_auto_retryable]` and bare `transient` text in old rows are **not** sufficient for automatic cron retry.
- **Ambiguous** outcomes replace `last_error` **without** the v1 proof (`formatPublicationFailureLastError(..., false)`).
- The v1 marker is **not** a general admin-editable field: direct DB mutation of `last_error` is privileged and could forge retry eligibility—treat publication retry columns as operational data, not UI text.

### Claim ownership

`claimPublication` sets a new `claim_token` and `processing_started_at`. Provider results are saved only through `finalizePublicationClaim` (matching token). Stale workers cannot overwrite a newer claim.

**Lost-claim provider success:** If Meta returns success but `finalizePublicationClaim` no longer matches, the worker must **not** call generic `updatePublication` to force `published`. Reload the row: return authoritative published state if present; otherwise retry claim-aware finalize only; if still unsafe, persist `ambiguous` via claim-aware finalize (or leave the row unchanged and log evidence).

**Single provider entry per claim:** `tryBeginProviderPublish` atomically sets `provider_creation_id = '__publish_inflight__'` when null (Postgres `WHERE` includes matching `claim_token`, `status = processing`, `ambiguity_state = none`). Only one concurrent invocation can enter the Meta publish path per claim; Instagram later replaces the sentinel with the real container id via `persistProviderCreationId`.

**Stale `processing` rows are not reclaimed for a new Meta attempt** (the old 15-minute SQL reclaim branch was removed). Stranded `processing` may still be detected by the Phase 1 reliability sweep at **25 minutes**; Phase 2A also marks stale re-entry as `owner_required` when appropriate.

### Safe vs ambiguous failures

- **Confirmed failure** (preflight, credentials, auth, permissions, clear validation errors before/at provider with proof of failure): normal `failed` state; **cron auto-retry** may apply when `last_error` includes structured proof `[cron_safe_retry:v1]` (stamped only for new Phase 2A+ confirmed-safe retryable failures) and `ambiguity_state = none`.
- **Ambiguous outcome** (network/transport after provider interaction may have started, timeouts, retryable HTTP errors, IG container timeout, lost finalize claim, etc.): `ambiguity_state = ambiguous` or `owner_required`, **no** safe-retry proof, **no** automatic Meta retry.

Legacy failed rows without ambiguity columns default to `none` at read time. **Pre-2A** `last_error` markers such as `[cron_auto_retryable]` or bare `transient` text are **not** sufficient for cron retry. Rows with a persisted (non-inflight) `provider_creation_id` are blocked from cron retry even if `ambiguity_state` is `none`.

### Guards

- **`publishDue`**: does not select `processing`; skips failed rows that are blocked (ambiguous / provider evidence).
- **`publishPublication`**: will not call Meta on a `processing` object without the current `claim_token`.
- **`scheduleApproved`**: refuses `processing` / ambiguous / `owner_required` publications.
- **Admin retry API**: returns `409 publication_retry_blocked` for `processing`, `ambiguous`, or `owner_required`.

### Notifications

When a publication enters an ambiguous state, Phase 2A sends a deduplicated `publication_ambiguous` notification (dedupe key `publication_ambiguous:outcome:v1:{id}`) via the Phase 1 reliability notification path. Notification failures are logged only and never trigger Meta.

### Instagram

Container id is persisted to `provider_creation_id` immediately after creation and before polling/`media_publish`. If persistence fails after Meta created a container, the outcome is **ambiguous** (no v1 cron proof, no automatic retry, admin retry blocked)—publishing stops without calling `media_publish`.

### Rollback safety

After Phase 2A has written `ambiguity_state`, `claim_token`, or persisted `provider_creation_id` evidence, rolling the application back to pre-2A code is **unsafe**: older code ignores those fields and may auto-retry or overwrite outcomes. Handle production rollback separately (freeze publishing, migrate forward, or run reconciled cleanup).

### What Phase 2A does not do

- No Facebook/Instagram reconciliation queries
- No container resume worker
- No owner reconciliation or Retry UI
- No QStash / GitHub / Vercel schedule changes
