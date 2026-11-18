# Planner Phase 3 — Add to Planner staging E2E

## Preview (read-only baseline)

- URL: https://medi-mori-h1txik68i-omarimckies-projects.vercel.app
- Branch: `integration/twilight-feather-add-to-planner`
- Staging Neon: `small-frost-27394379` only (never `solitary-leaf-77946642`)

## Owner authorization checklist

1. Set `MARKETING_PLANNER_STAGING_E2E=true` on integration-branch Preview.
2. Set `MARKETING_PREVIEW_READONLY=false` for the write window only.
3. Redeploy integration Preview and wait for Ready.
4. Confirm `MARKETING_MOCK_MODE=true` and staging identity route returns allowlisted project.
5. Approve disposable staging mutations (fixtures + planner matrix).
6. After cleanup, restore `MARKETING_PREVIEW_READONLY=true` and unset/false `MARKETING_PLANNER_STAGING_E2E`.
7. Redeploy and verify planner POST endpoints return HTTP 403.

## Execution sequence (≤ 60 minutes)

1. **Preflight (read-only):** Login, open marketing admin, confirm read-only banner off only after step 2. GET identity, mock mode, negative POST to `add-to-planner` → 403 while readonly.
2. **Arm E2E:** Apply env toggles, redeploy, confirm armed gate (scope + mock + staging Neon).
3. **Fixtures:** `POST /api/admin/marketing/planner-e2e/fixtures` — save `batchId` and `contentIds` from response.
4. **Add to planner:** Queue `instagram`, `facebook`, smart pair via `add-to-planner`; verify `GET /api/admin/marketing/planner/queue`.
5. **Remove:** `remove-from-planner` for one id; confirm queue update.
6. **Assign week:** `assign-week` for tagged ids; confirm calendar/week view.
7. **Smart Upload pair:** Confirm paired IG/FB share finalize key in metadata.
8. **Negatives:** Attempt mutate `scheduledControl` / `publishedControl` and untagged ids → 403/400.
9. **Cleanup:** `POST /api/admin/marketing/planner-e2e/cleanup` with `{ "batchId": "<uuid>" }`.
10. **Restore:** Readonly + disable E2E flag, redeploy, verify 403 on planner mutations.

## Browser runbook (owner)

1. Open Preview URL (logged-in admin).
2. Verify read-only state matches phase (on before writes, off during window).
3. DevTools or REST client: create fixtures via planner-e2e/fixtures endpoint.
4. Marketing → Planner queue: refresh; add/remove items matching fixture titles `E2E *`.
5. Calendar week: assign approved fixture to operational week.
6. Smart Upload: open paired fixtures; confirm shared finalize key.
7. Run negative UI attempts on control fixtures (should not enqueue).
8. Cleanup endpoint; confirm fixtures gone.
9. After restore: planner actions in UI should fail (403).

## HTTP runner

```bash
PLANNER_E2E_BASE_URL=https://medi-mori-h1txik68i-omarimckies-projects.vercel.app \
PLANNER_E2E_EXPECTED_BRANCH=integration/twilight-feather-add-to-planner \
MARKETING_STAGING_NEON_PROJECT_ID=small-frost-27394379 \
MARKETING_MOCK_MODE=true \
MARKETING_PREVIEW_READONLY=false \
MARKETING_PLANNER_STAGING_E2E=true \
node scripts/planner-e2e-http-runner.mjs
```

Provide admin session via `PLANNER_E2E_COOKIE_HEADER` (never commit). Use `PLANNER_E2E_RUNNER_EXECUTE=true` only during the authorized window.

## Emergency rollback

1. Set `MARKETING_PREVIEW_READONLY=true` and `MARKETING_PLANNER_STAGING_E2E=false`.
2. Redeploy integration Preview immediately.
3. If orphan tagged rows exist, run cleanup with known `batchId` or scoped SQL by `metadata->>'e2eTag' = 'PLANNER_E2E_STAGING'`.
4. Do not merge PR #17 until acceptance criteria pass.

## Acceptance criteria

- Critical planner HTTP tests pass in CI.
- Browser add/remove/calendar flows pass during write window.
- No real publishing; mock mode stayed on.
- No unrelated staging rows changed; disposable fixtures removed.
- Read-only restored; planner POST returns 403.
- Engineering CI green.