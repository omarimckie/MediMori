# Marketing incidents (Phase I foundation)

Marketing Autopilot owns the **canonical source incident**. A separate agent system will later own linked execution work via `AgentWorkBridge` (not implemented in Phase I).

## Invariants

1. **Per-resource incidents** — one canonical incident per failed resource/publication; `batch_id` / `finalize_key` are correlation columns/evidence, not a replacement incident.
2. **Persistence before notification/bridge** — future phases must commit incidents before Web Push or agent submission. Notification/bridge failure must not delete incidents.
3. **Phase 2A safety** — the incident subsystem records authorization envelopes; it does **not** decide Meta retry safety and must not bypass publication guards.
4. **Closed authority** — `permitted_actions` and `retry_safety` are closed enums; unknown values fail closed at parse time in application code. Postgres CHECK constraints mirror the same closed sets for scalar enums; `permitted_actions` is validated on write/read in application code (JSONB array).
5. **No agent execution in Marketing** — no engineering task queue, worker leases, or agent credentials in this repo.

## Incident type naming rules

| Category | Rule |
|----------|------|
| **Operational system failure** | Use closed `incident_type` values (publication, credential, dispatcher, Smart Upload server failures). |
| **User input / validation** | Expected mistakes (e.g. unsupported image dimensions, missing caption fields) are **not** operational incidents unless escalated to `smart_upload_operational_failed` for unexpected server-side faults only. |
| **Vocabulary** | Reuse notification-aligned names where possible (`publication_ambiguous`, `publication_overdue`, etc.). |

Reserved roadmap types (not wired in Phase I): `publication_stuck_processing`, `publication_recovery_required`, `smart_upload_caption_failed`, `smart_upload_finalize_failed`, `smart_upload_operational_failed`.

## Concurrency (Postgres)

`recordIncident` on `createPostgresIncidentRepository()` runs in a **single DB transaction**:

1. `INSERT … ON CONFLICT (dedupe_key) DO NOTHING` for first writer wins.
2. On conflict, `SELECT … FOR UPDATE` by `dedupe_key` then atomic `UPDATE` with `incident_version` check and `GREATEST(last_seen_at, …)`.
3. Incident events are inserted in the **same transaction** as row changes.

In-process `withIncidentDedupeLock` is an optimization for memory/tests only; correctness across Vercel instances depends on Postgres.

## `incident_version` semantics

`incident_version` increments on every persisted change to the canonical incident row (create starts at `1`; occurrence, status change, resolution, and reopen each bump via `UPDATE`). Future `AgentWorkBridge` should use `(incident_id, incident_version)` for idempotent work submission.

## `agent_work_correlation_id`

Generated **once** at incident creation. Recurrence, reopen, and lifecycle transitions **must not** change it.

## Event immutability

The repository exposes **append-only** event APIs (no update/delete). `ON DELETE CASCADE` from `marketing_incidents` → `marketing_incident_events` simplifies dev/test cleanup if an incident row is deleted manually; **production should not delete canonical incidents** casually. Prefer retention policies and leaving incidents resolved. Changing to `RESTRICT` is a future option if hard audit retention is required.

## Schema

Apply locally when intended (**not** applied to production in Phase I):

```bash
npm run marketing:schema:incidents
```

Tables: `marketing_incidents`, `marketing_incident_events`.

## Lifecycle

Statuses: `open`, `investigating`, `action_required`, `blocked`, `resolved`.

`resolved → open` only via `recordIncident({ reopenIfResolved: true })`, not via `transitionIncidentStatus`.

## Recurrence / dedupe

- **Non-resolved** same `dedupe_key`: increment `occurrence_count`, `last_seen_at` (never backward), append `occurrence_recorded`; lifecycle/authorization unchanged.
- **Resolved** same `dedupe_key`: `IncidentDedupeResolvedError` unless `reopenIfResolved: true`.

## Sanitization trust boundary

Heuristic redaction only — not perfect secret detection. See `sanitize-adversarial.test.ts`.

## Phase I scope

Schema, types, memory + Postgres repositories, `recordIncident`, lifecycle helpers, tests. **Not wired:** publish pipeline, reliability sweep, Smart Upload, notifications, Web Push, morning brief, `AgentWorkBridge`.

## Typecheck hygiene

Full `npm run typecheck` may include local `_wt-*` worktree copies under the repo root (`tsconfig.json` includes `**/*.ts`). Use `npm run typecheck:app` to verify the main application tree excluding those artifacts (proposed hygiene; does not change production Vercel build until root `tsconfig` is adjusted separately).

## Future event types (reserved, not implemented)

`notification_sent`, `agent_work_submitted`, `agent_investigation_started`, `agent_action_attempted`, `agent_action_succeeded`, `agent_action_failed`, `owner_approval_requested`, `owner_approved`, `owner_rejected`.

## Phase III-A (lifecycle + notification linkage)

Apply notification linkage migration locally when intended (**not** applied to production until an explicit deploy step):

```bash
npm run marketing:schema:incidents-notification-linkage
```

Adds nullable `marketing_admin_notifications.related_incident_id` → `marketing_incidents(id)` with a partial index on non-null values.

Admin lifecycle APIs (Marketing Admin auth required) list/get incidents, transition status, and resolve with optimistic `incidentVersion` concurrency. **Resolving an incident does not mutate publication state, ambiguity, or retry safety.**

New incident-associated notifications must set `relatedIncidentId` when durable incident record/re-observation succeeded. Incident persistence is never dependent on notification success.

### Phase III-A4 (auto-resolution bookkeeping)

- **Eligible types only:** `publication_overdue`, `publication_stuck_processing`.
- **Never auto-resolved:** `publication_ambiguous`, `publication_recovery_required`.
- **Affirmative evidence only:** reconciliation loads the publication row and applies policy (not “absent from detection SQL”).
- **Stuck policy:** while `status === processing`, stuck incidents stay open even if `updated_at` is fresh.
- **Blockers:** unresolved manual incidents on the same `publication_id`, plus row-level ambiguity/recovery signals (ambiguity state, inflight sentinel, provider creation without external id / Instagram recovery predicate).
- **Missing publication row:** skip + log (no auto-resolve).
- **Resolution:** `auto_recovered` via `resolveIncident`; **no** new admin notification or Web Push.
- **Recurrence:** existing `reopenIfResolved` preserves incident id and `agent_work_correlation_id`.
- **Clock:** isolated reliability work runs after `publishDue` on **cron_secret** `POST /api/cron/marketing-publish` only (no new scheduler). Publishing success is not downgraded if reliability fails.

### Deferred follow-up (not Phase III-A)

Revisit notification taxonomy after Phase III-A: evaluate adding a dedicated `publication_stuck_processing` **notification** type instead of representing stuck processing as `publication_ambiguous` in Web Push/history (incidents remain correctly typed `publication_stuck_processing`).
