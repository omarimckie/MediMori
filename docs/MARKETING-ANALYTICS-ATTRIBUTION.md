# Marketing analytics and attribution

## Data model (source-grounded)

| Signal | Source | Dashboard treatment |
|--------|--------|---------------------|
| Tracked social clicks | `marketing_clicks` + `content_clicked` events | **Measured** — primary attribution input |
| Landing paths | `destinationPath` on clicks (PR #7 resolver) | **Measured** — “visited pages” (marketing landings only) |
| UTM dimensions | `content.platform`, `campaignId`, `content.id` on click join | **Derived** — mirrors redirect query params |
| Posts published | `marketing_publications` (`published`) | **Measured** |
| Resource downloads | `resource_downloaded` events | **Measured** |
| Purchases | `purchases` table via `loadPurchaseSnapshots` | **Measured** counts; attribution via `attributePurchases` |
| Platform impressions/engagements | `marketing_metrics` where `source = platform` | **Measured** when present |
| Mock metrics | `marketing_metrics` where `source = mock` | **Synthetic** — isolated rollup, warnings |
| Meta / IG engagement API | Not ingested | **Unavailable** |
| Full-site page views | Not implemented | **Unavailable** |

## APIs (read-only)

- `GET /api/admin/marketing/analytics?window=day|week|month&anchor=YYYY-MM-DD`
- `GET /api/admin/marketing/analytics/prior-day` — push payload preview; **does not send**

## Push integration

- `buildPriorDayAnalyticsSummary` + `buildPriorDayAnalyticsNotificationPayload` in `prior-day-analytics-summary.ts`
- Morning brief body includes a “Measured analytics (prior day)” block via `formatPriorDayAnalyticsSummaryBlock`
- Live delivery remains gated by existing `runMorningBriefDeliveryIfDue` (VAPID, subscriptions, claims)

## Privacy

- Dashboard attribution sample omits `purchaseId` and payment fields (`sanitizeAttributionRows`).
- No customer email or Stripe identifiers in analytics responses.

## Timezone

Reporting windows use `MARKETING_TIMEZONE` (default `America/New_York`) and `calendarDayInTimezone`.

## Tests

`src/lib/marketing/analytics/marketing-analytics-dashboard.test.ts`
