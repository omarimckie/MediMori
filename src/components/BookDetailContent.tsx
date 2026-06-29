"use client";

import { BookBuyActions } from "@/components/BookBuyActions";
import { BookDescription } from "@/components/BookDescription";
import { BookDetailPreview } from "@/components/BookDetailPreview";
import type { Book } from "@/lib/books";

type Props = {
  book: Book;
  showTitle?: boolean;
};

export function BookDetailContent({ book, showTitle = false }: Props) {
  return (
    <div className="grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:items-start">
      <div className="md:text-left">
        <BookDetailPreview book={book} priority />

        {showTitle ? (
          <>
            <h3 className="mt-6 text-2xl font-extrabold text-brand-charcoal sm:text-[1.65rem]">
              {book.title}
            </h3>
            {book.subtitle ? (
              <p className="mt-2 text-sm font-semibold text-brand-green-deep">
                {book.subtitle}
              </p>
            ) : null}
          </>
        ) : null}

        {book.amazonStarRating ? (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand-yellow/25 px-4 py-2 text-sm font-bold text-brand-charcoal">
            <span aria-hidden="true" className="text-brand-orange-deep">
              ★
            </span>
            {book.amazonStarRating}
          </p>
        ) : null}
      </div>

      <article className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
        <BookDescription book={book} />
        <BookBuyActions book={book} className="mt-7" />
      </article>
    </div>
  );
}
