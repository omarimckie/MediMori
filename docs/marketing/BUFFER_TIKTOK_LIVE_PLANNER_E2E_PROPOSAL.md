# Proposal: narrowly scoped live Planner TikTok E2E (not executed in 4E.2-B)

## Goal

Validate **one** owner-authorized live Buffer submission from Planner scheduling in an **isolated writable** Preview deployment (staging Neon only), separate from the mock-only Planner E2E framework.

## Preconditions

- Branch pinned to integration/staging policy with `MARKETING_PLANNER_STAGING_E2E=true` for mutations only.
- `MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE=controlled` with a **pre-created** publication id.
- `MARKETING_BUFFER_TIKTOK_LIVE=true` for the test window only.
- Staging Neon identity guard (`small-frost-27394379`); production Neon explicitly rejected.
- Dedicated admin session cookie; no broad cron or `marketing-publish` HTTP allowlist changes.

## Steps (single run)

1. Create server-owned fixtures (`POST /api/admin/marketing/planner-e2e/fixtures`).
2. Schedule the tagged TikTok image fixture through existing schedule APIs.
3. Set controlled publication id to the scheduled publication uuid.
4. Invoke `publishDue` or admin retry once (not production cron).
5. Assert `externalId` present and publication remains non-`published` until reconciliation (Buffer defer policy).
6. Cleanup batch via `POST /api/admin/marketing/planner-e2e/cleanup`.

## Out of scope for automation

- Repeated live runs without human approval.
- Production or shared staging accounts used for organic content.
- Bypassing activation gates or LIVE checks.

This proposal is documentation only until CAM approves an owner-authorized run window.