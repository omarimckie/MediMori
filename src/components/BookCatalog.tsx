"use client";

import { BookCoverImage } from "@/components/BookCoverImage";
import type { Book } from "@/lib/books";
import { motion } from "framer-motion";
import Link from "next/link";

type Props = {
  books: Book[];
};

const accentStyles = {
  purple: {
    title: "text-[#7050a5]",
    button: "bg-[#7050a5] hover:brightness-95",
  },
  blue: {
    title: "text-brand-blue-deep",
    button: "bg-brand-blue-deep hover:brightness-95",
  },
};

function BookCover({ book }: { book: Book }) {
  if (!book.coverImageUrl) {
    return (
      <div className="flex aspect-[2/3] w-full max-w-[253px] items-center justify-center rounded-2xl border-2 border-dashed border-brand-brown/30 bg-brand-charcoal/[0.03] text-sm font-medium text-brand-charcoal/45">
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
      maxWidthClass="max-w-[253px]"
      className="mx-auto"
    />
  );
}

function BookCard({ book }: { book: Book }) {
  const styles = accentStyles[book.accent ?? "purple"];
  const tagline =
    book.tagline ??
    book.description.split(/(?<=[.!?])\s+/)[0] ??
    book.description;

  return (
    <article className="grid min-h-[280px] grid-cols-[45%_1fr] items-center gap-4 rounded-3xl border border-brand-brown/10 bg-white/70 p-4 shadow-sm sm:gap-5 sm:p-5">
      <div className="flex justify-center">
        <BookCover book={book} />
      </div>
      <div className="flex h-full flex-col justify-center py-1">
        <h3 className={`text-lg font-extrabold leading-snug sm:text-xl ${styles.title}`}>
          {book.title}
        </h3>
        {book.cardSubtitle ? (
          <p className={`mt-1 text-sm font-bold ${styles.title}`}>
            {book.cardSubtitle}
          </p>
        ) : null}
        <p className="mt-3 text-sm leading-relaxed text-brand-charcoal/75">
          {tagline}
        </p>
        <Link
          href={`/books/${book.id}`}
          className={`mt-5 inline-flex w-fit items-center justify-center rounded-full px-5 py-2.5 text-sm font-extrabold text-white transition ${styles.button}`}
        >
          View Book
        </Link>
      </div>
    </article>
  );
}

export function BookCatalog({ books }: Props) {
  const lastIsAlone = books.length % 2 === 1;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {books.map((book, index) => (
        <motion.div
          key={book.id}
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.45, delay: index * 0.08, ease: "easeOut" }}
          className={
            lastIsAlone && index === books.length - 1
              ? "lg:col-span-2 lg:mx-auto lg:w-[calc(50%-0.75rem)]"
              : undefined
          }
        >
          <BookCard book={book} />
        </motion.div>
      ))}
    </div>
  );
}
