# Buffer TikTok activation and emergency shutdown

## Operating modes

Live Buffer GraphQL submissions require **all** of the following:

1. `MARKETING_MOCK_MODE=false`
2. `MARKETING_BUFFER_TIKTOK_ENABLED=true`
3. `MARKETING_BUFFER_TIKTOK_LIVE=true` (owner authorization)
4. A valid **activation mode** (see below)
5. `BUFFER_TIKTOK_CHANNEL_ID` and `BUFFER_ACCESS_TOKEN`

| Mode (`MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE`) | Behavior |
| --- | --- |
| **unset / empty / `disabled`** | Fail closed — no live TikTok submissions |
| **`controlled`** | Live submission for **exactly one** publication id (`MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID`) |
| **`automated`** | Normal eligible scheduled TikTok publishing (must be explicit — never implied) |

Malformed configuration (unknown mode, controlled without a UUID, multi-id allowlists, controlled id set while mode is `automated`) blocks **all** live submissions.

Gates run **before** publication claim / status mutation in `publishPublication` and again **immediately before** `bufferCreateTikTokPost` in `BufferTikTokPublisher`. Non-allowlisted publications keep their existing status, schedule, `externalId`, and `attemptCount`.

## Emergency shutdown

1. Set `MARKETING_BUFFER_TIKTOK_LIVE=false` (and preferably `MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE=disabled`).
2. **Redeploy** the application (or restart all Node workers) so every instance reloads environment variables. Changes are **not** instant for already-running processes.
3. **In-flight requests:** A request that already passed the activation gate may still reach Buffer until the instance restarts. Do not assume immediate global stop.
4. **Reconciliation:** Existing `processing` / deferred Buffer posts continue to be eligible for read-only reconciliation (`reconcileBufferTikTokPublications`) once the dispatcher runs again; shutdown does not delete publication rows.

## Admin inventory

`GET /api/admin/marketing/buffer/tiktok/inventory` (authenticated read-only) returns aggregate counts and paginated TikTok publication details for scheduled, overdue, processing, failed, ambiguous, and unexpected provider values. Sensitive provider errors are redacted.