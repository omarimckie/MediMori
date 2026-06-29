export const ADMIN_SESSION_COOKIE = "tf_admin_session";

function getSessionSecret(): string | undefined {
  return process.env.ADMIN_SESSION_SECRET?.trim() || undefined;
}

async function signPayloadEdge(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Buffer.from(signature).toString("base64url");
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyAdminSessionValueEdge(
  value: string | undefined,
): Promise<boolean> {
  const secret = getSessionSecret();
  if (!value || !secret) return false;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;

  try {
    const expected = await signPayloadEdge(payload, secret);
    if (!timingSafeEqualStrings(signature, expected)) return false;

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };

    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}
