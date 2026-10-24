# Release manifest — Marketing analytics & attribution

**Branch:** `feature/marketing-analytics`
**Worktree:** `C:\CodeWork\marketing-autopilot-analytics-rc`
**Production baseline / branch root:** `5c28d377958c73eb67e48ee1e714b215c45d98be` (main with PR #7 tracked links)
**Agent boundary:** Read-only analytics; no changes to `publishers.ts` or publish adapters.

## Integration sequence (this RC)

1. **Base:** production main at `5c28d37` (PR #7 already merged).
2. **Branch:** `feature/marketing-analytics` — analytics-only paths below.
3. **Do not** include order-notification, preview-readiness, or publishing hunks from other worktrees.
4. **Optional follow-up:** `morning-brief.ts` + `analytics-time.ts` calendar helper move (touches notifications, not publishing).
5. **Smoke:** `GET /api/admin/marketing/analytics?window=week` as admin; `GET .../prior-day` returns `deliverable: false`.
6. **No SQL migrations** required for analytics.

### Analytics-only paths (Cycle 1 + Cycle 2 hardening)

```
docs/MARKETING-ANALYTICS-ATTRIBUTION.md
docs/MARKETING-ANALYTICS-RELEASE-MANIFEST.md
src/lib/marketing/analytics/**
src/lib/marketing/attribution.ts          # loadPurchaseSnapshotsWithStatus only
src/app/api/admin/marketing/analytics/route.ts
src/app/api/admin/marketing/analytics/prior-day/route.ts
src/components/admin/marketing/AnalyticsClient.tsx
src/lib/marketing/marketing-page-guides.ts  # analytics guide section only
src/lib/marketing/notifications/morning-brief.ts  # prior-day block only (optional for analytics-only MVP)
```

### Explicitly exclude from analytics release

- Order-notification / shipping tests and SQL
- Preview read-only (`preview-readonly`, `WeekClient` bulk of changes) unless already on main
- Unrelated `package.json` test entries unless registering new analytics test files
- `content-queue-*` regression edits unless required by analytics

## New modules

| Path | Role |
|------|------|
| `src/lib/marketing/analytics/analytics-time.ts` | Day/week/month periods in marketing TZ |
| `src/lib/marketing/analytics/analytics-contracts.ts` | UTM / PR #7 contract reference |
| `src/lib/marketing/analytics/analytics-privacy.ts` | Sanitized attribution rows |
| `src/lib/marketing/analytics/analytics-aggregation.ts` | `buildMarketingAnalyticsDashboard` |
| `src/lib/marketing/analytics/prior-day-analytics-summary.ts` | Morning brief / push copy builder |

## Modified surfaces

| Path | Change |
|------|--------|
| `src/app/api/admin/marketing/analytics/route.ts` | Windowed dashboard JSON |
| `src/app/api/admin/marketing/analytics/prior-day/route.ts` | Push preview (no send) |
| `src/components/admin/marketing/AnalyticsClient.tsx` | Daily/weekly/monthly UI + warnings |
| `src/lib/marketing/notifications/morning-brief.ts` | Prior-day analytics block in brief |
| `src/lib/marketing/marketing-page-guides.ts` | Analytics page guide |
| `package.json` | Test registration |

## Verification (local)

```text
npm run typecheck
npx tsx --test src/lib/marketing/analytics/marketing-analytics-dashboard.test.ts
npx tsx --test src/lib/marketing/marketing-analytics-reliability.test.ts
npx tsx --test src/lib/marketing/notifications/marketing-notifications.test.ts
npx eslint src/lib/marketing/analytics src/components/admin/marketing/AnalyticsClient.tsx
```

## Deployment approvals required

| Item | Approval |
|------|----------|
| Git commit / push | Owner |
| Production deploy | Owner |
| SQL / schema | **None** (uses existing tables) |
| Secrets / VAPID | Unchanged; push still requires existing env |
| Live morning brief / push | **Do not enable** until owner reviews `prior-day` preview in staging |

## Integration review checklist

- [ ] Confirm `NEXT_PUBLIC_SITE_URL` for tracked link display in admin
- [ ] Confirm purchases DB readable in production for conversion block
- [ ] Review partial-data warnings with real (non-mock) metrics
- [ ] Validate morning brief length after analytics block (900 char push truncation still applies)
