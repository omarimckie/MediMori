import {
  adminSessionCookieOptions,
  ADMIN_SESSION_COOKIE,
  createAdminSessionValue,
  isAdminConfigured,
  verifyAdminCredentials,
} from "@/lib/admin-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      {
        error:
          "Admin login is not configured. Set ADMIN_USERS and ADMIN_SESSION_SECRET.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const username =
    typeof body === "object" &&
    body !== null &&
    "username" in body &&
    typeof (body as { username: unknown }).username === "string"
      ? (body as { username: string }).username
      : "";

  const password =
    typeof body === "object" &&
    body !== null &&
    "password" in body &&
    typeof (body as { password: unknown }).password === "string"
      ? (body as { password: string }).password
      : "";

  if (!verifyAdminCredentials(username, password)) {
    return NextResponse.json(
      { error: "Incorrect username or password." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    createAdminSessionValue(username),
    adminSessionCookieOptions(),
  );
  return response;
}
