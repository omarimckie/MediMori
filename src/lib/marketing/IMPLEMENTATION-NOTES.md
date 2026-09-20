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
- **Chosen for V1:** Store `scheduled_for` on content/publications and poll with Vercel Cron every 15 minutes (`/api/cron/marketing-publish`). Admins can also run it from Analytics.
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
