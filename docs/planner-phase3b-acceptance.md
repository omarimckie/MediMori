# Planner Phase 3B — Staging acceptance record

**Branch:** `integration/twilight-feather-add-to-planner`  
**Application code under test:** `baf3d75395f49562410a3d6507266399ce6771c6` (fix: server-tagged metadata updates on planner queue)  
**Rollback deploy (read-only restored):** `4daa3d00044d3ae764db7b21b7e18853047c10bb`  
**Staging Neon:** `small-frost-27394379` only  
**PR:** [#17](https://github.com/omarimckie/MediMori/pull/17) — OPEN, unmerged  
**Production:** unchanged  

## Phase 3B write window

- Writable Preview: `https://medi-mori-38hos81p6-omarimckies-projects.vercel.app` (armed window)
- Fixture batch: `5845e01f-bd6e-49d8-b67b-419fc91027d5`
- Mock mode: confirmed **true** (owner + Vercel branch env)

## Owner browser acceptance (live Preview)

| Test | Result |
|------|--------|
| Fixture creation (HTTP 200) | **PASS** |
| Smart Upload IG + FB add to planner (UI: 2 items) | **PASS** |
| Both visible in Planning queue | **PASS** |
| Queue refresh / persistence | **PASS** |
| Remove smartFacebook from queue | **PASS** |
| Assign smartInstagram to week `2026-05-12` | **PASS** |
| Assignment UI (“Change week”) | **PASS** |
| No publishing performed | **PASS** |
| smartInstagram remains in Planning queue after week assign | **Observed — by design** (see below) |
| Negative control browser cases | **NOT RUN** |

### Planning queue after week assignment

Assign-week sets `weeklyPlanId` and does **not** clear `plannerQueuedAt`. The queue view includes explicit planner members regardless of week assignment until schedule/publication or exclusion. Covered by `content-planner-queue.test.ts` (“week assignment after enqueue preserves planner metadata”). This is **documented current behavior**, not a release blocker.

## Cleanup and baseline

Server batch cleanup (`cleanupPlannerE2eStagingFixtures`, batch `5845e01f-bd6e-49d8-b67b-419fc91027d5`):

| Resource | Deleted (first pass) |
|----------|----------------------|
| Content | 7 |
| Publications | 2 |
| Weekly plans | 1 |
| Campaigns | 1 |
| Assets | 1 |

Second cleanup pass: **idempotent** (no additional deletes).

Post-cleanup Neon counts: **0** across `marketing_content`, `marketing_publications`, `marketing_weekly_plans`, `marketing_campaigns`, `marketing_assets`.

## Rollback verification (owner authenticated)

Restored Preview: `https://medi-mori-kwod0rn2p-omarimckies-projects.vercel.app`

| Check | Result |
|-------|--------|
| Settings GET | **200 PASS** |
| Database identity GET | **200 PASS** |
| Planner queue GET | **200 PASS** |
| Add to Planner POST | **403 PASS** |
| Remove from Planner POST | **403 PASS** |
| Assign week POST | **403 PASS** |
| Fixture creation POST | **403 PASS** |
| Fixture cleanup POST | **403 PASS** |

**Post-rollback HTTP: 8/8 PASS.** Mock mode confirmed true.

Vercel branch Preview env restored: `MARKETING_PREVIEW_READONLY=true`, `MARKETING_PLANNER_STAGING_E2E` removed.

## Engineering / prior staging evidence

- Engineering validation: **SUCCESS** on `baf3d75` and subsequent redeploy commits.
- Staging persistence matrix (`scripts/planner-phase3-staging-persistence-e2e.ts`): **25/25 PASS** on live Neon (Phase 3).
- Defect fixed in `baf3d75`: preserving server `e2eTag` on metadata patches (planner queue updates).

## Release readiness summary

| Gate | Status |
|------|--------|
| Functional (add/remove/assign/pair, live browser) | **PASS** |
| Staging persistence / cleanup | **PASS** |
| Security (staging identity, gates, mock, ownership) | **PASS** |
| Operational (rollback, baseline, readonly) | **PASS** |
| Negative browser controls | **NOT RUN** (documented gap) |
| Live cleanup HTTP (owner) | **NOT RUN** (server batch cleanup **PASS**) |

**Recommendation:** **GO** for merge decision on PR #17 (owner merge when ready). PR remains **open** until explicitly merged; no production deploy from this record.