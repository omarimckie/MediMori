import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session-edge";

export { ADMIN_SESSION_COOKIE };

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type AdminUserMap = Record<string, string>;

function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not configured.");
  }
  return secret;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function getAdminUsers(): AdminUserMap {
  const raw = process.env.ADMIN_USERS?.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const users: AdminUserMap = {};

    for (const [username, password] of Object.entries(parsed)) {
      const normalized = normalizeUsername(username);
      if (!normalized || typeof password !== "string" || !password) continue;
      users[normalized] = password;
    }

    return users;
  } catch {
    return {};
  }
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

export function createAdminSessionValue(username: string): string {
  const exp = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(
    JSON.stringify({ exp, username: normalizeUsername(username) }),
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

export function verifyAdminSessionValue(value: string | undefined): boolean {
  if (!value) return false;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;

  try {
    const expected = signPayload(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };

    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function getAdminSessionUsername(value: string | undefined): string | null {
  if (!value || !verifyAdminSessionValue(value)) return null;

  const [payload] = value.split(".");
  if (!payload) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      username?: string;
    };
    return typeof data.username === "string" ? data.username : null;
  } catch {
    return null;
  }
}

function safeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyAdminCredentials(username: string, password: string): boolean {
  const users = getAdminUsers();
  const expectedPassword = users[normalizeUsername(username)];
  if (!expectedPassword) return false;

  return safeEqualStrings(password, expectedPassword);
}

export function isAdminConfigured(): boolean {
  return (
    Object.keys(getAdminUsers()).length > 0 &&
    Boolean(process.env.ADMIN_SESSION_SECRET?.trim())
  );
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyAdminSessionValue(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}

export async function getAuthenticatedAdminUsername(): Promise<string | null> {
  const cookieStore = await cookies();
  return getAdminSessionUsername(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}

export function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
