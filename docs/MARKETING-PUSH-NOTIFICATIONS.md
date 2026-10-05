# Marketing Admin — Web Push (owner phone notifications)

Owner-only notifications for Marketing Autopilot. This is **not** visitor marketing push.

## VAPID setup (server)

Generate keys once (do not commit the private key):

```bash
npx web-push generate-vapid-keys
```

Add to Vercel production / `.env.local` (never commit real private keys):

```env
WEB_PUSH_VAPID_PUBLIC_KEY=<public key from command>
WEB_PUSH_VAPID_PRIVATE_KEY=<private key from command>
WEB_PUSH_SUBJECT=mailto:hello@twilight-feather.com
```

Apply database tables:

```bash
npm run marketing:schema:web-push
```

## Android setup

1. Open **https://twilight-feather.com** (or your staging URL) in **Chrome**.
2. Log in to **Marketing Admin** (`/admin/login` → Marketing).
3. Open **Notifications** in the Marketing sidebar (or the header bell → Settings).
4. Tap **Enable notifications** and accept the browser permission prompt.
5. Tap **Send test notification**. You should see:
   - Title: **Twilight Feather Marketing**
   - Body: **Phone notifications are working.**
6. Optional: install the site as a PWA (Chrome menu → Add to Home screen) for a more app-like experience.

## iPhone / iOS setup

Requirements (as implemented):

- **iOS 16.4+**
- Web Push for Safari generally requires the site be **added to the Home Screen** first.
- Open Safari → share → **Add to Home Screen**, then open the app from the icon.
- Log into Marketing Admin, open **Notifications**, tap **Enable notifications**, allow permission, then **Send test notification**.

If permission is blocked, use Settings → Safari → Notifications for the installed web app.

## Service worker

- File: `/marketing-sw.js`
- Handles `push` and `notificationclick`
- Click opens only paths under `/admin/marketing…` (no external URLs)

## Morning Brief

- Preferences default: **7:00 AM**, **America/New_York**, **off** until enabled.
- **Automatic delivery is not scheduled** in this milestone. Use **Preview brief content** on the Notifications page.
- Brief uses **real** repository data only (no mock `marketing_metrics` website sessions).

## Future scheduling (after publishing validation)

Proposed **separate** automation (does not touch `marketing-publish`):

1. New Vercel cron entry, e.g. `0 11 * * *` UTC (7:00 AM ET during EST; adjust for DST) **or** a dedicated GitHub Actions workflow on its own schedule.
2. New route, e.g. `POST /api/cron/marketing-morning-brief` with `CRON_SECRET` (same auth pattern as publish cron).
3. Handler: load prefs → if enabled → `buildMorningMarketingBrief()` → `sendMarketingNotification()` to all enabled admin subscriptions (or per-admin).

Do **not** reuse `.github/workflows/marketing-publish-dispatch.yml`.
