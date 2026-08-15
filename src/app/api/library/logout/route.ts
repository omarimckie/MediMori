import {
  LIBRARY_SESSION_COOKIE,
  librarySessionCookieOptions,
} from "@/lib/library-session";
import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(LIBRARY_SESSION_COOKIE, "", {
    ...librarySessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
