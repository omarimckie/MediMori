"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, PrimaryButton, SecondaryButton } from "./ui";
import {
  getPushSupportState,
  subscribeMarketingPush,
  syncMarketingPushSubscription,
  unsubscribeMarketingPush,
} from "@/lib/marketing/notifications/marketing-push-register";

type NotificationRow = {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  destination: string;
  deliveryStatus: string;
  createdAt: string;
  readAt: string | null;
  relatedIncidentId: string | null;
};

type MorningBriefPreferences = {
  morningBriefEnabled: boolean;
  morningBriefTime: string;
  timezone: string;
};

export function NotificationsClient() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushConfigured, setPushConfigured] = useState(false);
  const [enabledOnDevice, setEnabledOnDevice] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [prefs, setPrefs] = useState<MorningBriefPreferences | null>(null);
  const [briefPreview, setBriefPreview] = useState<string | null>(null);

  const pushSupport = useMemo(() => getPushSupportState(), []);

  const pushStatusLabel = useMemo(() => {
    if (pushSupport === "unsupported") return "Not supported in this browser";
    if (pushSupport === "permission_denied") return "Permission not granted (blocked)";
    if (enabledOnDevice) return "Enabled on this device";
    if (pushSupport === "permission_granted") return "Permission granted — not registered on this device";
    return "Disabled on this device";
  }, [pushSupport, enabledOnDevice]);

  const refresh = useCallback(async () => {
    const [notifRes, prefRes] = await Promise.all([
      fetch("/api/admin/marketing/notifications"),
      fetch("/api/admin/marketing/notifications/preferences"),
    ]);
    if (notifRes.ok) {
      const data = (await notifRes.json()) as { notifications: NotificationRow[] };
      setNotifications(data.notifications ?? []);
    }
    if (prefRes.ok) {
      const data = (await prefRes.json()) as { preferences: MorningBriefPreferences };
      setPrefs(data.preferences);
    }

    const registration = await navigator.serviceWorker?.getRegistration("/marketing-sw.js");
    const sub = registration ? await registration.pushManager.getSubscription() : null;
    const endpoint = sub?.endpoint ?? null;
    setLocalEndpoint(endpoint);

    const statusUrl = endpoint
      ? `/api/admin/marketing/notifications/push/status?endpoint=${encodeURIComponent(endpoint)}`
      : "/api/admin/marketing/notifications/push/status";
    const statusRes = await fetch(statusUrl);
    if (statusRes.ok) {
      const status = (await statusRes.json()) as {
        pushConfigured: boolean;
        enabledOnThisDevice: boolean;
      };
      setPushConfigured(status.pushConfigured);
      setEnabledOnDevice(Boolean(endpoint && status.enabledOnThisDevice));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function enablePush() {
    setBusy(true);
    setMessage(null);
    try {
      const sub = await subscribeMarketingPush();
      await fetch("/api/admin/marketing/notifications/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setMessage("Notifications enabled for this browser/device.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    setBusy(true);
    setMessage(null);
    try {
      await unsubscribeMarketingPush();
      setMessage("Notifications disabled on this device.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    try {
      if (localEndpoint) {
        await syncMarketingPushSubscription();
      }
      const res = await fetch("/api/admin/marketing/notifications/push/test", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string; pushDelivered?: number };
      if (!res.ok) {
        setMessage(data.error ?? "Test notification failed.");
      } else if (data.pushDelivered && data.pushDelivered > 0) {
        setMessage("Test notification sent.");
      } else {
        setMessage("Test saved to history but no push was delivered. Check device subscription.");
      }
      await refresh();
    } catch {
      setMessage("Could not send test notification.");
    } finally {
      setBusy(false);
    }
  }

  async function savePrefs() {
    if (!prefs) return;
    setBusy(true);
    const res = await fetch("/api/admin/marketing/notifications/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: prefs }),
    });
    setBusy(false);
    if (res.ok) setMessage("Morning Brief preferences saved (delivery not scheduled yet).");
    else setMessage("Could not save preferences.");
  }

  async function previewBrief() {
    setBusy(true);
    const res = await fetch("/api/admin/marketing/notifications/morning-brief/preview");
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setBriefPreview(data.brief?.payload?.body ?? null);
    }
  }

  async function markAllRead() {
    await fetch("/api/admin/marketing/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    await refresh();
  }

  return (
    <div className="space-y-6">
      {message ? (
        <p className="rounded-2xl bg-brand-gold/20 px-4 py-3 text-sm font-semibold">{message}</p>
      ) : null}

      <Card>
        <h2 className="text-lg font-extrabold text-brand-navy">Phone notifications</h2>
        <p className="mt-2 text-sm text-brand-charcoal/75">
          Enable push notifications for <strong>this browser/device</strong> only. Permission is
          requested when you tap Enable — not automatically on page load.
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="font-bold">Status</dt>
            <dd>{pushStatusLabel}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="font-bold">Server push config</dt>
            <dd>{pushConfigured ? "VAPID configured" : "VAPID keys missing on server"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-brand-charcoal/60">
          Android Chrome and installed Android PWAs generally support Web Push. iPhone/iPad requires
          iOS 16.4+ and usually adding Twilight Feather to the Home Screen before push works in
          Safari.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <PrimaryButton type="button" disabled={busy || pushSupport === "unsupported"} onClick={() => void enablePush()}>
            Enable notifications
          </PrimaryButton>
          <SecondaryButton type="button" disabled={busy} onClick={() => void sendTest()}>
            Send test notification
          </SecondaryButton>
          <SecondaryButton type="button" disabled={busy} onClick={() => void disablePush()}>
            Disable notifications
          </SecondaryButton>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Morning Brief (foundation)</h2>
        <p className="mt-2 text-sm text-brand-charcoal/75">
          Default delivery: 7:00 AM America/New_York. Automatic sending is{" "}
          <strong>not enabled</strong> until a separate scheduler is added after tonight&apos;s
          publishing validation.
        </p>
        {prefs ? (
          <div className="mt-4 space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={prefs.morningBriefEnabled}
                onChange={(e) =>
                  setPrefs({ ...prefs, morningBriefEnabled: e.target.checked })
                }
              />
              Morning Brief on (preference only)
            </label>
            <label className="block">
              <span className="font-bold">Delivery time</span>
              <input
                type="time"
                className="mt-1 rounded-xl border border-brand-brown/20 px-3 py-2"
                value={prefs.morningBriefTime}
                onChange={(e) => setPrefs({ ...prefs, morningBriefTime: e.target.value })}
              />
            </label>
            <p className="text-xs text-brand-charcoal/60">Timezone: {prefs.timezone}</p>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton type="button" disabled={busy} onClick={() => void savePrefs()}>
                Save preferences
              </SecondaryButton>
              <SecondaryButton type="button" disabled={busy} onClick={() => void previewBrief()}>
                Preview brief content
              </SecondaryButton>
            </div>
          </div>
        ) : null}
        {briefPreview ? (
          <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-cream-deep p-4 text-xs">
            {briefPreview}
          </pre>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold">Notification history</h2>
          <SecondaryButton type="button" disabled={busy} onClick={() => void markAllRead()}>
            Mark all read
          </SecondaryButton>
        </div>
        <ul className="mt-4 space-y-3">
          {notifications.map((item) => (
            <li
              key={item.id}
              className={`rounded-2xl border p-3 text-sm ${
                item.readAt ? "border-brand-brown/10" : "border-brand-gold/40 bg-brand-gold/5"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{item.title}</p>
                <span className="text-xs uppercase text-brand-charcoal/50">{item.severity}</span>
              </div>
              <p className="mt-1 text-brand-charcoal/75">{item.body}</p>
              <p className="mt-2 text-xs text-brand-charcoal/50">
                {new Date(item.createdAt).toLocaleString()} · {item.deliveryStatus} · {item.type}
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                <Link
                  href={item.destination}
                  className="text-xs font-bold text-brand-green-deep"
                >
                  Open
                </Link>
                {item.relatedIncidentId ? (
                  <Link
                    href={`/admin/marketing/incidents/${item.relatedIncidentId}`}
                    className="text-xs font-bold text-brand-navy"
                  >
                    View incident
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
