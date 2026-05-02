"use client";

import type { Book } from "@/lib/books";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

type Props = { book: Book };

export function BookCard({ book }: Props) {
  return (
    <motion.article
      className="flex flex-col overflow-hidden rounded-3xl border border-brand-brown/15 bg-white shadow-sm shadow-brand-brown/10 transition-shadow duration-300 hover:shadow-md hover:shadow-brand-brown/15"
    >
      <div className="h-2 w-full bg-gradient-to-r from-brand-blue via-brand-green to-brand-orange" />
      <div className="flex flex-1 flex-col gap-4 p-6 sm:p-8">
        {book.coverImageUrl ? (
          <Link
            href={`/books/${book.id}`}
            className="mx-auto block w-full max-w-[220px] rounded-2xl text-left transition hover:scale-[1.01] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
          >
            <div className="overflow-hidden rounded-2xl border border-brand-brown/20 bg-cream shadow-sm">
              <Image
                src={book.coverImageUrl}
                alt={`${book.title} cover`}
                width={440}
                height={660}
                className="h-auto w-full object-cover"
              />
            </div>
            <p className="mt-2 text-center text-xs font-semibold text-brand-charcoal/70">
              Tap cover for full details
            </p>
          </Link>
        ) : null}
        <div className="flex flex-1 flex-col gap-3">
          <h3 className="text-xl font-extrabold text-brand-charcoal">{book.title}</h3>
          {book.subtitle ? (
            <p className="text-sm font-semibold text-brand-green-deep">{book.subtitle}</p>
          ) : null}
          <p className="text-sm leading-relaxed text-brand-charcoal/80">
            {book.description}
          </p>
          <div className="mt-auto flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-brand-charcoal">
              eBook: {book.priceEbook ?? "Set price"}
            </span>
            <Link
              href={`/books/${book.id}`}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-brand-blue-deep px-4 text-sm font-bold text-white transition hover:brightness-95"
            >
              View details
            </Link>
          </div>
        </div>
      </div>
    </motion.article>
  );
}
