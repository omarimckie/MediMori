# Weekly social posts → Twilight Feather website links

## Behavior

- **Destination resolution** (`resolveMarketingWebsiteDestinationPath`): book pages for most weekly categories when `bookId` is set; homepage (`/`) for `brand_story`, `community`, and `trust`; free resources use `/resources/free/{slug}`; optional `metadata.websiteDestinationPath` when it passes the on-site allowlist.
- **Tracking**: Public posts use `https://{site}/api/m/{trackingToken}` which records a click and redirects with UTM parameters (`utm_source` = platform, `utm_medium` = `marketing_autopilot`, `utm_campaign`, `utm_content`).
- **Facebook**: Image posts still use the Graph **photos** API; the tracked URL is appended to the caption. Text-only posts use the **feed** API with `link` set to the tracked URL.
- **Instagram**: Tracked URL is appended to the caption only (feed URLs are not clickable; no Story link stickers).
- **Pinterest**: Pin `link` is the tracked URL (required; clickable destination on the pin).

## Admin review

Content Queue (`enrich=preview`) and Your week (`enrich=weekly`) show **Website destination** (on-site path, tracked link, readiness, platform link behavior, issues, and recovery hints). These code paths are **read-only**: they do not schedule, publish, or mutate content.

### Readiness

| State | Meaning |
|-------|---------|
| `ready` | Tracking and destination checks pass for new content rules. |
| `warning` | Grandfathered rows, platform caption-only URLs, or non-standard tokens — review before recycle/clone. |
| `blocked` | New social rows missing tracking or with invalid destinations — schedule/publish preflight will fail. |

### Grandfathering

Rows on **Facebook, Instagram, or Pinterest** with status **`scheduled`** or **`published`** and **no** `trackingToken` keep working under pre-link rules. Preflight **does not** require a token for those rows. New **`approved`** (and other) social content **must** have a valid tracked link before schedule or publish.

## Publish preflight (`runPublishPreflight`)

Shared by scheduling, publishing, and admin publication retry.

| Code | Typical cause | Operator recovery |
|------|----------------|-------------------|
| `tracking_link_required` | Missing/invalid tracking token (new content) | Approve weekly content with tracking or restore token on the row. |
| `destination_path_invalid` | Resolved on-site path not on allowlist | Fix book/blog/resource mapping or valid `websiteDestinationPath`. |
| `asset_not_ready` | `needsNewAsset` is true | Attach and approve a new asset, then clear the flag. |
| `image_missing` | No approved image linked | Link an approved catalog asset or upload via Smart Upload. |
| `image_unreadable` | Dimensions/metadata unavailable | Re-upload or refresh asset truth. |
| `invalid_aspect_ratio` | Visual wrong shape for channel | Crop/replace per platform rules. |
| `invalid_asset` | HTTPS URL, Pinterest config, pin copy | Fix asset URL or Pinterest env/pin fields. |
| `unsupported_platform_asset` | Format/platform mismatch | Change format or platform. |

Formatted errors append `Recovery: …` via `formatPreflightError` / `marketing-publish-operator-guidance.ts`.

## HTTP status contract

Preflight failures use **different status codes by entry point** (intentional, unchanged):

| Entry point | HTTP status | Notes |
|-------------|-------------|--------|
| Content actions (`POST` schedule, approve workflow via `executeMarketingContentPostAction`) | **400** | `contentActionFailureStatus` treats preflight messages as client errors. |
| Admin publication retry (`retryAdminPublication` / publications retry API) | **422** | JSON includes `preflight: { code, message }` and `error.message` with recovery text. |

Do not conflate these: clients must not expect 422 from schedule endpoints or 400 from retry preflight failures.

## Partial publication incidents

When one platform leg publishes and another fails, incident text directs operators to fix **only the failed leg**, use **single-platform retry** after verifying the live post, and avoid duplicate publishes. Permitted actions remain **investigate (read-only)** in the Incidents UI.

## Deployment

- Requires `NEXT_PUBLIC_SITE_URL` (or `VERCEL_URL`) so tracked links and redirects use the production hostname.
- No database migration. Existing published posts are not modified.
- New weekly generated content already receives `trackingToken` from `content-engine.ts` (16-character hex).

## Tests

- `src/lib/marketing/marketing-website-destination.test.ts`
- `src/lib/marketing/marketing-website-destination-diagnostics.test.ts`
- `src/lib/marketing/marketing-social-website-link.test.ts`
- `src/lib/marketing/marketing-tracked-website-preflight.test.ts`
- `src/lib/marketing/marketing-preflight-http-contract.test.ts`
- `src/lib/marketing/marketing-review-readonly.test.ts`
- `src/lib/marketing/marketing-publish-operator-guidance.test.ts`
- `src/lib/marketing/meta-publishers.test.ts` (Facebook feed `link`, caption tracking)
