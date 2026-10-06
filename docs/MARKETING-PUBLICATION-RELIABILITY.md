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

## Schema

Apply locally / to an environment (not production unless you intend to):

```bash
npm run marketing:schema:reliability
```

Tables: `marketing_dispatcher_heartbeats`, `marketing_reliability_dedup`.

## Stale processing reclaim (unchanged)

The publisher still reclaims `processing` rows after **15 minutes** (`claimPublication` in Postgres). Phase 1 alerts at **25 minutes** — reclaim may run before the ambiguous alert. Treat duplicate risk as a Phase 2 concern.
