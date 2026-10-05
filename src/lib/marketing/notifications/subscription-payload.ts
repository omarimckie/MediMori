export type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function parsePushSubscriptionBody(body: unknown): PushSubscriptionKeys | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
  if (!endpoint || !endpoint.startsWith("https://")) return null;

  const keys =
    record.keys && typeof record.keys === "object"
      ? (record.keys as Record<string, unknown>)
      : null;
  const p256dh =
    typeof keys?.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys?.auth === "string" ? keys.auth.trim() : "";
  if (!p256dh || !auth) return null;

  return { endpoint, p256dh, auth };
}
