# Marketing Autopilot — implementation notes

This prototype is a module inside the existing Twilight Feather Next.js app.

## Provider alternatives (not silently locked)

### Social publishing
- **Chosen:** `SocialPublisher` interface + `MockSocialPublisher` default. Live Instagram and Facebook use native Meta Graph publishers (`InstagramPublisher`, `FacebookPagePublisher`) when `MARKETING_MOCK_MODE=false`. Live Pinterest uses `PinterestPublisher` + Pinterest API v5 when credentials are configured (see `docs/PINTEREST-PUBLISHING.md`).
- **Not used:** Buffer, Hootsuite, or other third-party schedulers.
- **Alternatives:** Google later, or a different scheduler. Changing vendors should only require a new class behind the interface.

### Email
- **Chosen for V1:** Reuse existing Resend for the storefront; marketing campaigns use `MockEmailProvider` unless mock mode is off, and even then the Resend campaign sender is a stub so we do not accidentally email the list.
- **Alternatives:** Mailchimp, Buttondown, Resend Broadcasts, or a dedicated ESP. Do not build custom SMTP.

### AI
- **Chosen for V1:** `AIProvider` with mock default. Optional OpenAI via env, with simple vs complex model settings.
- **Alternatives:** Anthropic, a local model, or stay deterministic (the campaign planner and content engine already work without an LLM).

### Images
- **Chosen for V1:** Never auto-generate. Reuse catalog covers, interiors, and character art. `MockImageProvider` refuses generation.
- **Alternatives:** Later, a cheap image API behind `ImageProvider`, still gated by asset-priority rules.

### Scheduling
- **Chosen for V1:** Store `scheduled_for` on content/publications and poll with Vercel Cron once per day (`/api/cron/marketing-publish`, `0 16 * * *` UTC) because Hobby plans reject more frequent crons. Admins can also run it from Analytics.
- **Alternatives:** Buffer’s own scheduler, Inngest, or a queue. A distributed job system is out of scope.

### Analytics
- **Chosen for V1:** `marketing_events`, `marketing_metrics`, and `marketing_clicks` in the existing Neon database. Purchases stay in `purchases` (no email copied into marketing tables).
- **Alternatives:** The storefront still has no first-party product analytics platform. Do not add Mixpanel/Amplitude just for this prototype.

## Database choices
- Books, characters, authors, and mission remain source files (`src/data/*`). They are not duplicated into SQL.
- New tables are marketing-only and live in the existing twilightFeather Neon project.
- `marketing_settings` holds configurable weekly quotas so those numbers are not business-law constants.

## Autonomy
- Phase 1 only: nothing publishes without approval, then schedule.
- Hybrid autopilot (Phase 2) is not implemented.

## Visual asset selection (Phase 3)
- **Call site:** `generateWeeklyContent` in `content-engine.ts` → `selectVisualAssetAsync` in `visual-asset-selection.ts`.
- **Legacy implementation:** `selectAssetWithTruths` / `selectAssetAsync` in `asset-selection.ts` (unchanged).
- **Flag:** `MARKETING_VISUAL_STRATEGY` — `off` (default) | `shadow` | `on`. Parsed in `config.ts`.
- **off:** Legacy result only.
- **shadow:** Legacy result returned; `shadowComparison` attached for evaluation (also logged on `content_generated` events when present).
- **on:** Visual Strategy plan → semantic pick → technical gate. Statuses: `selected_existing`, `needs_new_asset`, `needs_adaptation` (no cover fallback).
- **Read-only compare:** `npx tsx scripts/visual-strategy-legacy-compare-readonly.ts`

## Visual composition (Phase 4)
- **Flag:** `MARKETING_VISUAL_COMPOSITION` — `off` (default) | `on`. Requires `MARKETING_VISUAL_STRATEGY=on` to run.
- **Module:** `src/lib/marketing/visual-composition/` — brief, template selection, layout, Sharp render.
- **Rendering:** Sharp (existing dependency; also used by `asset-truth.ts`).
- **Outcomes:** `composed_existing`, `composed_adaptation`, `needs_new_asset`, `unsupported` on `ExtendedSelectAssetResult.composition`.
- **Phase 5 local eval:** `npx tsx scripts/run-visual-composition-eval.ts` → `tmp/marketing-visual-evaluation/` (gitignored). Fixtures in `visual-composition/evaluation-fixtures.ts`.
- **Phase 6 refinement:** `headline-selection.ts` (deterministic headlines/CTAs), `layout-zones.ts` (template-specific safe areas), bottom-aligned character fit, distinct ENGAGEMENT / CHARACTER_BOOK / educational overlays, subtle navy footer brand strip.
- **Phase 7 post assembly (local):** `post-assembly/` + `npx tsx scripts/run-marketing-post-assembly.ts` → `tmp/marketing-post-evaluation/` (manifest, PNG, admin-review.txt). Strategy/composition flags enabled only inside assembly helper.
- **Phase 8 environments (local):** `MARKETING_VISUAL_ENVIRONMENT=off` (default). `visual-composition/environments/` + `npx tsx scripts/run-visual-composition-eval-phase8.ts` → `tmp/marketing-visual-evaluation-phase8/` (scene vs minimal PNGs).
- **Phase 9 template polish (local):** Branded frame primitives, larger platform-aware hero zones, richer illustrated scenes, content-specific headlines (generic title rejection), brush CTA ribbons on book scenes only.
- **Phase 10 template parity (local):** Transparent navy/gold poster overlay frame, template-specific scene zones (Meet Amara hero + supporting panel + book badge), removed duplicate translucent header bands from backgrounds, composition bounds tests for CTA/book/character.
- **Phase 11 art-directed templates (local):** `visual-composition/art-directed/` blueprints (Meet Character, Education, Book Promotion, Engagement), story column panel, book-cover dedupe when character holds book, `compositionValidation` on layout + eval manifest.
- **Phase 12A polish (local):** Meet headline plaque + editorial story column, larger hero/typography, CTA only via `displayCta` (removed composition-invented intro CTA). Go-or-pivot visual test.

## POTENTIAL SIMPLIFICATION

These remain in the prototype so the full workflow is inspectable. Do not remove them without owner review.

### Memory store (`MARKETING_STORE=memory`)
- **Why it looks extra:** Production should use Neon.
- **What it does:** Lets tests and a single `next dev` process run without Postgres.
- **Could replace it:** Always use Postgres, even locally.
- **What would be lost:** Fast unit tests and a no-database demo. HMR currently wipes in-memory data.

### Separate `marketing_approvals` table
- **Why it looks extra:** Status already lives on `marketing_content`.
- **What it does:** Stores actor, previous/new body, and preference signals per action.
- **Could replace it:** Append-only JSON on the content row, or reuse `marketing_events`.
- **What would be lost:** A clean audit trail of edits vs approvals vs regenerations.

### `marketing_templates` table
- **Why it looks extra:** Templates are also defined in `brain.ts`.
- **What it does:** Makes playbook structures data-driven and seedable.
- **Could replace it:** Keep templates in code only.
- **What would be lost:** Owner-editable structures without a deploy.

### `marketing_rules` table
- **Why it looks extra:** Approved/restricted claims already exist in the Marketing Brain module.
- **What it does:** Persists claim/CTA/promo rules next to generated content.
- **Could replace it:** Read only from `brain.ts`.
- **What would be lost:** Runtime owner updates without shipping code.

### Dual planner + AI provider call
- **Why it looks extra:** Campaigns and weekly copy are already generated deterministically.
- **What it does:** Records a complex/simple AI operation (mocked in V1) so live models can be swapped in later.
- **Could replace it:** Skip the AI provider until live copy is needed.
- **What would be lost:** Cost logging and a ready-made model boundary.

### Vercel Cron publisher
- **Why it looks extra:** Admins can already click “Publish due items” on Analytics.
- **What it does:** Polls scheduled publications every 15 minutes on Vercel.
- **Could replace it:** Manual publish only, or a vendor scheduler (Buffer).
- **What would be lost:** Hands-off posting after weekly approval.

## Marketing asset public image proxy
- **Route:** `GET`/`HEAD` `/api/marketing/assets/{assetId}/image` serves approved Blob-backed `marketing/public/*` raster images when at least one referencing `marketing_content` row has status `approved`, `scheduled`, `published`, or `failed` (explicit allowlist). `needs_review` / `rejected` / `draft` / `archived` are not eligible.
- **Canonical URL:** `resolveContentImageUrl` → `resolvePublishableMarketingAssetUrl(asset, content.status)` uses the same allowlist; publication still gates on `contentMayBePublished` before live publish.
- **Smart Upload:** Finalize leaves content `needs_review`, so the proxy returns 404 until a human approves content (intentional).
- **Manual upload follow-up (pre-existing):** `manual-upload.ts` still uses server `uploadPublicMarketingFile` against a private Blob store. That path is unchanged in the proxy hardening pass and does not block Smart Upload Phase 3 verification; fix separately (e.g. presigned client put or private upload + proxy).
