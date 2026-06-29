"use client";

import { EbookCheckoutForm } from "@/components/EbookCheckoutForm";
import type { Book } from "@/lib/books";
import Link from "next/link";

type Props = {
  book: Book;
  stopLinkPropagation?: boolean;
  showDetailsLink?: boolean;
};

export function BookBuyActions({
  book,
  stopLinkPropagation = false,
  showDetailsLink = true,
}: Props) {
  const hasDirectEbookCheckout = Boolean(book.stripePriceIdEbook?.trim());
  const showEbookCheckout = book.id === "book-one" || hasDirectEbookCheckout;

  function stopClick(event: React.MouseEvent) {
    if (stopLinkPropagation) {
      event.stopPropagation();
    }
  }

  return (
    <div className="mt-4 text-left" onClick={stopClick}>
      <div className="grid gap-2 rounded-2xl border border-brand-brown/15 bg-cream-deep p-3 text-sm">
        <p className="font-bold text-brand-charcoal">Pricing</p>
        <p className="text-brand-charcoal/85">
          Paperback:{" "}
          <span className="font-semibold">{book.pricePaperback ?? "Set price"}</span>
        </p>
        <p className="text-brand-charcoal/85">
          eBook (direct):{" "}
          <span className="font-semibold">{book.priceEbook ?? "Set price"}</span>
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {book.amazonPaperbackUrl ? (
          <a
            href={book.amazonPaperbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stopLinkPropagation ? (event) => event.stopPropagation() : undefined}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-brand-yellow-bright px-4 text-sm font-bold text-section-navy transition hover:brightness-95"
          >
            Paperback on Amazon
          </a>
        ) : null}

        {showDetailsLink ? (
          <Link
            href={`/books/${book.id}`}
            onClick={stopLinkPropagation ? (event) => event.stopPropagation() : undefined}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal transition hover:bg-cream-deep"
          >
            More details
          </Link>
        ) : null}
      </div>

      {showEbookCheckout ? (
        <EbookCheckoutForm
          bookId={book.id}
          ebookFileBaseName={book.ebookFileBaseName}
          isEnabled={hasDirectEbookCheckout}
        />
      ) : null}
    </div>
  );
}
