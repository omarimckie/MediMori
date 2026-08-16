import { normalizeEmail } from "@/lib/checkout-ownership";
import { sendLibraryAccessEmail } from "@/lib/email";
import {
  createRawMagicToken,
  insertMagicLinkToken,
  isMagicLinkRateLimited,
} from "@/lib/magic-link";
import { listEntitlementsForEmail } from "@/lib/purchases";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const emailRaw =
    typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof (body as { email: unknown }).email === "string"
      ? (body as { email: string }).email
      : "";

  const email = normalizeEmail(emailRaw);
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  const generic = {
    ok: true as const,
    message:
      "If that email owns Twilight Feather books, we sent a one-time access link.",
  };

  try {
    if (await isMagicLinkRateLimited(email)) {
      return NextResponse.json(generic);
    }

    const entitlements = await listEntitlementsForEmail(email);
    if (entitlements.length === 0) {
      return NextResponse.json(generic);
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    if (!siteUrl) {
      return NextResponse.json(
        { error: "Site URL is not configured." },
        { status: 503 },
      );
    }

    const rawToken = createRawMagicToken();
    await insertMagicLinkToken(email, rawToken);
    const accessUrl = `${siteUrl}/access/${rawToken}`;
    const isLocalSite = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(
      siteUrl,
    );

    try {
      await sendLibraryAccessEmail(email, accessUrl);
    } catch (error) {
      if (isLocalSite) {
        console.warn("Library magic-link email skipped locally:", {
          error: error instanceof Error ? error.message : "unknown",
          accessUrl,
        });
        return NextResponse.json({
          ...generic,
          message:
            "Email sending is not configured locally. Use this one-time link:",
          localAccessUrl: accessUrl,
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("Could not send library magic link:", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "The access email could not be sent. Please try again later." },
      { status: 503 },
    );
  }

  return NextResponse.json(generic);
}
