"use client";

import { BookDetailContent } from "@/components/BookDetailContent";
import { BookCoverImage } from "@/components/BookCoverImage";
import type { Book } from "@/lib/books";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

type Props = {
  books: Book[];
};

function BookCover({
  book,
  className = "mx-auto",
  compact = false,
}: {
  book: Book;
  className?: string;
  compact?: boolean;
}) {
  const maxWidth = compact ? "max-w-[120px]" : "max-w-[220px]";

  if (!book.coverImageUrl) {
    return (
      <div
        className={`flex aspect-[2/3] w-full ${maxWidth} items-center justify-center rounded-2xl border-2 border-dashed border-brand-brown/30 bg-brand-charcoal/[0.03] text-sm font-medium text-brand-charcoal/45 ${className}`}
      >
        Cover coming soon
      </div>
    );
  }

  return (
    <BookCoverImage
      src={book.coverImageUrl}
      alt={`${book.title} cover`}
      width={book.coverWidth ?? 700}
      height={book.coverHeight ?? 1000}
      maxWidthClass={maxWidth}
      className={className}
    />
  );
}

function BookSelectorCard({
  book,
  onSelect,
  compact = false,
}: {
  book: Book;
  onSelect: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="group w-full cursor-pointer rounded-3xl border border-transparent p-4 text-center transition hover:border-brand-blue/20 hover:bg-brand-blue/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-deep"
      >
        <motion.div layoutId={`book-cover-${book.id}`}>
          <BookCover book={book} compact className="mx-auto" />
        </motion.div>
        <motion.h3
          layoutId={`book-title-${book.id}`}
          className="mt-3 text-lg font-extrabold text-brand-charcoal"
        >
          {book.title}
        </motion.h3>
        <p className="mt-2 text-xs font-semibold text-brand-charcoal/60 group-hover:text-brand-blue-deep">
          View book
        </p>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group w-full cursor-pointer rounded-3xl border border-transparent p-2 text-center transition hover:border-brand-blue/20 hover:bg-brand-blue/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-deep"
    >
      <motion.div layoutId={`book-cover-${book.id}`}>
        <BookCover book={book} className="mx-auto" />
      </motion.div>
      <motion.h3
        layoutId={`book-title-${book.id}`}
        className="mt-6 text-xl font-extrabold text-brand-charcoal sm:text-2xl"
      >
        {book.title}
      </motion.h3>
      {book.subtitle ? (
        <p className="mt-2 text-sm font-semibold text-brand-green-deep">
          {book.subtitle}
        </p>
      ) : null}
      <p className="mt-4 text-xs font-semibold text-brand-charcoal/50 group-hover:text-brand-blue-deep/70">
        Tap cover or title for details
      </p>
    </button>
  );
}

export function BookCatalog({ books }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedBook = books.find((book) => book.id === selectedId);
  const otherBooks = books.filter((book) => book.id !== selectedId);

  return (
    <div>
      <AnimatePresence mode="wait">
        {!selectedBook ? (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="grid gap-10 md:grid-cols-2 lg:grid-cols-3"
          >
            {books.map((book) => (
              <BookSelectorCard
                key={book.id}
                book={book}
                onSelect={() => setSelectedId(book.id)}
              />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="detail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="mb-8 inline-flex items-center rounded-full border border-brand-brown/20 bg-cream-deep px-4 py-2 text-sm font-bold text-brand-charcoal transition hover:bg-white"
            >
              ← Back to all books
            </button>

            <motion.div layoutId={`book-title-${selectedBook.id}`} className="mb-8">
              <h3 className="text-3xl font-extrabold text-brand-charcoal sm:text-4xl">
                {selectedBook.title}
              </h3>
              {selectedBook.subtitle ? (
                <p className="mt-2 text-base font-semibold text-brand-green-deep">
                  {selectedBook.subtitle}
                </p>
              ) : null}
            </motion.div>

            <BookDetailContent book={selectedBook} />

            {otherBooks.length ? (
              <div className="mt-12 border-t border-brand-brown/15 pt-10">
                <p className="mb-6 text-center text-sm font-semibold text-brand-charcoal/60">
                  Browse our other books
                </p>
                <div className="mx-auto grid max-w-2xl gap-4 sm:grid-cols-2">
                  {otherBooks.map((book) => (
                    <BookSelectorCard
                      key={book.id}
                      book={book}
                      compact
                      onSelect={() => setSelectedId(book.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
