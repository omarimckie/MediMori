"use client";

import { EbookCheckoutForm } from "@/components/EbookCheckoutForm";
import { PhysicalCheckoutForm } from "@/components/PhysicalCheckoutForm";
import type { Book } from "@/lib/books";
import { isPhysicalDirectBookId } from "@/lib/physical-books";

type Props = {
  book: Book;
  physicalDirectAvailable?: boolean;
  stopLinkPropagation?: boolean;
  className?: string;
};

export function BookBuyActions({
  book,
  physicalDirectAvailable = false,
  stopLinkPropagation = false,
  className = "",
}: Props) {
  const hasDirectEbookCheckout = Boolean(book.stripePriceIdEbook?.trim());
  const showPhysicalSection = isPhysicalDirectBookId(book.id);

  function stopClick(event: React.MouseEvent) {
    if (stopLinkPropagation) {
      event.stopPropagation();
    }
  }

  return (
    <div className={className} onClick={stopClick}>
      {showPhysicalSection ? (
        <div className="rounded-2xl border border-brand-brown/15 bg-cream-deep p-4">
          <p className="text-sm font-bold text-brand-charcoal">
            Buy the paperback directly from Twilight Feather
          </p>
          <p className="mt-1 text-sm text-brand-charcoal/85">
            $10.00 + $4.99 shipping
          </p>
          <p className="mt-1 text-xs text-brand-charcoal/70">
            Ships directly from Twilight Feather (not Amazon).
          </p>
          {physicalDirectAvailable ? (
            <div className="mt-4">
              <PhysicalCheckoutForm bookId={book.id} />
            </div>
          ) : (
            <p className="mt-4 text-sm font-semibold text-brand-charcoal/80">
              Direct copies currently unavailable.
            </p>
          )}
        </div>
      ) : null}

      {hasDirectEbookCheckout ? (
        <div className={showPhysicalSection ? "mt-6" : undefined}>
          <EbookCheckoutForm
            bookId={book.id}
            ebookFileBaseName={book.ebookFileBaseName}
            isEnabled={hasDirectEbookCheckout}
          />
        </div>
      ) : null}

      {book.amazonPaperbackUrl ? (
        <a
          href={book.amazonPaperbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stopLinkPropagation ? (event) => event.stopPropagation() : undefined}
          className={`inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-yellow-bright px-5 text-sm font-bold text-section-navy transition hover:brightness-95 ${showPhysicalSection || hasDirectEbookCheckout ? "mt-4" : ""}`}
        >
          Buy on Amazon
        </a>
      ) : null}

      <div className="mt-6 grid gap-2 rounded-2xl border border-brand-brown/15 bg-cream-deep p-3 text-sm">
        <p className="font-bold text-brand-charcoal">Pricing</p>
        {showPhysicalSection ? (
          <p className="text-brand-charcoal/85">
            Paperback (direct from us):{" "}
            <span className="font-semibold">$10.00 + $4.99 shipping</span>
          </p>
        ) : (
          <p className="text-brand-charcoal/85">
            Paperback:{" "}
            <span className="font-semibold">{book.pricePaperback ?? "Set price"}</span>
          </p>
        )}
        <p className="text-brand-charcoal/85">
          eBook (direct):{" "}
          <span className="font-semibold">{book.priceEbook ?? "Set price"}</span>
        </p>
      </div>
    </div>
  );
}
