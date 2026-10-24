# Weekly social posts → Twilight Feather website links

## Behavior

- **Destination resolution** (`resolveMarketingWebsiteDestinationPath`): book pages for most weekly categories when `bookId` is set; homepage (`/`) for `brand_story`, `community`, and `trust`; free resources use `/resources/free/{slug}`; optional `metadata.websiteDestinationPath` when it passes the on-site allowlist.
- **Tracking**: Public posts use `https://{site}/api/m/{trackingToken}` which records a click and redirects with UTM parameters (`utm_source` = platform, `utm_medium` = `marketing_autopilot`, `utm_campaign`, `utm_content`).
- **Facebook**: Image posts still use the Graph **photos** API; the tracked URL is appended to the caption. Text-only posts use the **feed** API with `link` set to the tracked URL.
- **Instagram**: Tracked URL is appended to the caption only (feed URLs are not clickable; no Story link stickers).
- **Pinterest**: Unchanged — pin `link` is the tracked URL (required).

## Admin review

Content Queue (`enrich=preview`) and Your week (`enrich=weekly`) show **Website destination** (on-site path, tracked link, platform behavior, warnings).

## Deployment

- Requires `NEXT_PUBLIC_SITE_URL` (or `VERCEL_URL`) so tracked links and redirects use the production hostname.
- No database migration. Existing published posts are not modified.
- New weekly generated content already receives `trackingToken` from `content-engine.ts`.

## Tests

- `src/lib/marketing/marketing-website-destination.test.ts`
- `src/lib/marketing/marketing-social-website-link.test.ts`
- `src/lib/marketing/meta-publishers.test.ts` (Facebook feed `link`, caption tracking)
