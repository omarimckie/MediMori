"use client";

import { EbookCheckoutForm } from "@/components/EbookCheckoutForm";
import type { Book } from "@/lib/books";

type Props = {
  book: Book;
  stopLinkPropagation?: boolean;
};

export function BookBuyActions({
  book,
  stopLinkPropagation = false,
}: Props) {
  const hasDirectEbookCheckout = Boolean(book.stripePriceIdEbook?.trim());

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
          eBook (direct):{" "}
          <span className="font-semibold">{book.priceEbook ?? "Set price"}</span>
        </p>
        <p className="text-brand-charcoal/85">
          Paperback:{" "}
          <span className="font-semibold">{book.pricePaperback ?? "Set price"}</span>
        </p>
      </div>

      {hasDirectEbookCheckout ? (
        <EbookCheckoutForm
          bookId={book.id}
          ebookFileBaseName={book.ebookFileBaseName}
          isEnabled={hasDirectEbookCheckout}
        />
      ) : null}

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
      </div>
    </div>
  );
}
