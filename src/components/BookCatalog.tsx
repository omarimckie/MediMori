"use client";

import { BookBuyActions } from "@/components/BookBuyActions";
import type { Book } from "@/lib/books";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
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
    <div
      className={`aspect-[2/3] w-full ${maxWidth} overflow-hidden rounded-2xl border border-brand-brown/20 bg-white shadow-sm ${className}`}
    >
      <Image
        src={book.coverImageUrl}
        alt={`${book.title} cover`}
        width={440}
        height={660}
        className="h-full w-full object-cover"
      />
    </div>
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
          View description
        </p>
      </button>
    );
  }

  return (
    <article className="text-center">
      <button
        type="button"
        onClick={onSelect}
        className="group w-full cursor-pointer rounded-3xl border border-transparent p-2 transition hover:border-brand-blue/20 hover:bg-brand-blue/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-deep"
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
          Tap cover or title to read description
        </p>
      </button>
      <BookBuyActions book={book} />
    </article>
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
            <div className="grid gap-8 md:grid-cols-[minmax(240px,0.85fr)_1.15fr] md:items-start md:gap-12">
              <div className="md:text-left">
                <motion.div layoutId={`book-cover-${selectedBook.id}`}>
                  <BookCover book={selectedBook} className="md:mx-0" />
                </motion.div>
                <motion.h3
                  layoutId={`book-title-${selectedBook.id}`}
                  className="mt-6 text-2xl font-extrabold text-brand-charcoal sm:text-[1.65rem]"
                >
                  {selectedBook.title}
                </motion.h3>
                {selectedBook.subtitle ? (
                  <p className="mt-2 text-sm font-semibold text-brand-green-deep">
                    {selectedBook.subtitle}
                  </p>
                ) : null}
                <BookBuyActions book={selectedBook} />
              </div>

              <motion.div
                key={selectedBook.id}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="flex items-center"
              >
                <p className="text-sm leading-relaxed text-brand-charcoal/85 sm:text-[0.95rem]">
                  {selectedBook.description}
                </p>
              </motion.div>
            </div>

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
