import {
  createPrivateEbookDownloadUrl,
  getEbookBlobPathname,
} from "@/lib/ebook-blob";
import { getLibrarySessionEmail } from "@/lib/library-session";
import { hasEntitlement } from "@/lib/purchases";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const LIBRARY_PDF_BOOK_ID = "book-two";

export async function GET(request: Request) {
  try {
    const email = await getLibrarySessionEmail();
    if (!email) {
      return NextResponse.redirect(new URL("/library", request.url), 302);
    }

    const bookId = new URL(request.url).searchParams.get("bookId")?.trim() ?? "";
    if (bookId !== LIBRARY_PDF_BOOK_ID) {
      return NextResponse.json(
        { error: "This book is not available as a library PDF download." },
        { status: 403 },
      );
    }

    const owned = await hasEntitlement(email, LIBRARY_PDF_BOOK_ID);
    if (!owned) {
      return NextResponse.json({ error: "Not entitled." }, { status: 403 });
    }

    const pathname = getEbookBlobPathname(LIBRARY_PDF_BOOK_ID);
    if (!pathname) {
      return NextResponse.json(
        { error: "This eBook is not available for download." },
        { status: 500 },
      );
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "Downloads are not configured (missing BLOB_READ_WRITE_TOKEN)." },
        { status: 503 },
      );
    }

    let presignedUrl: string;
    try {
      presignedUrl = await createPrivateEbookDownloadUrl(pathname);
    } catch (error) {
      console.error("Could not create library eBook download URL:", error);
      return NextResponse.json(
        { error: "eBook download could not be prepared. Please try again later." },
        { status: 502 },
      );
    }

    return NextResponse.redirect(presignedUrl, 302);
  } catch (error) {
    console.error("Could not fulfill library PDF download:", error);
    return NextResponse.json(
      { error: "Download could not be completed." },
      { status: 500 },
    );
  }
}
