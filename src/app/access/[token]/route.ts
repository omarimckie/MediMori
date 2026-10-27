import {
  LIBRARY_SESSION_COOKIE,
  createLibrarySessionValue,
  librarySessionCookieOptions,
} from "@/lib/library-session";
import { consumeMagicLinkToken } from "@/lib/magic-link";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ token: string }>;
};

export async function GET(request: Request, { params }: Props) {
  const { token } = await params;
  const rawToken = token?.trim() ?? "";
  const libraryUrl = new URL("/library", request.url);

  if (!rawToken) {
    libraryUrl.searchParams.set("error", "invalid");
    return NextResponse.redirect(libraryUrl);
  }

  let email: string | null = null;
  try {
    email = await consumeMagicLinkToken(rawToken);
  } catch (error) {
    console.error("Could not redeem magic link:", {
      error: error instanceof Error ? error.message : "unknown",
    });
    libraryUrl.searchParams.set("error", "invalid");
    return NextResponse.redirect(libraryUrl);
  }

  if (!email) {
    libraryUrl.searchParams.set("error", "invalid");
    return NextResponse.redirect(libraryUrl);
  }

  const response = NextResponse.redirect(libraryUrl);
  response.cookies.set(
    LIBRARY_SESSION_COOKIE,
    createLibrarySessionValue(email),
    librarySessionCookieOptions(),
  );
  return response;
}
