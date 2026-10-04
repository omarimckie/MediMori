# Marketing Autopilot — implementation notes

This prototype is a module inside the existing Twilight Feather Next.js app.

## Provider alternatives (not silently locked)

### Social publishing
- **Chosen:** `SocialPublisher` interface + `MockSocialPublisher` default. Live Instagram and Facebook use native Meta Graph publishers (`InstagramPublisher`, `FacebookPagePublisher`) when `MARKETING_MOCK_MODE=false`.
- **Not used:** Buffer, Hootsuite, or other third-party schedulers.
- **Alternatives:** Pinterest/Google later, or a different scheduler. Changing vendors should only require a new class behind the interface.

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
- **Production plan:** Vercel **Hobby**. Native Vercel Cron cannot run more than **once per day** (sub-daily `vercel.json` expressions fail deploy; timing is only guaranteed within the scheduled hour).
- **Chosen for V1:** Store `scheduled_for` on content/publications as the authoritative due-time queue. `publishDue` decides what is actually due; dispatchers only invoke that function via `POST /api/cron/marketing-publish`.
- **Vercel Cron (fallback):** Once daily at `0 16 * * *` UTC → same endpoint with `Authorization: Bearer CRON_SECRET`. Retained on Hobby as a backup if GitHub Actions is disabled or misconfigured.
- **GitHub Actions (intended ~15-minute dispatcher):** Workflow `.github/workflows/marketing-publish-dispatch.yml` runs on `cron: "*/15 * * * *"` and `workflow_dispatch`. It POSTs to `{MARKETING_PUBLISH_BASE_URL}/api/cron/marketing-publish` with `Bearer CRON_SECRET`. Scheduled runs can be **delayed** by GitHub under load. GitHub may **disable scheduled workflows** after prolonged repository inactivity (re-enable in the Actions tab). No publish logic lives in the workflow.
- **Manual fallback:** “Publish due items” on **Your Week** or **Analytics** (admin session) calls the same route for emergency or pre-dispatcher testing.
- **GitHub configuration (required after merge):**
  - Repository **secret** `CRON_SECRET` — must match Vercel production `CRON_SECRET` byte-for-byte.
  - Repository **variable** `MARKETING_PUBLISH_BASE_URL` — production site origin only, no trailing slash (e.g. `https://twilight-feather.com`), same host as `NEXT_PUBLIC_SITE_URL` on Vercel.
- **Alternatives:** Buffer’s scheduler, Inngest, or a queue. A full distributed job system is out of scope.

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
- **Why it looks extra:** Admins can already click “Publish due items” on Your Week / Analytics; GitHub Actions also dispatches the same route.
- **What it does:** On Hobby, Vercel invokes `publishDue` at most once per day; GitHub Actions provides ~15-minute polling.
- **Could replace it:** Manual publish only, or a vendor scheduler (Buffer).
- **What would be lost:** Automated dispatch (GitHub + daily Vercel fallback) — hands-off posting after approval.

## Marketing asset public image proxy
- **Route:** `GET`/`HEAD` `/api/marketing/assets/{assetId}/image` serves approved Blob-backed `marketing/public/*` raster images when at least one referencing `marketing_content` row has status `approved`, `scheduled`, `published`, or `failed`.
- **Canonical URL:** `resolveContentImageUrl` uses `resolvePublishableMarketingAssetUrl(asset, content.status)` so Meta receives the app proxy URL when content is eligible; publication still requires `contentMayBePublished`.
- **Smart Upload:** Finalize leaves content `needs_review`, so the proxy stays ineligible until human approval.
- **Manual upload follow-up:** `manual-upload.ts` still uses server `uploadPublicMarketingFile` against a private Blob store; fix separately (presigned client put or private upload + proxy).
