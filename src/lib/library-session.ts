import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { normalizeEmail } from "./checkout-ownership";

export const LIBRARY_SESSION_COOKIE = "tf_library_session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function getSessionSecret(): string {
  const secret = process.env.LIBRARY_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("LIBRARY_SESSION_SECRET is not configured.");
  }
  return secret;
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

export function createLibrarySessionValue(email: string): string {
  const exp = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(
    JSON.stringify({ exp, email: normalizeEmail(email) }),
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

export function readLibrarySessionEmail(
  value: string | undefined,
): string | null {
  if (!value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  try {
    const expected = signPayload(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
      email?: string;
    };

    if (typeof data.exp !== "number" || data.exp <= Date.now()) return null;
    if (typeof data.email !== "string" || !data.email) return null;
    return normalizeEmail(data.email);
  } catch {
    return null;
  }
}

export function librarySessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export async function getLibrarySessionEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  return readLibrarySessionEmail(
    cookieStore.get(LIBRARY_SESSION_COOKIE)?.value,
  );
}
