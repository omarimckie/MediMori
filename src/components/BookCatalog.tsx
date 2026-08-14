"use client";

import { BookCoverImage } from "@/components/BookCoverImage";
import { TfButton } from "@/components/ui/TfButton";
import { TfCard } from "@/components/ui/TfCard";
import type { Book } from "@/lib/books";
import { motion } from "framer-motion";

type Props = {
  books: Book[];
};

const DISPLAY_ORDER = ["book-one", "book-three", "book-two"] as const;

const coverAlt: Record<string, string> = {
  "book-one": "Children Diseases: Sickle Cell book cover",
  "book-three":
    "Children Diseases: Asthma — AJ Can Breathe Easy book cover",
  "book-two": "Health & Medicine Word Search Collection book cover",
};

function orderedBooks(books: Book[]) {
  return DISPLAY_ORDER.map((id) => books.find((book) => book.id === id)).filter(
    (book): book is Book => Boolean(book),
  );
}

function BookCover({ book }: { book: Book }) {
  if (!book.coverImageUrl) {
    return (
      <div className="flex aspect-[2/3] w-full items-center justify-center rounded-2xl border-2 border-dashed border-brand-brown/30 bg-brand-charcoal/[0.03] text-sm font-medium text-brand-charcoal/45">
        Cover coming soon
      </div>
    );
  }

  return (
    <BookCoverImage
      src={book.coverImageUrl}
      alt={coverAlt[book.id] ?? `${book.title} book cover`}
      width={book.coverWidth ?? 700}
      height={book.coverHeight ?? 1000}
      maxWidthClass="max-w-none"
      className="mx-auto"
    />
  );
}

function BookCard({ book }: { book: Book }) {
  const tagline =
    book.tagline ??
    book.description.split(/(?<=[.!?])\s+/)[0] ??
    book.description;

  return (
    <TfCard className="flex min-h-full w-full flex-1 flex-col items-center p-5 text-center sm:p-6 lg:px-6 lg:py-5">
      <div className="flex w-full items-center justify-center">
        <BookCover book={book} />
      </div>
      <div className="mt-5 flex w-full flex-1 flex-col items-center lg:mt-4">
        <h3 className="text-xl font-semibold leading-snug text-brand-navy sm:text-2xl">
          {book.title}
        </h3>
        {book.cardSubtitle ? (
          <p className="mt-1 text-sm font-bold text-brand-navy/80">
            {book.cardSubtitle}
          </p>
        ) : null}
        <p className="mt-3 text-sm leading-relaxed text-brand-charcoal/75 lg:mt-2.5">
          {tagline}
        </p>
        <TfButton
          href={`/books/${book.id}`}
          className="mt-auto w-full pt-5 sm:w-auto lg:pt-4"
        >
          View Book
        </TfButton>
      </div>
    </TfCard>
  );
}

export function BookCatalog({ books }: Props) {
  const catalog = orderedBooks(books);

  return (
    <div className="grid items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-7">
      {catalog.map((book, index) => (
        <motion.div
          key={book.id}
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45, delay: index * 0.08, ease: "easeOut" }}
          className={
            catalog.length === 3 && index === 2
              ? "flex md:col-span-2 md:mx-auto md:w-[calc(50%-0.75rem)] lg:col-span-1 lg:mx-0 lg:w-auto"
              : "flex"
          }
        >
          <BookCard book={book} />
        </motion.div>
      ))}
    </div>
  );
}
