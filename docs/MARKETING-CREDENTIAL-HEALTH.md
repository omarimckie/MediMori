# Marketing credential health (OpenAI + Meta)

## Scheduling

| Scheduler | Endpoint | Notes |
| --- | --- | --- |
| **GitHub Actions** `credential-health-dispatch.yml` | `POST /api/cron/credential-health` | Primary daily schedule (`5 17 * * *` UTC). Uses `CRON_SECRET` + `MARKETING_PUBLISH_BASE_URL`. |
| Vercel `vercel.json` | *(unchanged)* | Hobby plan keeps a single daily cron on `marketing-publish`; credential health does **not** add a second Vercel cron. |
| Marketing publish reliability hook | Meta only | Optional piggyback when `MARKETING_CREDENTIAL_MONITORING_ENABLED_AT` is set. |

## Feature flags (production — owner approval required)

| Variable | Purpose |
| --- | --- |
| `OPENAI_CREDENTIAL_MONITORING_ENABLED_AT` | ISO instant when daily OpenAI `GET /v1/models` probes become active. Independent of Meta monitoring. |
| `MARKETING_INTEGRATION_CREDENTIAL_MONITORING_ENABLED_AT` | ISO instant for Phase 2 probes (Stripe balance, Resend API keys list, Vercel Blob `list`, Neon `SELECT 1`, Pinterest config-only). |
| `MARKETING_CREDENTIAL_MONITORING_ENABLED_AT` | Existing Meta Facebook/Instagram proactive monitoring. |
| `MARKETING_CREDENTIAL_FINGERPRINT_KEY` | HMAC key for replacement detection (recommended ≥32 chars). |
| `OPENAI_API_KEY` | Must be present for probes; never logged or stored in incidents. |

## Admin

- Dashboard: `/admin/marketing/credential-health`
- OpenAI validity is tracked separately from expiration (OpenAI does not expose key expiry via the models list API).

## Phase 2 provider probes

| Provider | Method | Notes |
| --- | --- | --- |
| Stripe | `GET /v1/balance` | Read-only; no payments created. |
| Resend | `GET /api-keys` | Read-only metadata; no sends. |
| Vercel Blob | `list({ limit: 1 })` | Read-only; no uploads/deletes. |
| Neon | `SELECT 1` | Bounded ping via injectable probe in tests. |
| Pinterest | Config + policy | OAuth refresh not used for monitoring; validity **unknown** when credentials are present. |
