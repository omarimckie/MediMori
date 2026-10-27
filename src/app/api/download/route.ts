import {
  EBOOK_SIGNED_URL_TTL_MS,
  getEbookBlobPathname,
} from "@/lib/ebook-blob";
import { getBookById } from "@/lib/books";
import { customerEmailFromSession } from "@/lib/checkout-ownership";
import { hasEntitlement } from "@/lib/purchases";
import { isReaderBookId } from "@/lib/reader-catalog";
import { isAllowedEbookPrice } from "@/lib/stripe-prices";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

function lineItemPriceId(item: Stripe.LineItem): string | undefined {
  const price = item.price;
  if (!price) return undefined;
  if (typeof price === "string") return price;
  return price.id;
}

async function createPrivateEbookDownloadUrl(pathname: string): Promise<string> {
  const validUntil = Date.now() + EBOOK_SIGNED_URL_TTL_MS;
  const signedToken = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "get",
    pathname,
    access: "private",
    validUntil,
  });
  return presignedUrl;
}

export async function GET(request: Request) {
  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      return NextResponse.json(
        { error: "Downloads are not configured (missing STRIPE_SECRET_KEY)." },
        { status: 503 },
      );
    }

    const searchParams = new URL(request.url).searchParams;
    const sessionId = searchParams.get("session_id");
    const intentOnly = searchParams.get("intent") === "1";
    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing session_id query parameter." },
        { status: 400 },
      );
    }

    const stripe = new Stripe(secret);

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["line_items.data.price"],
      });
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired checkout session." },
        { status: 400 },
      );
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { error: "This order is not completed yet." },
        { status: 402 },
      );
    }

    const bookId = session.metadata?.bookId;
    if (!bookId) {
      return NextResponse.json(
        { error: "This checkout session is missing book metadata." },
        { status: 400 },
      );
    }

    const book = getBookById(bookId);
    if (!book || !book.stripePriceIdEbook?.trim()) {
      return NextResponse.json({ error: "Unknown book." }, { status: 400 });
    }

    let lineItems = session.line_items?.data ?? [];
    if (!lineItems.length) {
      try {
        const listed = await stripe.checkout.sessions.listLineItems(sessionId, {
          limit: 10,
          expand: ["data.price"],
        });
        lineItems = listed.data;
      } catch {
        try {
          const listed = await stripe.checkout.sessions.listLineItems(
            sessionId,
            { limit: 10 },
          );
          lineItems = listed.data;
        } catch {
          lineItems = [];
        }
      }
    }

    const paidForPrice = lineItems.some((item) =>
      isAllowedEbookPrice(book, lineItemPriceId(item)),
    );

    if (!paidForPrice) {
      return NextResponse.json(
        { error: "This payment is not linked to this eBook." },
        { status: 403 },
      );
    }

    if (isReaderBookId(book.id)) {
      return NextResponse.json(
        {
          error:
            "This book is available through the protected online reader, not as a PDF download.",
          readerOnly: true,
        },
        { status: 403 },
      );
    }

    const email = customerEmailFromSession(session);
    if (!email) {
      return NextResponse.json(
        { error: "This checkout session is missing a usable customer email." },
        { status: 400 },
      );
    }

    if (book.id === "book-two") {
      const owned = await hasEntitlement(email, "book-two");
      if (!owned) {
        return NextResponse.json(
          { error: "This download is no longer available." },
          { status: 403 },
        );
      }
    }

    if (intentOnly) {
      return NextResponse.json({ readerOnly: false });
    }

    const pathname = getEbookBlobPathname(book.id);
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
      console.error("Could not create eBook download URL:", error);
      return NextResponse.json(
        { error: "eBook download could not be prepared. Please try again later." },
        { status: 502 },
      );
    }

    return NextResponse.redirect(presignedUrl, 302);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Download failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
