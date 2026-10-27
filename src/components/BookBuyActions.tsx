"use client";

import { EbookCheckoutForm } from "@/components/EbookCheckoutForm";
import { PhysicalCheckoutForm } from "@/components/PhysicalCheckoutForm";
import { bookDeliveryFormat, type Book } from "@/lib/books";
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
        <div
          id="paperback-purchase"
          className="scroll-mt-24 rounded-2xl border border-brand-brown/15 bg-cream-deep p-4"
        >
          <p className="text-sm font-bold text-brand-charcoal">Paperback</p>
          <p className="mt-1 text-lg font-extrabold text-brand-charcoal">
            $10.00
          </p>
          <p className="mt-1 text-sm font-semibold text-brand-charcoal/85">
            $4.99 shipping
          </p>
          <p className="mt-1 text-xs text-brand-charcoal/70">
            Ships directly from Twilight Feather
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
          {showPhysicalSection ? (
            <div className="rounded-2xl border border-brand-brown/15 bg-white p-4">
              <p className="text-sm font-bold text-brand-charcoal">eBook</p>
              <p className="mt-1 text-lg font-extrabold text-brand-charcoal">
                {book.priceEbook ?? "$7.00"}
              </p>
              {bookDeliveryFormat(book.id) ? (
                <p className="mt-1 text-xs font-semibold text-brand-charcoal/75">
                  {bookDeliveryFormat(book.id)}
                </p>
              ) : null}
              <div className="mt-4">
                <EbookCheckoutForm
                  bookId={book.id}
                  ebookFileBaseName={book.ebookFileBaseName}
                  isEnabled={hasDirectEbookCheckout}
                  variant="secondary"
                />
              </div>
            </div>
          ) : (
            <EbookCheckoutForm
              bookId={book.id}
              ebookFileBaseName={book.ebookFileBaseName}
              isEnabled={hasDirectEbookCheckout}
            />
          )}
        </div>
      ) : null}

      {book.amazonPaperbackUrl ? (
        <div
          className={
            showPhysicalSection
              ? "mt-6 rounded-2xl border border-brand-brown/15 bg-white p-4"
              : showPhysicalSection || hasDirectEbookCheckout
                ? "mt-4"
                : ""
          }
        >
          {showPhysicalSection ? (
            <p className="text-sm font-bold text-brand-charcoal">Amazon</p>
          ) : null}
          {book.pricePaperback ? (
            <p
              className={
                showPhysicalSection
                  ? "mt-1 text-lg font-extrabold text-brand-charcoal"
                  : "mb-2 text-sm text-brand-charcoal/85"
              }
            >
              {showPhysicalSection ? (
                book.pricePaperback
              ) : (
                <>
                  Amazon paperback:{" "}
                  <span className="font-semibold text-brand-charcoal">
                    {book.pricePaperback}
                  </span>
                </>
              )}
            </p>
          ) : null}
          <a
            href={book.amazonPaperbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={
              stopLinkPropagation ? (event) => event.stopPropagation() : undefined
            }
            className={`inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-yellow-bright px-5 text-sm font-bold text-section-navy transition hover:brightness-95 ${showPhysicalSection || book.pricePaperback ? "mt-4" : ""}`}
          >
            Buy on Amazon
          </a>
        </div>
      ) : null}

      {!showPhysicalSection ? (
        <div className="mt-6 grid gap-2 rounded-2xl border border-brand-brown/15 bg-cream-deep p-3 text-sm">
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
      ) : null}
    </div>
  );
}
