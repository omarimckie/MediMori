import { getBookById } from "@/lib/books";
import { get } from "@vercel/blob";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

function lineItemPriceId(item: Stripe.LineItem): string | undefined {
  const price = item.price;
  if (!price) return undefined;
  if (typeof price === "string") return price;
  return price.id;
}

/** JSON map: book id → Vercel Blob URL (see .env.example). */
function getEbookBlobUrlForBook(bookId: string): string | undefined {
  const raw = process.env.EBOOK_BLOB_URLS?.trim();
  if (!raw) return undefined;
  try {
    const map = JSON.parse(raw) as Record<string, unknown>;
    const u = map[bookId];
    return typeof u === "string" && u.trim() ? u.trim() : undefined;
  } catch {
    return undefined;
  }
}

function inferBlobAccess(url: string): "public" | "private" {
  return url.includes(".private.blob.") ? "private" : "public";
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

    const sessionId = new URL(request.url).searchParams.get("session_id");
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
    const expectedPrice = book?.stripePriceIdEbook?.trim();
    if (!book || !expectedPrice) {
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

    const paidForPrice = lineItems.some(
      (item) => lineItemPriceId(item) === expectedPrice,
    );

    if (!paidForPrice) {
      return NextResponse.json(
        { error: "This payment is not linked to this eBook." },
        { status: 403 },
      );
    }

    const safeName = `${book.ebookFileBaseName.replace(/["\\]/g, "")}.pdf`;
    const pdfHeaders = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    } as const;

    const blobUrl = getEbookBlobUrlForBook(book.id);
    if (blobUrl) {
      const blobResult = await get(blobUrl, {
        access: inferBlobAccess(blobUrl),
      });
      if (
        !blobResult ||
        blobResult.statusCode !== 200 ||
        !blobResult.stream
      ) {
        return NextResponse.json(
          {
            error:
              "eBook file could not be loaded from storage. Check EBOOK_BLOB_URLS and Blob access, or try again later.",
          },
          { status: 502 },
        );
      }

      return new NextResponse(blobResult.stream, {
        status: 200,
        headers: pdfHeaders,
      });
    }

    const filePath = path.join(
      process.cwd(),
      "private",
      "ebooks",
      `${book.ebookFileBaseName}.pdf`,
    );

    let file: Buffer;
    try {
      file = await readFile(filePath);
    } catch {
      return NextResponse.json(
        {
          error:
            "eBook PDF is missing. For production set EBOOK_BLOB_URLS in env, or add private/ebooks/" +
            `${book.ebookFileBaseName}.pdf` +
            " for local delivery.",
        },
        { status: 404 },
      );
    }

    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: pdfHeaders,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Download failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
