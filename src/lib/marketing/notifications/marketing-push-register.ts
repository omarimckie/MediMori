const SW_URL = "/marketing-sw.js";

export type PushSupportState =
  | "unsupported"
  | "permission_denied"
  | "permission_default"
  | "permission_granted";

export function getPushSupportState(): PushSupportState {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "permission_denied";
  if (Notification.permission === "granted") return "permission_granted";
  return "permission_default";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export async function registerMarketingServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_URL, { scope: "/" });
}

export async function subscribeMarketingPush(): Promise<PushSubscription> {
  const support = getPushSupportState();
  if (support === "unsupported") {
    throw new Error("Push notifications are not supported in this browser.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const keyRes = await fetch("/api/admin/marketing/notifications/push/vapid-public-key");
  const keyData = (await keyRes.json()) as { publicKey?: string; error?: string };
  if (!keyRes.ok || !keyData.publicKey) {
    throw new Error(keyData.error ?? "Could not load Web Push configuration.");
  }

  const registration = await registerMarketingServiceWorker();
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return existing;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource,
  });
}

export async function unsubscribeMarketingPush(): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  if (!registration) return false;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return false;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await fetch("/api/admin/marketing/notifications/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  return true;
}

export async function syncMarketingPushSubscription(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  if (!registration) return;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return;
  const json = sub.toJSON();
  await fetch("/api/admin/marketing/notifications/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
}
