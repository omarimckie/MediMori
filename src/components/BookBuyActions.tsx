"use client";

import { EbookCheckoutForm } from "@/components/EbookCheckoutForm";
import type { Book } from "@/lib/books";

type Props = {
  book: Book;
  stopLinkPropagation?: boolean;
  className?: string;
};

export function BookBuyActions({
  book,
  stopLinkPropagation = false,
  className = "",
}: Props) {
  const hasDirectEbookCheckout = Boolean(book.stripePriceIdEbook?.trim());

  function stopClick(event: React.MouseEvent) {
    if (stopLinkPropagation) {
      event.stopPropagation();
    }
  }

  return (
    <div className={className} onClick={stopClick}>
      {hasDirectEbookCheckout ? (
        <EbookCheckoutForm
          bookId={book.id}
          ebookFileBaseName={book.ebookFileBaseName}
          isEnabled={hasDirectEbookCheckout}
        />
      ) : null}

      {book.amazonPaperbackUrl ? (
        <a
          href={book.amazonPaperbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stopLinkPropagation ? (event) => event.stopPropagation() : undefined}
          className={`inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-yellow-bright px-5 text-sm font-bold text-section-navy transition hover:brightness-95 ${hasDirectEbookCheckout ? "mt-4" : ""}`}
        >
          Paperback on Amazon
        </a>
      ) : null}

      <div className="mt-6 grid gap-2 rounded-2xl border border-brand-brown/15 bg-cream-deep p-3 text-sm">
        <p className="font-bold text-brand-charcoal">Pricing</p>
        <p className="text-brand-charcoal/85">
          eBook (direct):{" "}
          <span className="font-semibold">{book.priceEbook ?? "Set price"}</span>
        </p>
        <p className="text-brand-charcoal/85">
          Paperback:{" "}
          <span className="font-semibold">{book.pricePaperback ?? "Set price"}</span>
        </p>
      </div>
    </div>
  );
}
