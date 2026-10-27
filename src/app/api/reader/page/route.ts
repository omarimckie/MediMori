import {
  getReaderBookConfig,
  getReaderPagePathname,
  isReaderBookId,
} from "@/lib/reader-catalog";
import { createPrivateReaderPageUrl } from "@/lib/reader-blob";
import { getLibrarySessionEmail } from "@/lib/library-session";
import { hasEntitlement } from "@/lib/purchases";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const email = await getLibrarySessionEmail();
    if (!email) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const url = new URL(request.url);
    const bookId = url.searchParams.get("bookId")?.trim() ?? "";
    const pageRaw = url.searchParams.get("page")?.trim() ?? "";
    const page = Number.parseInt(pageRaw, 10);

    if (!isReaderBookId(bookId)) {
      return NextResponse.json({ error: "Unknown reader book." }, { status: 404 });
    }

    const config = getReaderBookConfig(bookId);
    if (!config) {
      return NextResponse.json({ error: "Unknown reader book." }, { status: 404 });
    }

    const owned = await hasEntitlement(email, bookId);
    if (!owned) {
      return NextResponse.json({ error: "Not entitled." }, { status: 403 });
    }

    if (!Number.isInteger(page) || !config.availablePages.includes(page)) {
      return NextResponse.json(
        { error: "That page is not available." },
        { status: 404 },
      );
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "Reader pages are not configured." },
        { status: 503 },
      );
    }

    const pathname = getReaderPagePathname(bookId, page);
    const signed = await createPrivateReaderPageUrl(pathname);

    return NextResponse.json({
      page,
      totalPages: config.totalPages,
      pathname,
      url: signed.url,
      expiresAt: signed.expiresAt,
    });
  } catch (error) {
    console.error("Could not sign reader page:", error);
    return NextResponse.json(
      { error: "Could not load that page." },
      { status: 500 },
    );
  }
}
